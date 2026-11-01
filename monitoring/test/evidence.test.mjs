import { test } from "node:test";
import assert from "node:assert/strict";
import { collectEvidence, newState, T, MARGIN_S, OVERLAP_BLOCKS, FULL_CHUNK, keccak256, validTime, findProcessedMessage, txInstructions, parseMessage } from "../src/evidence.mjs";
import { b58dec, b58enc, processedMessagePda } from "../src/pda.mjs";

const cfg = { lockbox: "0x048C8208B0B37157FBbD71a737a34B1C5A00f6C8", mailboxEth: "0xmailbox", x1Mailbox: "74gG4yHE7DV4dU51GHrdX2z4BwtfuYQanSMizBTEjUk",
  x1Program: "8hA1rhuAuCr1HaWP9x66Ptua9gpqK5jS39LhmN4h41fR", ethDomain: 11155111, x1Domain: 1479626325, fromBlock: 100 };
const NOW = 100000;
const LOCKBOX32 = Buffer.from(cfg.lockbox.slice(2).padStart(64, "0"), "hex");
const PROGRAM32 = b58dec(cfg.x1Program);
const OTHER32 = Buffer.alloc(32, 7);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
let nonce = 0;
function msg({ origin, sender, destination, recipient, amount = 1n }) {
  const body = Buffer.concat([Buffer.alloc(32, 1), Buffer.from(amount.toString(16).padStart(64, "0"), "hex")]);
  return Buffer.concat([Buffer.from([3]), u32(++nonce), u32(origin), sender, u32(destination), recipient, body]);
}
const e2x = (amount) => msg({ origin: cfg.ethDomain, sender: LOCKBOX32, destination: cfg.x1Domain, recipient: PROGRAM32, amount });
const x2e = (amount) => msg({ origin: cfg.x1Domain, sender: PROGRAM32, destination: cfg.ethDomain, recipient: LOCKBOX32, amount });
const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const inbox = (m) => { const meta = Buffer.alloc(10); return Buffer.concat([Buffer.from([1]), le32(meta.length), meta, le32(m.length), m]); };
const T0 = 1.7e9;   // plausible unix times (validTime rejects anything before 2020)

// a small two-chain world the tests mutate; the second sources (confirm) follow the world unless overridden
function world() {
  const w = { fin: { number: 100, timestamp: T0 }, dispatchLogs: [], processLogs: [], blockTimes: {}, x1Slot: 500, x1SlotTime: T0,
    x1Accounts: [], txByPda: {}, logCalls: [], confirmOverride: {}, fin2: null, drop1: new Set(), drop2: new Set(), noEth2: false };
  const has = (logs, topic, id) => logs.some((l) => l.topics[0] === topic && l.topics[1] === id && parseInt(l.blockNumber, 16) <= w.fin.number);
  // logs of one source; `drop` holds IDs this source silently omits (both the main log and its ID log)
  const logsOf = (drop, calls) => async (_a, topics, from, to) => {
    calls && calls.push([topics[0], from, to]);
    const all = topics[0] === T.DISPATCH || topics[0] === T.DISPATCH_ID ? w.dispatchLogs : w.processLogs;
    return all.filter((l) => l.topics[0] === topics[0] && parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to && !drop.has(l.mid));
  };
  const eth = { finalized: async () => w.fin, blockTime: async (n) => w.blockTimes[n], logs: (...a) => logsOf(w.drop1, w.logCalls)(...a) };
  const eth2 = { finalized: async () => w.fin2 || w.fin, logs: (...a) => logsOf(w.drop2)(...a) };
  const x1 = { programAccounts: async () => ({ slot: w.x1Slot, accounts: w.x1Accounts }), slotTime: async () => w.x1SlotTime,
    creationTx: async (pda) => w.txByPda[pda] ?? { status: "no-history" } };
  const o = (k, f) => async (id, ctx) => { const v = w.confirmOverride[k]; if (v instanceof Error) throw v; if (v !== undefined) return v; return f(id, ctx); };
  const confirm = {
    ethDispatched: o("ethDispatched", (id) => [has(w.dispatchLogs, T.DISPATCH_ID, id), has(w.dispatchLogs, T.DISPATCH_ID, id)]),
    ethProcessed: o("ethProcessed", (id) => [has(w.processLogs, T.PROCESS_ID, id), has(w.processLogs, T.PROCESS_ID, id)]),
    x1Processed: o("x1Processed", (id) => { const e = w.x1Accounts.some((a) => a.pubkey === processedMessagePda(id, cfg.x1Mailbox)); return [e, e]; }),
    x1Dispatched: o("x1Dispatched", (id) => w.x1Accounts.some((a) => a.pubkey.startsWith("D") && a.id === id)),
    x1Message: o("x1Message", (id) => {
      const tx = w.txByPda[processedMessagePda(id, cfg.x1Mailbox)];
      const m = tx && tx.status === "ok" && findProcessedMessage(tx, cfg.x1Mailbox, id);
      if (!m) throw new Error("no history"); return parseMessage(m);
    }),
  };
  w.ethDispatch = (m, block, time) => {
    const id = keccak256(m), tx = "0x" + block.toString(16) + "d" + w.dispatchLogs.length;
    w.dispatchLogs.push({ mid: id, topics: [T.DISPATCH], blockNumber: "0x" + block.toString(16), transactionHash: tx, logIndex: "0x4" },
                        { mid: id, topics: [T.DISPATCH_ID, id], blockNumber: "0x" + block.toString(16), transactionHash: tx, logIndex: "0x5" });
    w.blockTimes[block] = time; return id;
  };
  w.ethProcess = (m, block, time) => {
    const id = keccak256(m), tx = "0x" + block.toString(16) + "p" + w.processLogs.length;
    w.processLogs.push({ mid: id, topics: [T.PROCESS, "0x1", "0x2"], blockNumber: "0x" + block.toString(16), transactionHash: tx, logIndex: "0x8" },
                       { mid: id, topics: [T.PROCESS_ID, id], blockNumber: "0x" + block.toString(16), transactionHash: tx, logIndex: "0x9" });
    w.blockTimes[block] = time; return id;
  };
  w.x1Dispatch = (m) => { const id = keccak256(m); w.x1Accounts.push({ pubkey: "D" + w.x1Accounts.length, id, data: Buffer.concat([Buffer.from([1]), Buffer.from("DISPATCH"), Buffer.alloc(4 + 8 + 32), m]) }); return id; };
  w.x1Process = (m, time, instructions) => {
    const id = keccak256(m), pda = processedMessagePda(id, cfg.x1Mailbox);
    w.x1Accounts.push({ pubkey: pda, data: Buffer.concat([Buffer.from([1]), Buffer.from("PROCESSD"), Buffer.alloc(8), Buffer.from(id.slice(2), "hex"), Buffer.alloc(8)]) });
    w.txByPda[pda] = { status: "ok", blockTime: time, instructions: instructions ?? [{ program: cfg.x1Mailbox, data: inbox(m) }] };
    return { id, pda };
  };
  return { w, run: (state, check) => collectEvidence({ eth, eth2: w.noEth2 ? undefined : eth2, x1, confirm, cfg, state, nowSec: () => T0 + NOW, check }) };
}
const st0 = () => newState(cfg.fromBlock, "fp");

test("validTime (R6-02): null, missing, NaN, negative, zero and future times are rejected", () => {
  const now = T0;
  for (const t of [null, undefined, NaN, -5, 0, 120, now + 3600, "1700000000", Infinity]) assert.equal(validTime(t, now), false, String(t));
  assert.equal(validTime(now - 10, now), true);
});

test("a) mint without lock: waiting before the margin, CRITICAL only when both sources per chain confirm", async () => {
  const { w, run } = world(); const st = st0();
  const { id } = w.x1Process(e2x(5n), T0 + 1000);
  w.fin = { number: 110, timestamp: T0 + 1000 + MARGIN_S - 1 };
  let r = await run(st);
  assert.equal(r.critical.length, 0); assert.equal(r.waiting, 1);
  w.fin = { number: 120, timestamp: T0 + 1000 + MARGIN_S + 1 };
  r = await run(st);
  assert.deepEqual(r.critical.map((c) => [c.kind, c.id]), [["mint-without-lock", id]]);
  assert.equal(r.unconfirmed.length, 0);
});

test("R6-01: a candidate the second ETH source contradicts (Dispatch found there) is UNKNOWN, never CRITICAL", async () => {
  const { w, run } = world(); const st = st0();
  w.x1Process(e2x(5n), T0 + 1000);
  w.fin = { number: 120, timestamp: T0 + 5000 };
  w.confirmOverride.ethDispatched = [false, true];      // the primary logs RPC missed the Dispatch, the second one has it
  const r = await run(st);
  assert.equal(r.critical.length, 0); assert.equal(r.unconfirmed.length, 1); assert.match(r.unconfirmed[0].reason, /disagree/);
});

test("R6-01: a missing or failing second source (no ETH_LOGS_RPC2, X1 RPC error) = unconfirmed", async () => {
  for (const [k, err] of [["ethDispatched", new Error("ETH_LOGS_RPC2 not configured (no second source)")], ["x1Processed", new Error("X1_RPC2: timeout")]]) {
    const { w, run } = world(); const st = st0();
    w.x1Process(e2x(5n), T0 + 1000); w.fin = { number: 120, timestamp: T0 + 5000 };
    w.confirmOverride[k] = err;
    const r = await run(st);
    assert.equal(r.critical.length, 0, k); assert.match(r.unconfirmed[0].reason, /confirmation failed/);
  }
});

test("R6-01: the X1 processed PDA missing on the second X1 RPC = unconfirmed", async () => {
  const { w, run } = world(); const st = st0();
  w.x1Process(e2x(5n), T0 + 1000); w.fin = { number: 120, timestamp: T0 + 5000 };
  w.confirmOverride.x1Processed = [true, false];
  assert.equal((await run(st)).unconfirmed.length, 1);
});

test("a) healthy deposit -> mint, any read order: never CRITICAL", async () => {
  const { w, run } = world(); const st = st0();
  const m = e2x(7n);
  w.x1Process(m, T0 + 1030);
  w.fin = { number: 104, timestamp: T0 + 990 };
  let r = await run(st);
  assert.equal(r.critical.length, 0); assert.equal(r.waiting, 1, "Dispatch not finalized yet: wait");
  w.ethDispatch(m, 105, T0 + 1000);
  w.fin = { number: 140, timestamp: T0 + 1030 + MARGIN_S + 600 };
  r = await run(st);
  assert.equal(r.critical.length, 0); assert.equal(r.waiting, 0);
});

test("b) unlock without burn: confirmed by both ETH sources and the second X1 list -> CRITICAL; burn on X1_RPC2 -> unconfirmed", async () => {
  const { w, run } = world(); const st = st0();
  const id = w.ethProcess(x2e(9n), 130, T0 + 3000);
  w.fin = { number: 130, timestamp: T0 + 3000 }; w.x1SlotTime = T0 + 3000 + MARGIN_S - 5;
  let r = await run(st);
  assert.equal(r.critical.length, 0); assert.equal(r.waiting, 1);
  w.x1SlotTime = T0 + 3000 + MARGIN_S + 5;
  r = await run(structuredClone(st));
  assert.deepEqual(r.critical.map((c) => [c.kind, c.id]), [["unlock-without-burn", id]]);
  w.confirmOverride.x1Dispatched = true;
  r = await run(structuredClone(st));
  assert.equal(r.critical.length, 0); assert.equal(r.unconfirmed.length, 1);
});

test("b) healthy burn -> unlock, any read order: never CRITICAL", async () => {
  const { w, run } = world(); const st = st0();
  const m = x2e(11n);
  w.ethProcess(m, 125, T0 + 3000);
  w.fin = { number: 125, timestamp: T0 + 3000 }; w.x1SlotTime = T0 + 2990;
  let r = await run(st);
  assert.equal(r.critical.length, 0, "old X1 snapshot: waiting");
  w.x1Dispatch(m); w.x1SlotTime = T0 + 9999;
  r = await run(st);
  assert.equal(r.critical.length, 0); assert.equal(r.waiting, 0);
});

test("an unfinalized Ethereum Process never enters the state (reorg-safe)", async () => {
  const { w, run } = world(); const st = st0();
  w.ethProcess(x2e(4n), 150, T0 + 3000);       // in block 150, finalized head is 140
  w.fin = { number: 140, timestamp: T0 + 2900 }; w.x1SlotTime = T0 + 9000;
  let r = await run(st);
  assert.equal(Object.keys(st.ethProcess).length, 0); assert.equal(r.critical.length + r.waiting, 0);
  w.processLogs.length = 0;                     // reorged away before finality: nothing stays behind
  w.fin = { number: 160, timestamp: T0 + 3100 };
  r = await run(st);
  assert.equal(Object.keys(st.ethProcess).length, 0); assert.equal(r.critical.length, 0);
});

test("R6-02: a Process in a block without a valid timestamp fails the pass (state not committed by the caller)", async () => {
  for (const bad of [null, NaN, -1, T0 + NOW + 99999]) {
    const { w, run } = world(); const st = st0();
    w.ethProcess(x2e(2n), 120, bad); w.fin = { number: 130, timestamp: T0 };
    await assert.rejects(run(st), /no valid timestamp/, String(bad));
  }
  const { w, run } = world();
  w.fin = { number: 130, timestamp: null };
  await assert.rejects(run(st0()), /finalized block 130 has no valid timestamp/);
  w.fin = { number: 130, timestamp: T0 }; w.x1SlotTime = undefined;
  await assert.rejects(run(st0()), /X1 slot 500 has no valid time/);
});

test("R6-02: an X1 transaction without a valid blockTime is unresolved (badTime), never evidence", async () => {
  for (const bad of [null, undefined, NaN, -100, T0 + NOW + 99999]) {
    const { w, run } = world(); const st = st0();
    w.x1Process(e2x(1n), bad); w.fin = { number: 150, timestamp: T0 + 99999 };
    const r = await run(st);
    assert.equal(r.critical.length + r.unconfirmed.length, 0, String(bad)); assert.equal(r.unresolvedBy.badTime, 1);
  }
});

test("R6-03: several InboxProcess in one transaction, the message is matched by ID (not the first one)", async () => {
  const { w, run } = world(); const st = st0();
  const other = msg({ origin: cfg.ethDomain, sender: OTHER32, destination: cfg.x1Domain, recipient: OTHER32 });
  const ours = e2x(8n);
  const { id } = w.x1Process(ours, T0 + 1000, [{ program: cfg.x1Mailbox, data: inbox(other) }, { program: cfg.x1Mailbox, data: inbox(ours) }]);
  w.fin = { number: 150, timestamp: T0 + 5000 };
  const r = await run(st);
  assert.equal(r.unresolved, 0); assert.deepEqual(r.critical.map((c) => c.id), [id]);
});

test("R6-03: InboxProcess called through CPI (inner instruction) is found", async () => {
  const m = e2x(6n), id = keccak256(m);
  const keys = ["Payer111111111111111111111111111111111111111", "Wrapper1111111111111111111111111111111111111", cfg.x1Mailbox];
  const t = { transaction: { message: { accountKeys: keys, instructions: [{ programIdIndex: 1, data: b58enc(Buffer.from([9, 9])) }] } },
    meta: { innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 2, data: b58enc(inbox(m)) }] }] } };
  const ixs = txInstructions(t);
  assert.equal(ixs.length, 2); assert.equal(ixs[1].program, cfg.x1Mailbox);
  assert.ok(findProcessedMessage({ instructions: ixs }, cfg.x1Mailbox, id), "found in the inner instruction");
  assert.equal(findProcessedMessage({ instructions: ixs.slice(0, 1) }, cfg.x1Mailbox, id), null);
  const { w, run } = world();
  w.x1Process(m, T0 + 1000, ixs); w.fin = { number: 150, timestamp: T0 + 5000 };
  const r = await run(st0());
  assert.equal(r.unresolved, 0); assert.equal(r.critical.length, 1);
});

test("R6-03: 'no history' (pruned RPC) and 'no matching instruction' are counted separately and retried", async () => {
  const { w, run } = world(); const st = st0();
  const a = e2x(1n), b = e2x(2n);
  const pa = w.x1Process(a, T0 + 1000).pda;
  w.x1Process(b, T0 + 1000, [{ program: cfg.x1Mailbox, data: inbox(e2x(3n)) }]);   // a transaction without this ID
  const tx = w.txByPda[pa]; delete w.txByPda[pa];
  let r = await run(st);
  assert.deepEqual(r.unresolvedBy, { noHistory: 1, noMatch: 1, badTime: 0 }); assert.equal(r.critical.length, 0);
  w.txByPda[pa] = tx; w.ethDispatch(a, 101, T0 + 900); w.fin = { number: 150, timestamp: T0 + 5000 };
  r = await run(st);
  assert.equal(r.unresolvedBy.noHistory, 0, "retried and matched");
});

test("messages to another recipient on the same X1 mailbox are ignored", async () => {
  const { w, run } = world(); const st = st0();
  w.x1Process(msg({ origin: cfg.ethDomain, sender: OTHER32, destination: cfg.x1Domain, recipient: OTHER32 }), T0);
  w.fin = { number: 200, timestamp: T0 + 99999 };
  const r = await run(st);
  assert.equal(r.critical.length + r.waiting + r.unresolved + r.unconfirmed.length, 0);
});

test("a processed message for our program from a foreign sender is CRITICAL once confirmed", async () => {
  const { w, run } = world(); const st = st0();
  w.x1Process(msg({ origin: cfg.ethDomain, sender: OTHER32, destination: cfg.x1Domain, recipient: PROGRAM32 }), T0);
  const r = await run(st);
  assert.equal(r.critical[0].kind, "mint-from-foreign-sender");
});

test("a processed ID with a finalized Dispatch needs no X1 transaction (pruned RPC history)", async () => {
  const { w, run } = world(); const st = st0();
  const m = e2x(3n); w.ethDispatch(m, 101, T0 + 900); w.x1Process(m, T0 + 1000);
  for (const k of Object.keys(w.txByPda)) delete w.txByPda[k];
  w.fin = { number: 150, timestamp: T0 + 5000 };
  const r = await run(st);
  assert.equal(r.unresolved + r.critical.length + r.waiting, 0);
});

test("cursor: every pass re-reads an overlap window, so a Dispatch the RPC returned late is still found", async () => {
  const { w, run } = world(); const st = st0();
  const m = e2x(5n);
  w.fin = { number: 1000, timestamp: T0 + 500 };
  await run(st);                                  // the RPC did not have the Dispatch in block 990 yet
  w.ethDispatch(m, 990, T0 + 400); w.x1Process(m, T0 + 450);
  w.fin = { number: 1010, timestamp: T0 + 9000 };
  w.logCalls.length = 0;
  const r = await run(st);
  assert.equal(r.critical.length + r.unconfirmed.length, 0, "the late Dispatch matched the mint");
  const [, from] = w.logCalls.find((c) => c[0] === T.DISPATCH);
  assert.equal(from, 1000 - OVERLAP_BLOCKS + 1);
});

test("a failed pass leaves the given state untouched when the caller works on a copy (cursor repair)", async () => {
  const { w, run } = world(); const st = st0();
  w.fin = { number: 1000, timestamp: T0 + 500 };
  await run(st);
  const before = JSON.stringify(st), work = structuredClone(st);
  w.ethProcess(x2e(1n), 1005, null); w.fin = { number: 1010, timestamp: T0 + 600 };
  await assert.rejects(run(work));
  assert.equal(JSON.stringify(st), before, "committed state unchanged; next pass starts from the old cursor");
});

test("an aborted tick stops at the next check and is not reported as unconfirmed", async () => {
  const { w, run } = world(); const st = st0();
  w.x1Process(e2x(5n), T0 + 1000); w.fin = { number: 120, timestamp: T0 + 5000 };
  // the tick is aborted while a confirmation RPC is running: the RPC fails, and the catch must re-throw the abort
  let aborted = false;
  const check = () => { if (aborted) throw Object.assign(new Error("tick time limit"), { name: "AbortError" }); };
  Object.defineProperty(w.confirmOverride, "x1Processed", { get() { aborted = true; return new Error("fetch aborted"); } });
  await assert.rejects(run(st, check), /tick time limit/);
});

test("newState carries the configuration fingerprint", () => {
  const s = newState(100, "abc");
  assert.equal(s.fingerprint, "abc"); assert.equal(s.ethDispatchTo, 99); assert.equal(s.ethProcessTo, 99);
});

// ---------- round E (Codex round 7) ----------
test("R7-02: the second source scans on its own - a Process it has and the primary silently skips is 'diverged', not hidden", async () => {
  const { w, run } = world(); const st = st0();
  const id = w.ethProcess(x2e(9n), 150, T0 + 100);
  w.drop1.add(id);                                   // primary RPC answers without error, but omits this log
  w.fin = { number: 1000, timestamp: T0 + 9000 }; w.x1SlotTime = T0 + 9000;
  const r = await run(st);
  assert.deepEqual(r.diverged.map((d) => [d.kind, d.id, d.only]), [["process", id, "ETH_LOGS_RPC2"]]);
  assert.equal(r.critical.length, 0, "the primary never saw it: no candidate, but UNKNOWN through 'diverged'");
});

test("R7-02: a log skipped >256 blocks back is repaired by the full review (no overlap limit) and then becomes evidence", async () => {
  const { w, run } = world(); const st = st0();
  const id = w.ethProcess(x2e(9n), 150, T0 + 100);   // an unlock with no burn on X1
  w.drop1.add(id);
  w.fin = { number: 1000, timestamp: T0 + 9000 }; w.x1SlotTime = T0 + 9000;
  let r = await run(st);
  assert.equal(r.diverged.length, 1);
  w.drop1.clear();                                   // the primary RPC is fixed, the log is now 850 blocks below its cursor
  w.fin = { number: 1300, timestamp: T0 + 9500 };
  r = await run(st);
  assert.equal(r.diverged.length, 1, "the 256-block overlap does not reach block 150; the full review has not restarted yet");
  assert.ok(150 < 1300 - OVERLAP_BLOCKS);
  st.full.doneAt = 0;                                // an hour later: the next full review from FROM_BLOCK
  r = await run(st);
  assert.equal(r.diverged.length, 0, "the full review read block 150 from both sources");
  assert.deepEqual(r.critical.map((c) => [c.kind, c.id]), [["unlock-without-burn", id]]);
});

test("R7-02: a Dispatch only the primary reports (the second source does not) is 'diverged'", async () => {
  const { w, run } = world(); const st = st0();
  const id = w.ethDispatch(e2x(4n), 120, T0 + 50);
  w.drop2.add(id);
  w.fin = { number: 400, timestamp: T0 + 9000 };
  const r = await run(st);
  assert.deepEqual(r.diverged.map((d) => [d.kind, d.only]), [["dispatch", "LOGS_RPC"]]);
});

test("R7-02: the full review advances in chunks (budget per pass) and records when it finished", async () => {
  const { w, run } = world(); const st = st0();
  w.fin = { number: cfg.fromBlock + 2 * FULL_CHUNK + 10, timestamp: T0 + 9000 };
  let r = await run(st);
  assert.equal(r.full.running, false, "an empty state: the first read from FROM_BLOCK is the full review, not repeated in the same pass");
  assert.equal(r.full.doneAt, T0 + NOW);
  st.full.doneAt = 0;                                // an hour later
  r = await run(st);
  assert.equal(r.full.running, true); assert.equal(r.full.next, cfg.fromBlock + FULL_CHUNK);
  r = await run(st); r = await run(st);
  assert.equal(r.full.running, false); assert.equal(r.full.doneAt, T0 + NOW);
});

test("R7-02: without a second Ethereum source the evidence is not complete (secondSource false)", async () => {
  const { w, run } = world(); const st = st0(); w.noEth2 = true;
  const r = await run(st);
  assert.equal(r.secondSource, false); assert.equal(r.diverged.length, 0);
});

test("R7-03: a foreign sender is CRITICAL even when Ethereum has a Dispatch with that ID (confirmed by both X1 sources)", async () => {
  const { w, run } = world(); const st = st0();
  const m = msg({ origin: cfg.ethDomain, sender: OTHER32, destination: cfg.x1Domain, recipient: PROGRAM32 });
  const { id } = w.x1Process(m, T0);
  w.dispatchLogs.push({ mid: id, topics: [T.DISPATCH_ID, id], blockNumber: "0x70", transactionHash: "0xother", logIndex: "0x1" });   // a public Dispatch by the foreign sender
  const r = await run(st);
  assert.deepEqual(r.critical.map((c) => [c.kind, c.id]), [["mint-from-foreign-sender", id]]);
});

test("R7-03: a foreign sender the second X1 source can not show (no history / other content) stays UNKNOWN", async () => {
  const { w, run } = world(); const st = st0();
  w.x1Process(msg({ origin: 999, sender: LOCKBOX32, destination: cfg.x1Domain, recipient: PROGRAM32 }), T0);
  w.confirmOverride.x1Message = new Error("X1_RPC2 has no history for this message");
  let r = await run(st);
  assert.equal(r.critical.length, 0); assert.match(r.unconfirmed[0].reason, /no history/);
  w.confirmOverride.x1Message = { id: "0x" + "00".repeat(32), origin: 999, sender: "0x", recipient: "0x" };   // different ID: not this message
  r = await run(st);
  assert.equal(r.critical.length, 0);
});
