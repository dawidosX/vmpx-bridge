// Collateral monitor logic, separated from I/O so tick() can be tested with fake readers.
// Round C (docs/16-auto-pause-model.md): the automatic pause rests on EVIDENCE matched by message ID (evidence.mjs);
// the balance rule below is advisory (alarm for a human after 30 min, never a pause):
//   lockbox (Ethereum) >= X1 supply * 1e9 + pending ETH->X1 + pending X1->ETH
// Two chains are never read as one snapshot (Codex rounds 4-5: R4-02, R5-01, R5-03), so a balance shortfall can be
// a timing effect and index.complete is a heuristic, not a proof.
import { evaluate, classifyMintState } from "./invariant.mjs";


/** Sum of undelivered transfers per direction from an activity.json document (isDone(item) -> true skips one). */
export async function pendingFromActivity(act, isDone = async () => false) {
  let e2x = 0n, x2e = 0n;
  for (const it of act.items || []) {
    if (it.delivered || !/^0x[0-9a-fA-F]{64}$/.test(it.id || "")) continue;
    if (await isDone(it)) continue;
    const a = BigInt(it.amount || 0);
    if (it.dir === "e2x") e2x += a; else if (it.dir === "x2e") x2e += a;
  }
  return { e2x, x2e };
}

export const SHORTFALL_ALARM_S = 1800;   // round C: a balance shortfall is a human alarm after 30 min, never a pause
export const SHORTFALL_MAX_GAP_S = 120;  // R6-06 / R7-04: no successful balance observation for longer -> the timer is void
// R7-01: three independent tasks, each with its own time budget (ms). The mint check runs FIRST and always.
export const BUDGET = { mint: 30000, evidence: 180000, balance: 60000 };

/** R8-07: age and staleness of the last successful balance observation, judged at the given moment (seconds) */
export function balanceFreshness(observedAt, nowSec) {
  if (!observedAt) return { age: null, stale: false };
  const age = nowSec - observedAt;
  return { age, stale: age > SHORTFALL_MAX_GAP_S };
}

/**
 * Run fn(ctx) with its own budget. ctx = { signal, check } (check throws once the budget is spent). Never throws:
 * -> { ok: true, value } | { ok: false, error, timedOut }. The race returns at the budget even if fn ignores the
 * signal; fn must not commit anything once ctx.signal.aborted (the caller's "zombie" guard).
 */
export async function runTask(name, ms, fn, withContext = (ctx, f) => f()) {
  const ctl = new AbortController();
  const ctx = { signal: ctl.signal, check: () => ctl.signal.throwIfAborted() };
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(() => { ctl.abort(new Error(`${name} time budget (${ms} ms) spent`)); resolve({ ok: false, timedOut: true, error: ctl.signal.reason }); }, ms); });
  const work = Promise.resolve().then(() => withContext(ctx, () => fn(ctx))).then((value) => ({ ok: true, value }),
    (error) => ({ ok: false, timedOut: ctl.signal.aborted, error: ctl.signal.aborted ? ctl.signal.reason : error }));
  try { return await Promise.race([work, limit]); } finally { clearTimeout(timer); if (!ctl.signal.aborted) ctl.abort(new Error(`${name} finished`)); }
}

/**
 * Round E model (docs/16-auto-pause-model.md):
 *   CRITICAL  a mint-state change, or EVIDENCE matched by message ID and confirmed in two sources per chain.
 *             R7-01: the mint task runs first with its own budget, the evidence and balance tasks have their own budgets
 *             too; a timeout or error of one task never removes what another task confirmed.
 *   UNKNOWN   the evidence could not be collected or confirmed (incl. the two Ethereum sources disagreeing, R7-02),
 *             a processed message is not resolved, or the mint could not be read.
 *   WARN      a balance shortfall that lasted SHORTFALL_ALARM_S on CONSECUTIVE successful observations; never a pause.
 *   OK        otherwise.
 * deps: readMint(ctx), evidence(ctx), readLocked(ctx), readActivity(ctx), isDelivered(item, ctx), nowSec(), mint,
 *       maxActivityAge, budget (optional, ms per task), withContext(ctx, f) (optional: carries ctx to the I/O layer)
 */
export function createMonitor(deps) {
  let lastBlock = 0, lastSlot = 0, shortSince = 0, lastObsAt = 0;
  const budget = { ...BUDGET, ...(deps.budget || {}) };

  async function observeBalance(m, ctx) {
    const L = await deps.readLocked(ctx); ctx.check();
    if (L.block < lastBlock || m.slot < lastSlot) throw new Error(`read point went back (block ${L.block} < ${lastBlock} or slot ${m.slot} < ${lastSlot})`);
    lastBlock = L.block; lastSlot = m.slot;
    let act = null, actAge = null, complete = false, p = { e2x: 0n, x2e: 0n }, why = null;
    try {
      act = await deps.readActivity(ctx); ctx.check();
      actAge = deps.nowSec() - Number(act.updated || 0);
      if (!(actAge <= deps.maxActivityAge)) { why = `activity.json is ${actAge} s old`; act = null; }
      else if (!(act.index && act.index.complete === true)) { why = "indexer snapshot not complete (heuristic)"; act = null; }
    } catch (e) { ctx.check(); why = "activity.json unavailable"; act = null; }
    if (act) {
      try { p = await pendingFromActivity(act, deps.isDelivered ? (it) => deps.isDelivered(it, ctx) : async () => false); complete = true; }
      catch { ctx.check(); why = "delivery status read failed"; }
    }
    const raw = evaluate({ locked: L.value, supply9: m.supply9, pendingE2X: p.e2x, pendingX2E: p.x2e });
    // R8-07: the observation time is when the balances were actually read, not when the tick started or ended
    return { L, raw, actAge, complete, why, short: L.value < raw.circulating || (complete && raw.delta < 0n), at: deps.nowSec() };
  }
  const why = (t) => (t.timedOut ? `time budget spent (${t.error && t.error.message})` : (t.error && t.error.message) || "failed");

  return async function tick() {
    const r = { reasons: [], readOk: true, evidenceOk: true, tasks: {} };
    // (a) mint: first, always, own budget (R7-01, R6-05)
    let mintIssues = [];
    const mt = await runTask("mint", budget.mint, (ctx) => deps.readMint(ctx), deps.withContext);
    r.tasks.mint = mt.ok ? "ok" : mt.timedOut ? "timeout" : "error";
    const m = mt.ok ? mt.value : null;
    if (m) mintIssues = classifyMintState({ mint: deps.mint, mintAuthority: m.info.mintAuthority, freezeAuthority: m.info.freezeAuthority,
      decimals: m.info.decimals, extensions: m.extensions });
    else { r.readOk = false; r.mintOk = false; r.reasons.push(`mint read failed: ${why(mt)}`); }
    // (b) evidence and (c) balances: independent budgets, in parallel; neither can cancel the other or the mint result
    const [et, bt] = await Promise.all([
      runTask("evidence", budget.evidence, (ctx) => deps.evidence(ctx), deps.withContext),
      m ? runTask("balance", budget.balance, (ctx) => observeBalance(m, ctx), deps.withContext) : Promise.resolve({ ok: false, skipped: true, error: new Error("no mint read") }),
    ]);
    r.tasks.evidence = et.ok ? "ok" : et.timedOut ? "timeout" : "error";
    r.tasks.balance = bt.ok ? "ok" : bt.skipped ? "skipped" : bt.timedOut ? "timeout" : "error";
    const ev = et.ok ? et.value : null;
    if (!ev) { r.evidenceOk = false; r.readOk = false; r.reasons.push(`evidence read failed: ${why(et)}`); }
    const b = bt.ok ? bt.value : null;
    if (!b && !bt.skipped) { r.readOk = false; r.reasons.push(`balance read failed: ${why(bt)}`); }
    if (b) {
      const { reasons: balanceReasons, ...raw } = b.raw;
      Object.assign(r, raw, { complete: b.complete, block: b.L.block, slot: m.slot, activityAge: b.actAge });
      r.reasons.push(...balanceReasons);
      if (lastObsAt && b.at - lastObsAt > SHORTFALL_MAX_GAP_S) shortSince = 0;
      lastObsAt = b.at;
      if (b.short) { if (!shortSince) shortSince = b.at; } else shortSince = 0;
    }
    // R8-07: everything below is judged at PUBLICATION time (the evidence task may have run for minutes after the read)
    const pub = deps.nowSec();
    if (!b && lastObsAt && pub - lastObsAt > SHORTFALL_MAX_GAP_S) shortSince = 0;   // R7-04: a failed read past the gap voids the timer
    // the shortfall lasts only as long as it was OBSERVED (up to the last successful observation), never "until now"
    r.shortfallSeconds = shortSince && lastObsAt ? lastObsAt - shortSince : 0;
    r.balanceObservedAt = lastObsAt || null;
    r.balanceStale = balanceFreshness(lastObsAt, pub).stale;
    r.balanceAlarm = r.shortfallSeconds >= SHORTFALL_ALARM_S && !r.balanceStale;
    r.evidence = ev;
    r.evidenceState = !ev ? "failed" : ev.diverged && ev.diverged.length ? "diverged" : ev.unconfirmed.length ? "unconfirmed"
      : ev.unresolved > 0 ? "unresolved" : ev.secondSource === false ? "single-source" : "ok";
    if (mintIssues.length || (ev && ev.critical.length)) {
      r.severity = "CRITICAL";
      r.reasons.push(...mintIssues.map((x) => x[1]), ...(ev ? ev.critical.map((c) => `${c.kind} ${c.id} (${c.reason})`) : []));
    } else if (r.evidenceState !== "ok" || r.mintOk === false) {
      r.severity = "UNKNOWN";
      if (ev && ev.diverged && ev.diverged.length) r.reasons.push(`Ethereum log sources disagree on ${ev.diverged.length} message(s): ${ev.diverged.slice(0, 3).map((d) => `${d.kind} ${d.id} only in ${d.only}`).join(", ")}`);
      if (ev && ev.secondSource === false) r.reasons.push("second Ethereum log source not configured");
      if (ev && ev.unconfirmed.length) r.reasons.push(...ev.unconfirmed.map((c) => `candidate ${c.kind} ${c.id} NOT confirmed: ${c.reason}`));
      if (ev && ev.unresolved) r.reasons.push(`${ev.unresolved} processed message(s) on X1 not resolved (${JSON.stringify(ev.unresolvedBy)})`);
    } else if (r.balanceAlarm) {
      r.severity = "WARN";
    } else {
      r.severity = "OK";
    }
    if (r.balanceAlarm) r.reasons.push(`balance shortfall for ${r.shortfallSeconds} s (alarm for a human, no pause)`);
    else if (b && b.short) r.reasons.push(`balance shortfall for ${r.shortfallSeconds} s (alarm after ${SHORTFALL_ALARM_S} s)`);
    if (r.balanceStale) r.reasons.push(`balance observations stale (last ${pub - lastObsAt} s ago): shortfall timer void`);
    if (b && !b.complete) r.reasons.push(`balance check incomplete: ${b.why}`);
    return r;
  };
}
