#!/usr/bin/env node
// Collateral monitor (round E, docs/16-auto-pause-model.md): evidence by message ID (evidence.mjs) for the automatic
// pause, plus the advisory balance rule (monitor-core.mjs). Prometheus metrics on 127.0.0.1:9465.
// Env: ETH_RPC, LOGS_RPC (keeps logs back to FROM_BLOCK; default ETH_RPC), ETH_LOGS_RPC2 (an INDEPENDENT provider with
//   logs back to FROM_BLOCK: scans the lockbox logs on its own and confirms candidates; without it -> UNKNOWN),
//   LOCKBOX, TOKEN, ETH_MAILBOX, ETH_DOMAIN (= chain ID), FROM_BLOCK (lockbox deployment block), X1_RPC,
//   X1_RPC2 (an independent X1 RPC, e.g. a local non-voting node), X1_MINT, X1_MAILBOX, X1_PROGRAM, X1_DOMAIN,
//   ACTIVITY (URL or file of activity.json), ACTIVITY_MAX_AGE (s, 300), POLL_SEC (30),
//   STATE_FILE (evidence cache, default $STATE_DIRECTORY/evidence.json or ./evidence.json),
//   RPC_TIMEOUT_S (15), MINT_BUDGET_S (30), EVIDENCE_BUDGET_S (180), BALANCE_BUDGET_S (60): R7-01, one budget per task
import http from "node:http";
import { readFile, open, rename, unlink } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { createMonitor, balanceFreshness } from "./monitor-core.mjs";
import { createStateWriter } from "./state-writer.mjs";
import { collectEvidence, newState, T, mailboxAccount, x1DispatchIds, txInstructions, findProcessedMessage, parseMessage } from "./evidence.mjs";
import { processedMessagePda, b58dec } from "./pda.mjs";

const env = process.env;
for (const k of ["ETH_RPC", "LOCKBOX", "TOKEN", "X1_RPC", "X1_MINT", "ACTIVITY", "ETH_MAILBOX", "X1_MAILBOX", "X1_PROGRAM", "ETH_DOMAIN", "X1_DOMAIN", "FROM_BLOCK"])
  if (!env[k]) { console.error(`missing env ${k}`); process.exit(2); }
const POLL = Number(env.POLL_SEC || 30) * 1000;
const RPC_TIMEOUT = Number(env.RPC_TIMEOUT_S || 15) * 1000;
const BUDGET = { mint: Number(env.MINT_BUDGET_S || 30) * 1000, evidence: Number(env.EVIDENCE_BUDGET_S || 180) * 1000, balance: Number(env.BALANCE_BUDGET_S || 60) * 1000 };
const STATE_FILE = env.STATE_FILE || `${env.STATE_DIRECTORY || "."}/evidence.json`;
const LOGS_RPC = env.LOGS_RPC || env.ETH_RPC;
const cfg = { lockbox: env.LOCKBOX, mailboxEth: env.ETH_MAILBOX, x1Mailbox: env.X1_MAILBOX, x1Program: env.X1_PROGRAM,
  ethDomain: Number(env.ETH_DOMAIN), x1Domain: Number(env.X1_DOMAIN), fromBlock: Number(env.FROM_BLOCK) };
const nowSec = () => Math.floor(Date.now() / 1000);

// R6-04 / R7-01: every task (mint, evidence, balance) has its own AbortController and budget (monitor-core runTask);
// the task's context travels with the async call chain (AsyncLocalStorage), so every RPC of a task gets that task's
// signal (plus its own time limit) and check() stops a task whose budget is spent, without touching the others.
const als = new AsyncLocalStorage();
const check = () => { const c = als.getStore(); if (c) c.check(); };
const rpcSignal = () => { const c = als.getStore(); return c ? AbortSignal.any([c.signal, AbortSignal.timeout(RPC_TIMEOUT)]) : AbortSignal.timeout(RPC_TIMEOUT); };
async function jrpc(url, method, params) {
  check();
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: rpcSignal() });
  const j = await r.json();
  if (j.error) throw new Error(`${new URL(url).host} ${method}: ${JSON.stringify(j.error).slice(0, 160)}`);
  return j.result;
}
const hex = (n) => "0x" + n.toString(16);
const finalizedOf = async (url) => { const b = await jrpc(url, "eth_getBlockByNumber", ["finalized", false]); return { number: parseInt(b.number, 16), timestamp: parseInt(b.timestamp, 16) }; };
async function logsOf(url, address, topics, from, to) {   // chunked; any error fails the whole read (no partial sets)
  const out = [];
  for (let f = from; f <= to; f += 9000) { out.push(...await jrpc(url, "eth_getLogs", [{ address, topics, fromBlock: hex(f), toBlock: hex(Math.min(f + 8999, to)) }])); check(); }
  return out;
}
async function programAccountsOf(url, program) {
  const r = await jrpc(url, "getProgramAccounts", [program, { encoding: "base64", commitment: "finalized", withContext: true }]);
  return { slot: r.context.slot, accounts: r.value.map((a) => ({ pubkey: a.pubkey, data: Buffer.from(a.account.data[0], "base64") })) };
}

const eth = {
  finalized: () => finalizedOf(env.ETH_RPC),
  blockTime: async (n) => parseInt((await jrpc(env.ETH_RPC, "eth_getBlockByNumber", [hex(n), false])).timestamp, 16),
  logs: (address, topics, from, to) => logsOf(LOGS_RPC, address, topics, from, to),
};
// R7-02: the second, independent Ethereum source scans on its own (null when not configured -> UNKNOWN)
const eth2 = env.ETH_LOGS_RPC2 ? { finalized: () => finalizedOf(env.ETH_LOGS_RPC2), logs: (address, topics, from, to) => logsOf(env.ETH_LOGS_RPC2, address, topics, from, to) } : null;
// R6-03: the oldest finalized signature of the account = the transaction that created it; its top-level AND inner
// (CPI) instructions are returned. "no-history" when the RPC has no (complete) signature history or transaction.
async function creationTxOf(url, pubkey) {
  let before, oldest = null, complete = false;
  for (let i = 0; i < 5; i++) {
    const s = await jrpc(url, "getSignaturesForAddress", [pubkey, { commitment: "finalized", limit: 1000, ...(before ? { before } : {}) }]);
    if (s.length) oldest = s[s.length - 1].signature;
    if (s.length < 1000) { complete = true; break; }
    before = oldest;
  }
  if (!oldest || !complete) return { status: "no-history" };
  const t = await jrpc(url, "getTransaction", [oldest, { encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
  if (!t) return { status: "no-history" };
  return { status: "ok", blockTime: t.blockTime, instructions: txInstructions(t) };
}
const x1 = {
  programAccounts: (program) => programAccountsOf(env.X1_RPC, program),
  slotTime: (slot) => jrpc(env.X1_RPC, "getBlockTime", [slot]),
  creationTx: (pubkey) => creationTxOf(env.X1_RPC, pubkey),
};

// R6-01: targeted confirmation of one ID in two independent sources per chain. A source that is not configured, fails,
// or is behind the primary read throws, and the candidate stays UNKNOWN.
const need = (url, name) => { if (!url) throw new Error(`${name} not configured (no second source)`); return url; };
async function ethHasId(topic, id, upTo) {
  return Promise.all([LOGS_RPC, need(env.ETH_LOGS_RPC2, "ETH_LOGS_RPC2")].map(async (url) => {
    const f = await finalizedOf(url);
    if (f.number < upTo) throw new Error(`${new URL(url).host} finalized ${f.number} is behind ${upTo}`);
    return (await logsOf(url, cfg.mailboxEth, [topic, id], cfg.fromBlock, f.number)).length > 0;
  }));
}
const confirm = {
  ethDispatched: (id, ctx) => ethHasId(T.DISPATCH_ID, id, ctx.ethFinalized),
  ethProcessed: (id, ctx) => ethHasId(T.PROCESS_ID, id, ctx.ethFinalized),
  x1Processed: (id) => Promise.all([env.X1_RPC, need(env.X1_RPC2, "X1_RPC2")].map(async (url) => {
    const r = await jrpc(url, "getAccountInfo", [processedMessagePda(id, cfg.x1Mailbox), { encoding: "base64", commitment: "finalized" }]);
    if (!r.value) return false;
    const k = mailboxAccount(Buffer.from(r.value.data[0], "base64"));
    return !!k && k.kind === "processed" && k.id === id;
  })),
  // R7-03: the processed message itself, read from the SECOND X1 source (its creating transaction, matched by ID)
  x1Message: async (id) => {
    const tx = await creationTxOf(need(env.X1_RPC2, "X1_RPC2"), processedMessagePda(id, cfg.x1Mailbox));
    if (tx.status !== "ok") throw new Error("X1_RPC2 has no history for this message");
    const m = findProcessedMessage(tx, cfg.x1Mailbox, id);
    if (!m) throw new Error("X1_RPC2: no InboxProcess with this ID");
    return parseMessage(m);
  },
  x1Dispatched: async (id, ctx) => {
    const snap = await programAccountsOf(need(env.X1_RPC2, "X1_RPC2"), cfg.x1Mailbox);
    if (snap.slot < ctx.x1Slot) throw new Error(`X1_RPC2 slot ${snap.slot} is behind ${ctx.x1Slot}`);
    return x1DispatchIds(snap.accounts, "0x" + b58dec(cfg.x1Program).toString("hex"), cfg.ethDomain).has(id);
  },
};

// The evidence state belongs to one configuration: chain ID, X1 genesis, route addresses, domains and FROM_BLOCK.
// A different fingerprint discards the state (full rescan). FROM_BLOCK must be the lockbox deployment block.
let verified = null;
async function verifyConfig() {
  if (verified) return verified;
  const ethUrls = [env.ETH_RPC, LOGS_RPC, ...(env.ETH_LOGS_RPC2 ? [env.ETH_LOGS_RPC2] : [])];
  const chainIds = await Promise.all(ethUrls.map(async (u) => parseInt(await jrpc(u, "eth_chainId", []), 16)));
  if (chainIds.some((c) => c !== cfg.ethDomain)) throw new Error(`chain ID ${chainIds.join("/")} != ETH_DOMAIN ${cfg.ethDomain}`);
  const genesis = await Promise.all([env.X1_RPC, ...(env.X1_RPC2 ? [env.X1_RPC2] : [])].map((u) => jrpc(u, "getGenesisHash", [])));
  if (new Set(genesis).size !== 1) throw new Error(`X1 RPCs on different chains (${genesis.join(" / ")})`);
  const before = await jrpc(LOGS_RPC, "eth_getCode", [cfg.lockbox, hex(cfg.fromBlock - 1)]);
  const at = await jrpc(LOGS_RPC, "eth_getCode", [cfg.lockbox, hex(cfg.fromBlock)]);
  if (before !== "0x" || at === "0x") throw new Error(`FROM_BLOCK ${cfg.fromBlock} is not the lockbox deployment block (code before: ${before !== "0x"}, at: ${at !== "0x"})`);
  verified = JSON.stringify({ chainId: cfg.ethDomain, genesis: genesis[0], lockbox: cfg.lockbox.toLowerCase(), mailboxEth: cfg.mailboxEth.toLowerCase(),
    x1Mailbox: cfg.x1Mailbox, x1Program: cfg.x1Program, x1Domain: cfg.x1Domain, fromBlock: cfg.fromBlock });
  return verified;
}

let evState = null, pendingState = null;
async function loadState() { try { evState = JSON.parse(await readFile(STATE_FILE, "utf8")); } catch { evState = null; } }
// R8-01: the cache write is separate from the result (state-writer.mjs): bounded in time, newest generation wins
const STATE_WRITE_TIMEOUT = Number(env.STATE_WRITE_TIMEOUT_S || 10) * 1000;
const stateWriter = createStateWriter({ file: STATE_FILE, timeoutMs: STATE_WRITE_TIMEOUT, fs: {
  writeAndSync: async (path, text) => { const f = await open(path, "w"); try { await f.writeFile(text); await f.sync(); } finally { await f.close(); } },
  rename, unlink } });
function saveStateInBackground(st) {
  stateWriter.write(st).then((r) => { if (r === "timeout" || r === "skipped") console.log(new Date().toISOString(), `evidence cache write ${r} (the published result is not affected)`); },
    (e) => console.log(new Date().toISOString(), `evidence cache write failed: ${e.message} (the published result is not affected)`));
}

const tick = createMonitor({
  mint: env.X1_MINT, maxActivityAge: Number(env.ACTIVITY_MAX_AGE || 300), nowSec, budget: BUDGET,
  withContext: (ctx, f) => als.run(ctx, f),
  // R6-04: the collector works on a COPY of the state; the copy is kept only when the evidence task finished inside its
  // budget (a task that was aborted can not hand over its copy, even if it resolves later)
  evidence: async (tctx) => {
    const fp = await verifyConfig();
    let work = evState && evState.fingerprint === fp ? structuredClone(evState) : null;
    if (!work) {
      if (evState) console.log(new Date().toISOString(), "evidence state belongs to another configuration: discarded, full rescan");
      work = newState(cfg.fromBlock, fp);
    }
    const r = await collectEvidence({ eth, eth2, x1, confirm, cfg, state: work, nowSec, check });
    tctx.check();
    pendingState = work;
    return r;
  },
  readLocked: async () => {
    const block = parseInt(await jrpc(env.ETH_RPC, "eth_blockNumber", []), 16);
    const data = "0x70a08231" + env.LOCKBOX.toLowerCase().replace("0x", "").padStart(64, "0");
    return { value: BigInt(await jrpc(env.ETH_RPC, "eth_call", [{ to: env.TOKEN, data }, hex(block)])), block };
  },
  readMint: async () => {
    const r = await jrpc(env.X1_RPC, "getAccountInfo", [env.X1_MINT, { encoding: "jsonParsed", commitment: "finalized" }]);
    const info = r.value.data.parsed.info;
    return { info, supply9: BigInt(info.supply), extensions: (info.extensions || []).map((e) => e.extension), slot: r.context.slot };
  },
  isDelivered: async (it) => {
    if (it.dir === "x2e") return BigInt(await jrpc(env.ETH_RPC, "eth_call", [{ to: env.ETH_MAILBOX, data: "0xe495f1d4" + it.id.slice(2) }, "latest"])) !== 0n;
    const r = await jrpc(env.X1_RPC, "getAccountInfo", [processedMessagePda(it.id, env.X1_MAILBOX), { encoding: "base64", commitment: "finalized", dataSlice: { offset: 0, length: 0 } }]);
    return r.value !== null;
  },
  readActivity: async () => {
    const src = env.ACTIVITY;
    if (/^https?:/.test(src)) { const r = await fetch(src + (src.includes("?") ? "&" : "?") + "t=" + Date.now(), { signal: rpcSignal() }); return r.json(); }
    return JSON.parse(await readFile(src, "utf8"));
  },
});

// R5-04 / R7-01: one tick at a time (the next starts POLL after the previous one has really ENDED); each task has its own
// budget inside the tick. Separate clocks: started / result / read ok / ok / last confirmed CRITICAL.
let last = { severity: "UNKNOWN", reasons: ["starting"] };
let startedAt = 0, running = false, resultAt = 0, readOkAt = 0, lastOkAt = 0, criticalAt = 0, unknownSince = 0, pollErrors = 0;
let evidenceOkAt = 0, evidenceBadSince = 0;
const taskTimeouts = { mint: 0, evidence: 0, balance: 0 };
async function poll() {
  startedAt = Date.now(); running = true; pendingState = null;
  try {
    last = await tick();
    for (const [k, v] of Object.entries(last.tasks || {})) if (v === "timeout") taskTimeouts[k]++;
  } catch (e) {
    last = { severity: "UNKNOWN", readOk: false, evidenceState: "failed", reasons: [`tick failed: ${e.message}`] };
  } finally { running = false; }
  // R8-01: the result and its timestamps are published FIRST; nothing below may wait on the disk
  resultAt = Date.now();
  if (last.readOk) readOkAt = resultAt; else pollErrors++;
  if (last.severity === "OK") lastOkAt = resultAt;
  if (last.severity === "CRITICAL") criticalAt = resultAt;
  if (last.severity === "UNKNOWN") { if (!unknownSince) unknownSince = resultAt; } else unknownSince = 0;
  if (last.evidenceState === "ok") { evidenceOkAt = resultAt; evidenceBadSince = 0; } else if (!evidenceBadSince) evidenceBadSince = resultAt;
  const v = (x) => (x === undefined ? "-" : x.toString()), ev = last.evidence;
  // tick=<T>: T = sec(resultAt) = vmpx_bridge_last_critical_timestamp of a CRITICAL tick = auto-pause incident crit-<T> (R11-06)
  console.log(new Date().toISOString(), last.severity, `tick=${sec(resultAt)}`, last.reasons.join("; ") || "-", "evidence", last.evidenceState || "-",
    "tasks", JSON.stringify(last.tasks || {}),
    ev ? `crit=${ev.critical.length} unconf=${ev.unconfirmed.length} div=${ev.diverged.length} wait=${ev.waiting} unres=${ev.unresolved} ethDisp=${ev.eth.dispatches}/${ev.eth.dispatches2} ethProc=${ev.eth.processes}/${ev.eth.processes2} x1Disp=${ev.x1.dispatches} x1Proc=${ev.x1.processed} full=${ev.full.running ? "at " + ev.full.next + "/" + ev.full.target : "done " + ev.full.doneAt}` : "-",
    "block", v(last.block), "slot", v(last.slot), "complete", v(last.complete), "delta", v(last.delta), "shortfall_s", v(last.shortfallSeconds),
    "tick_ms", resultAt - startedAt);
  // the evidence state of a finished collector is used at once by the next tick; the cache file is written in the
  // background (a hung or failed write is counted and logged, it never touches the result above)
  if (pendingState) { evState = pendingState; saveStateInBackground(pendingState); }
  pendingState = null;
}
async function loop() { await poll(); setTimeout(loop, POLL); }

const sec = (t) => Math.floor(t / 1000);
http.createServer((_, res) => {
  const sev = { OK: 0, WARN: 1, CRITICAL: 2, UNKNOWN: 3 }[last.severity];
  const g = (n, v) => [`# TYPE ${n} gauge`, `${n} ${v}`];
  const lines = [
    ...g("vmpx_bridge_severity", sev),
    ...g("vmpx_bridge_last_result_timestamp", sec(resultAt)),          // end of the last finished tick
    ...g("vmpx_bridge_last_attempt_timestamp", sec(startedAt)),        // start of the last tick (finished or running)
    ...g("vmpx_bridge_tick_running_seconds", running ? sec(Date.now() - startedAt) : 0),
    ...g("vmpx_bridge_last_read_ok_timestamp", sec(readOkAt)),
    ...g("vmpx_bridge_last_ok_timestamp", sec(lastOkAt)),
    ...g("vmpx_bridge_last_critical_timestamp", sec(criticalAt)),      // last tick that ENDED with confirmed evidence
    ...g("vmpx_bridge_unknown_seconds", unknownSince ? sec(Date.now() - unknownSince) : 0),
    ...g("vmpx_bridge_balance_shortfall_seconds", last.shortfallSeconds ?? 0),
    // R8-07: freshness of the balance observation is judged NOW, from the time the balances were actually read
    ...(() => { const f = balanceFreshness(last.balanceObservedAt, Math.floor(Date.now() / 1000)); return [
      ...g("vmpx_bridge_balance_alarm", last.balanceAlarm && !f.stale ? 1 : 0),   // R6-06: independent of the evidence state
      ...g("vmpx_bridge_balance_stale", f.stale ? 1 : 0),                         // R7-04 / R8-07: no observation for > 120 s
      ...g("vmpx_bridge_balance_observed_age_seconds", f.age ?? -1)]; })(),
    ...g("vmpx_bridge_evidence_ok", last.evidenceState === "ok" ? 1 : 0),       // R6-06: independent of balances
    ...g("vmpx_bridge_evidence_last_ok_timestamp", sec(evidenceOkAt)),
    ...g("vmpx_bridge_evidence_unknown_seconds", evidenceBadSince ? sec(Date.now() - evidenceBadSince) : 0),
    ...g("vmpx_bridge_index_complete", last.complete ? 1 : 0),
    `# TYPE vmpx_bridge_poll_errors_total counter`, `vmpx_bridge_poll_errors_total ${pollErrors}`,
    `# TYPE vmpx_bridge_state_write_errors_total counter`, `vmpx_bridge_state_write_errors_total ${stateWriter.stats.errors}`,
    `# TYPE vmpx_bridge_state_write_timeouts_total counter`, `vmpx_bridge_state_write_timeouts_total ${stateWriter.stats.timeouts}`,   // R8-01
    `# TYPE vmpx_bridge_state_write_skipped_total counter`, `vmpx_bridge_state_write_skipped_total ${stateWriter.stats.skipped}`,
    ...g("vmpx_bridge_state_writes_in_flight", stateWriter.inFlight),
    `# TYPE vmpx_bridge_task_timeouts_total counter`, ...Object.entries(taskTimeouts).map(([k, n]) => `vmpx_bridge_task_timeouts_total{task="${k}"} ${n}`),
    `# TYPE vmpx_bridge_task_ok gauge`, ...["mint", "evidence", "balance"].map((k) => `vmpx_bridge_task_ok{task="${k}"} ${(last.tasks || {})[k] === "ok" ? 1 : 0}`),
    ...g("vmpx_bridge_mint_check_ok", (last.tasks || {}).mint === "ok" ? 1 : 0),
  ];
  if (last.evidence) lines.push(...g("vmpx_bridge_evidence_critical", last.evidence.critical.length), ...g("vmpx_bridge_evidence_waiting", last.evidence.waiting),
    ...g("vmpx_bridge_evidence_unresolved", last.evidence.unresolved), ...g("vmpx_bridge_evidence_unconfirmed", last.evidence.unconfirmed.length),
    ...g("vmpx_bridge_evidence_sources_diverged", last.evidence.diverged.length), ...g("vmpx_bridge_evidence_second_source", last.evidence.secondSource ? 1 : 0),
    ...g("vmpx_bridge_evidence_full_scan_done_timestamp", last.evidence.full.doneAt));
  if (last.locked !== undefined) {
    const tok = (x) => Number(x / 10n ** 9n) / 1e9;
    lines.push(...g("vmpx_bridge_locked_tokens", tok(last.locked)), ...g("vmpx_bridge_circulating_tokens", tok(last.circulating)),
      ...g("vmpx_bridge_pending_e2x_tokens", tok(last.pendingE2X)), ...g("vmpx_bridge_pending_x2e_tokens", tok(last.pendingX2E)), ...g("vmpx_bridge_delta_tokens", tok(last.delta)));
  }
  res.writeHead(200, { "content-type": "text/plain" }).end(lines.join("\n") + "\n");
}).listen(Number(env.PORT || 9465), env.BIND || "127.0.0.1");

await loadState();
loop();
