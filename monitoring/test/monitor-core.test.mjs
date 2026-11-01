import { test } from "node:test";
import assert from "node:assert/strict";
import { createMonitor, pendingFromActivity, runTask, SHORTFALL_ALARM_S, SHORTFALL_MAX_GAP_S } from "../src/monitor-core.mjs";

const E = 10n ** 18n, S9 = 10n ** 9n, MINT = "Mint1111";
const mintInfo = { mintAuthority: MINT, freezeAuthority: null, decimals: 9 };
let seq = 0;
const ID = () => "0x" + (++seq).toString(16).padStart(64, "0");
const act = (now, items, complete = true) => ({ updated: now - 30, index: { complete }, items: items.map((it) => ({ id: it.id || ID(), ...it })) });
const noEvidence = { critical: [], unconfirmed: [], waiting: 0, unresolved: 0 };

function fakes(st) {
  st.block ??= 100; st.slot ??= 1000; st.ev ??= noEvidence;
  return createMonitor({
    mint: MINT, maxActivityAge: 300, nowSec: () => st.now, budget: st.budget,
    readLocked: async () => { st.onLocked?.(); if (st.hangLocked) return new Promise(() => {}); if (st.failLocked) throw new Error("rpc down"); return { value: st.locked, block: st.block++ }; },
    readMint: async () => { st.mintCalls = (st.mintCalls || 0) + 1; st.onMint?.(); if (st.hangMint) return new Promise(() => {}); if (st.failMint) throw new Error("x1 rpc down"); return { info: st.mintInfo || mintInfo, supply9: st.supply * S9, extensions: [], slot: st.slot++ }; },
    readActivity: async () => { if (st.act === "fail") throw new Error("down"); return st.act; },
    isDelivered: async (it) => (st.done || []).includes(it.id),
    evidence: async (ctx) => {
      if (st.ev === "hang") return new Promise((_, rej) => ctx.signal.addEventListener("abort", () => rej(ctx.signal.reason)));
      if (st.ev === "fail") throw new Error("logs rpc down"); return st.ev; },
  });
}

test("evidence (message ID without counterpart) is CRITICAL", async () => {
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: act(1000, []), ev: { ...noEvidence, critical: [{ kind: "mint-without-lock", id: "0xabc", reason: "confirmed" }] } };
  const r = await fakes(st)();
  assert.equal(r.severity, "CRITICAL"); assert.match(r.reasons.join(" "), /mint-without-lock 0xabc/);
});

test("Codex R5-03: burn -> unlock between the reads, repeated every tick, is never CRITICAL (balance is advisory)", async () => {
  // supply read 100, then burn+unlock 10, then lockbox read 90: looks like a 10 shortfall on every tick
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: act(1000, []) };
  st.onMint = () => {};
  st.onLocked = () => { st.locked -= 10n * E; st.supply -= 10n; };
  const tick = fakes(st);
  const seen = [];
  for (let i = 0; i < 8; i++) { seen.push((await tick()).severity); st.now += 60; }
  assert.ok(!seen.includes("CRITICAL"), `never CRITICAL: ${seen}`);
});

test("a balance shortfall becomes WARN (human alarm) only after 30 min of consecutive reads, never CRITICAL", async () => {
  const st = { now: 1000, locked: 90n * E, supply: 100n, act: act(1000, []) };
  const tick = fakes(st);
  let r = await tick(); assert.equal(r.severity, "OK"); assert.equal(r.shortfallSeconds, 0); assert.match(r.reasons.join(" "), /alarm after/);
  for (let t = 60; t < SHORTFALL_ALARM_S; t += 60) { st.now = 1000 + t; st.act = act(st.now, []); r = await tick(); }
  assert.equal(r.severity, "OK"); assert.equal(r.balanceAlarm, false);
  st.now = 1000 + SHORTFALL_ALARM_S; st.act = act(st.now, []);
  r = await tick(); assert.equal(r.severity, "WARN"); assert.equal(r.balanceAlarm, true);
  st.locked = 100n * E; st.now += 60; st.act = act(st.now, []);
  r = await tick(); assert.equal(r.severity, "OK"); assert.equal(r.shortfallSeconds, 0, "the timer resets when coverage is back");
});

test("R6-06: a gap of more than 2 min between successful reads restarts the 30-min timer", async () => {
  const st = { now: 1000, locked: 90n * E, supply: 100n, act: act(1000, []) };
  const tick = fakes(st);
  for (let t = 0; t <= 1500; t += 60) { st.now = 1000 + t; st.act = act(st.now, []); await tick(); }
  st.failLocked = true; st.now += 60; await tick();            // failed reads do not count
  st.now += 200; await tick();
  st.failLocked = false; st.now += 60; st.act = act(st.now, []);
  const r = await tick();
  assert.equal(r.shortfallSeconds, 0, "gap > 120 s: started again"); assert.equal(r.balanceAlarm, false);
  // and after the restart it again needs 30 min
  for (let i = 0; i < 29; i++) { st.now += 60; st.act = act(st.now, []); assert.equal((await tick()).balanceAlarm, false); }
});

test("R6-06: a balance alarm is not hidden by an UNKNOWN evidence state, and the other way round", async () => {
  const st = { now: 1000, locked: 90n * E, supply: 100n, act: act(1000, []) };
  const tick = fakes(st);
  for (let t = 0; t <= SHORTFALL_ALARM_S; t += 60) { st.now = 1000 + t; st.act = act(st.now, []); await tick(); }
  st.ev = "fail"; st.now += 60; st.act = act(st.now, []);
  let r = await tick();
  assert.equal(r.severity, "UNKNOWN"); assert.equal(r.evidenceState, "failed");
  assert.equal(r.balanceAlarm, true, "the balance alarm stays visible"); assert.match(r.reasons.join(" "), /balance shortfall/);
  st.ev = noEvidence; st.locked = 100n * E; st.now += 60; st.act = act(st.now, []);
  r = await tick(); assert.equal(r.evidenceState, "ok"); assert.equal(r.balanceAlarm, false);
});

test("R6-01: an unconfirmed candidate is UNKNOWN with the reason, never CRITICAL", async () => {
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: act(1000, []),
    ev: { ...noEvidence, unconfirmed: [{ kind: "mint-without-lock", id: "0xdef", reason: "confirmation failed: ETH_LOGS_RPC2 not configured" }] } };
  const r = await fakes(st)();
  assert.equal(r.severity, "UNKNOWN"); assert.equal(r.evidenceState, "unconfirmed"); assert.match(r.reasons.join(" "), /NOT confirmed: .*ETH_LOGS_RPC2/);
});

test("R6-05: a changed mint is CRITICAL even when Ethereum and the evidence are down", async () => {
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: "fail", failLocked: true, ev: "fail", mintInfo: { ...mintInfo, freezeAuthority: "Evil" } };
  const r = await fakes(st)();
  assert.equal(r.severity, "CRITICAL"); assert.equal(r.readOk, false);
});

test("R6-05: a failed mint read is UNKNOWN, not OK", async () => {
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: act(1000, []), failMint: true };
  const r = await fakes(st)();
  assert.equal(r.severity, "UNKNOWN"); assert.match(r.reasons.join(" "), /mint read failed/);
});

test("evidence that cannot be collected is UNKNOWN, not OK", async () => {
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: act(1000, []), ev: "fail" };
  const r = await fakes(st)();
  assert.equal(r.severity, "UNKNOWN"); assert.equal(r.readOk, false);
  assert.match(r.reasons.join(" "), /evidence read failed: logs rpc down/, "the cause is kept in the log (testnet operator server, 31 Oct)");
});

test("unresolved processed messages make the tick UNKNOWN", async () => {
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: act(1000, []), ev: { ...noEvidence, unresolved: 2, unresolvedBy: { noHistory: 2 } } };
  assert.equal((await fakes(st)()).severity, "UNKNOWN");
});

test("a failed balance read does not block the evidence verdict", async () => {
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: act(1000, []), failLocked: true, ev: { ...noEvidence, critical: [{ kind: "unlock-without-burn", id: "0x1", reason: "confirmed" }] } };
  const r = await fakes(st)();
  assert.equal(r.severity, "CRITICAL"); assert.equal(r.readOk, false);
});

test("mint authority change is CRITICAL at once", async () => {
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: act(1000, []), mintInfo: { ...mintInfo, mintAuthority: "Evil" } };
  assert.equal((await fakes(st)()).severity, "CRITICAL");
});

test("in-flight amounts are re-checked on-chain (31 Oct live case) and counted only from a complete snapshot", async () => {
  const id = ID();
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: act(1000, [{ id, dir: "e2x", amount: (30n * E).toString(), delivered: null }]), done: [id] };
  const r = await fakes(st)();
  assert.equal(r.severity, "OK"); assert.equal(r.shortfallSeconds, 0);
  st.act = act(1000, [], false);
  const r2 = await fakes({ ...st })();
  assert.equal(r2.complete, false); assert.match(r2.reasons.join(" "), /heuristic/);
});

test("pendingFromActivity sums only undelivered, per direction", async () => {
  const p = await pendingFromActivity({ items: [{ id: ID(), dir: "e2x", amount: "5", delivered: null }, { id: ID(), dir: "x2e", amount: "7" },
    { id: ID(), dir: "x2e", amount: "100", delivered: 123 }] });
  assert.deepEqual(p, { e2x: 5n, x2e: 7n });
});

// ---------- round E (Codex round 7) ----------
const fast = { mint: 60, evidence: 60, balance: 60 };
test("R7-01: an evidence collector that spends its whole budget does not stop the mint check: a changed mint is CRITICAL", async () => {
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: act(1000, []), ev: "hang", budget: fast, mintInfo: { ...mintInfo, mintAuthority: "Evil" } };
  const r = await fakes(st)();
  assert.equal(st.mintCalls, 1, "readMint ran"); assert.equal(r.tasks.mint, "ok"); assert.equal(r.tasks.evidence, "timeout");
  assert.equal(r.severity, "CRITICAL");
});

test("R7-01: collected evidence stays CRITICAL when the balance read hangs past its budget", async () => {
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: act(1000, []), hangLocked: true, budget: fast,
    ev: { ...noEvidence, critical: [{ kind: "unlock-without-burn", id: "0x1", reason: "confirmed" }] } };
  const r = await fakes(st)();
  assert.equal(r.tasks.balance, "timeout"); assert.equal(r.severity, "CRITICAL");
});

test("R7-01: a hung mint read is UNKNOWN for the mint, but the evidence is still judged (CRITICAL kept)", async () => {
  const st = { now: 1000, locked: 100n * E, supply: 100n, act: act(1000, []), hangMint: true, budget: fast,
    ev: { ...noEvidence, critical: [{ kind: "mint-without-lock", id: "0x2", reason: "confirmed" }] } };
  const r = await fakes(st)();
  assert.equal(r.tasks.mint, "timeout"); assert.equal(r.tasks.balance, "skipped"); assert.equal(r.severity, "CRITICAL");
  assert.match(r.reasons.join(" "), /mint read failed: time budget spent/);
});

test("R7-01: runTask returns at the budget even if the work ignores the signal, and reports the timeout", async () => {
  const t0 = Date.now();
  const r = await runTask("x", 50, () => new Promise(() => {}));
  assert.equal(r.ok, false); assert.equal(r.timedOut, true); assert.ok(Date.now() - t0 < 1000);
});

test("R7-04: a shortfall followed by failed reads for longer than the gap does not alarm; the timer is void", async () => {
  const st = { now: 1000, locked: 90n * E, supply: 100n, act: act(1000, []) };
  const tick = fakes(st);
  let r = await tick(); assert.equal(r.shortfallSeconds, 0);
  st.failLocked = true;
  for (let i = 0; i < 40; i++) { st.now += 60; st.act = act(st.now, []); r = await tick(); }   // 40 min of failed balance reads
  assert.equal(r.balanceAlarm, false, "no alarm from stale observations"); assert.equal(r.balanceStale, true);
  assert.ok(st.now - 1000 > SHORTFALL_ALARM_S);
  st.failLocked = false; st.now += 60; st.act = act(st.now, []);
  r = await tick();
  assert.equal(r.shortfallSeconds, 0, "the timer starts again from the first new observation"); assert.equal(r.balanceStale, false);
});

test("R7-04: short failures inside the gap keep the timer, but it counts only observed time", async () => {
  const st = { now: 1000, locked: 90n * E, supply: 100n, act: act(1000, []) };
  const tick = fakes(st);
  await tick();
  st.failLocked = true; st.now += SHORTFALL_MAX_GAP_S - 10; let r = await tick();
  assert.equal(r.shortfallSeconds, 0, "the last observation is the first one"); assert.equal(r.balanceStale, false);
  st.failLocked = false; st.now += 5; st.act = act(st.now, []); r = await tick();
  assert.equal(r.shortfallSeconds, SHORTFALL_MAX_GAP_S - 5);
});

test("R8-07: balances read fast, evidence runs 180 s -> at publication the observation is stale (no alarm on it)", async () => {
  const st = { now: 1000, locked: 90n * E, supply: 100n, act: act(1000, []) };
  const tick = fakes(st);
  for (let t = 0; t <= SHORTFALL_ALARM_S; t += 60) { st.now = 1000 + t; st.act = act(st.now, []); await tick(); }
  let r = await tick(); assert.equal(r.balanceAlarm, true, "30 min of consecutive observations: alarm");
  // next tick: the balance task finishes at once, the evidence task takes 180 s of (fake) time
  st.ev = { ...noEvidence }; const slow = st.ev;
  const slowTick = createMonitor({
    mint: MINT, maxActivityAge: 300, nowSec: () => st.now,
    readLocked: async () => ({ value: st.locked, block: st.block++ }),
    readMint: async () => ({ info: mintInfo, supply9: st.supply * S9, extensions: [], slot: st.slot++ }),
    readActivity: async () => act(st.now, []),
    evidence: async () => { await new Promise((res) => setTimeout(res, 20)); st.now += 180; return slow; },
  });
  st.now += 60;
  r = await slowTick();
  assert.equal(r.balanceObservedAt, st.now - 180, "the observation time is the actual read time");
  assert.equal(r.balanceStale, true, "judged at publication: 180 s > 120 s");
  assert.equal(r.balanceAlarm, false);
  assert.match(r.reasons.join(" "), /stale \(last 180 s ago\)/);
});

test("R8-07: balanceFreshness is computed from the observation time and the given moment", async () => {
  const { balanceFreshness } = await import("../src/monitor-core.mjs");
  assert.deepEqual(balanceFreshness(1000, 1100), { age: 100, stale: false });
  assert.deepEqual(balanceFreshness(1000, 1121), { age: 121, stale: true });
  assert.deepEqual(balanceFreshness(null, 1121), { age: null, stale: false });
});
