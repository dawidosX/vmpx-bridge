// Evidence for automatic pause (docs/16-auto-pause-model.md). Matching is by Hyperlane MESSAGE ID only, never by
// balances:
//   a) a message processed on X1 for OUR token program whose ID is not a Dispatch of OUR lockbox on Ethereum (mint
//      without lock);
//   b) a Process on Ethereum to OUR lockbox whose ID is not a DISPATCH of OUR token program on X1 (unlock without burn).
// Round D (Codex round 6):
//  - R6-01: absence in a bulk read is only a CANDIDATE. A candidate becomes CRITICAL only when targeted reads of that
//    one ID in TWO independent sources per chain all agree (Ethereum: eth_getLogs by DispatchId/ProcessId topic = ID
//    from the deployment block, on two RPC providers; X1: the processed-message PDA read directly on two RPCs, and the
//    DISPATCH list of the second X1 RPC). Any error or disagreement = "unconfirmed" (UNKNOWN + alarm), never CRITICAL.
//  - R6-02: every timestamp must be a finite, plausible number; otherwise the item is unresolved (UNKNOWN).
//  - R6-03: the processed message is found by its ID in ALL top-level and inner (CPI) InboxProcess instructions;
//    "no history" (pruned RPC, no signature) and "no matching instruction" are reported separately.
//  - Ethereum processes are kept only from FINALIZED blocks (a reorged unfinalized Process can not stay in the state);
//    dispatches are rescanned with an overlap window, and the state is only committed by the caller after a finished
//    observation (collectEvidence works on the object it is given; the monitor passes a copy).
// Round E (Codex round 7):
//  - R7-02: the second Ethereum source (ETH_LOGS_RPC2) scans the lockbox's DispatchId and ProcessId logs ON ITS OWN, with
//    its own cursor; both sets are compared up to the lower of the two cursors and any difference is "diverged"
//    (UNKNOWN + alarm). A full review from FROM_BLOCK runs every FULL_SCAN_S in chunks of FULL_CHUNK blocks per pass
//    (both sources), so a log one source silently skipped is found however old it is (no 256-block repair limit).
//  - R7-03: a message processed for our program from another origin or sender is its own path: confirmed by the PDA on
//    both X1 RPCs and by the message content read from the SECOND X1 source; a Dispatch with that ID on Ethereum does
//    not matter.
// A genuine message always exists, finalized, before it is processed (validators sign finalized messages only), so once
// the other chain's finality is past the processing (+margin) a confirmed missing ID is not a timing effect.
import { keccak_256 } from "@noble/hashes/sha3.js";   // pinned in package.json / package-lock.json (integrity)
import { b58dec, b58enc, processedMessagePda } from "./pda.mjs";

/** keccak256(bytes) -> "0x" + 64 hex chars (Hyperlane message ID = keccak256 of the encoded message) */
export const keccak256 = (bytes) => "0x" + Buffer.from(keccak_256(Uint8Array.from(bytes))).toString("hex");

export const T = {
  DISPATCH: "0x769f711d20c679153d382254f59892613b58a97cc876b249134ac25c80f9c814",
  DISPATCH_ID: "0x788dbc1b7152732178210e7f4d9d010ef016f9eafbe66786bd7169f56e0c353a",
  PROCESS: "0x0d381c2a574ae8f04e213db7cfb4df8df712cdbd427d9868ffef380660ca6574",
  PROCESS_ID: "0x1cae38cdd3d3919489272725a5ae62a4f48b2989b0dae843d3c279fee18073a9",
};
export const MARGIN_S = 120;
export const OVERLAP_BLOCKS = 256;          // Ethereum incremental scans: every pass re-reads this many blocks below the cursor
export const FULL_SCAN_S = 3600;            // R7-02: a full review from FROM_BLOCK starts this often
export const FULL_CHUNK = 50000;            // R7-02: blocks of the full review per pass (both sources)
const word = (hex) => "0x" + hex.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** R6-02: a timestamp is usable only if it is a finite number between 2020 and now + 10 min */
export function validTime(t, nowSec) { return typeof t === "number" && Number.isFinite(t) && t > 1.6e9 && t < nowSec + 600; }

/** Hyperlane message: version 1 | nonce 4 | origin 4 | sender 32 | destination 4 | recipient 32 | body */
export function parseMessage(buf) {
  return { origin: buf.readUInt32BE(5), sender: "0x" + buf.subarray(9, 41).toString("hex"), destination: buf.readUInt32BE(41),
    recipient: "0x" + buf.subarray(45, 77).toString("hex"), id: keccak256(buf) };
}

/** InboxProcess instruction data (borsh): tag 1 | u32 len | metadata | u32 len | message -> message bytes, or null */
export function inboxProcessMessage(data) {
  try {
    if (data[0] !== 1) return null;
    const ml = data.readUInt32LE(1), o = 5 + ml, gl = data.readUInt32LE(o);
    if (o + 4 + gl > data.length) return null;
    return data.subarray(o + 4, o + 4 + gl);
  } catch { return null; }
}

/** mailbox account by fixed layout (1 byte initialized + 8-byte discriminator; see indexer/activity.py) */
export function mailboxAccount(d) {
  if (d.length < 9 || d[0] !== 1) return null;
  const disc = d.subarray(1, 9).toString("latin1");
  if (disc === "PROCESSD" && d.length >= 57) return { kind: "processed", id: "0x" + d.subarray(17, 49).toString("hex") };
  if (disc === "DISPATCH" && d.length >= 53) return { kind: "dispatch", message: d.subarray(53) };
  return null;
}

/** R6-03: the message with this ID among ALL top-level and inner instructions of the mailbox -> message or null */
export function findProcessedMessage(tx, mailbox, id) {
  for (const ix of tx.instructions) {
    if (ix.program !== mailbox) continue;
    const msg = inboxProcessMessage(ix.data);
    if (msg && keccak256(msg) === id) return msg;
  }
  return null;
}

/** all top-level and inner (CPI) instructions of a JSON-encoded transaction -> [{program, data}] (R6-03) */
export function txInstructions(t) {
  const keys = [...t.transaction.message.accountKeys, ...(t.meta?.loadedAddresses?.writable || []), ...(t.meta?.loadedAddresses?.readonly || [])];
  const ixs = [...t.transaction.message.instructions, ...(t.meta?.innerInstructions || []).flatMap((x) => x.instructions)];
  return ixs.map((ix) => ({ program: keys[ix.programIdIndex], data: b58dec(ix.data) }));
}

/** our token program's X1->ETH messages among mailbox accounts -> Set of IDs (cache by pubkey in `cache`) */
export function x1DispatchIds(accounts, programHex, ethDomain, cache = {}) {
  const ids = new Set();
  for (const a of accounts) {
    const k = mailboxAccount(a.data);
    if (!k || k.kind !== "dispatch") continue;
    let c = cache[a.pubkey];
    if (!c) { const m = parseMessage(k.message); c = cache[a.pubkey] = { id: m.id, ours: m.sender === programHex && m.destination === ethDomain }; }
    if (c.ours) ids.add(c.id);
  }
  return ids;
}

export function newState(fromBlock, fingerprint) {
  return { fingerprint, ethDispatchTo: fromBlock - 1, ethDispatch: {}, ethProcessTo: fromBlock - 1, ethProcess: {}, x1Processed: {}, x1DispatchByKey: {},
    eth2: { dispatchTo: fromBlock - 1, dispatch: {}, processTo: fromBlock - 1, process: {} }, full: { next: null, target: 0, doneAt: 0 } };
}

/** lockbox DispatchId and ProcessId logs of one source in [from, to] -> { dispatch: {id: block}, process: {id: block} } */
async function lockboxLogs(src, cfg, lockboxW, from, to, check) {
  const pair = async (main, idTopic) => {
    const ls = await src.logs(cfg.mailboxEth, main, from, to); check();
    const ids = await src.logs(cfg.mailboxEth, [idTopic], from, to); check();
    const idAt = new Map(ids.map((l) => [`${l.transactionHash}:${parseInt(l.logIndex, 16)}`, l.topics[1]]));
    const out = {};
    for (const l of ls) {
      const id = idAt.get(`${l.transactionHash}:${parseInt(l.logIndex, 16) + 1}`);
      if (!id) throw new Error(`log without its ID log in ${l.transactionHash}`);
      out[id] = parseInt(l.blockNumber, 16);
    }
    return out;
  };
  return { dispatch: await pair([T.DISPATCH, lockboxW], T.DISPATCH_ID), process: await pair([T.PROCESS, null, null, lockboxW], T.PROCESS_ID) };
}

/**
 * deps.eth:  { finalized() -> {number, timestamp}, logs(address, topics, from, to), blockTime(n) }
 * deps.eth2: { finalized(), logs() } of the second, independent Ethereum source (R7-02); missing = secondSource false (UNKNOWN)
 * deps.x1:   { programAccounts(program) -> {slot, accounts:[{pubkey, data}]}, slotTime(slot),
 *              creationTx(pubkey) -> {status: "ok", blockTime, instructions:[{program, data}]} | {status: "no-history"} }
 * deps.confirm (independent second sources, used only for candidates):
 *   { ethDispatched(id, ctx) -> [bool, bool], ethProcessed(id, ctx) -> [bool, bool], x1Processed(id, ctx) -> [bool, bool],
 *     x1Dispatched(id, ctx) -> bool, x1Message(id, ctx) -> parsed message from the second X1 source (R7-03) }   ctx = {ethFinalized, x1Slot}: a source behind these must throw (any throw = unconfirmed)
 * deps.check() is called between stages (throws when the tick was aborted).
 */
export async function collectEvidence({ eth, eth2, x1, confirm, cfg, state, nowSec, check = () => {} }) {
  const now = nowSec();
  const lockboxW = word(cfg.lockbox), programHex = "0x" + b58dec(cfg.x1Program).toString("hex");
  const fin = await eth.finalized(); check();
  if (!validTime(fin.timestamp, now)) throw new Error(`finalized block ${fin.number} has no valid timestamp`);

  // primary source: incremental, finalized range, re-reading an overlap window below the cursor
  const addPrimary = async (got) => {
    for (const [id, block] of Object.entries(got.dispatch)) state.ethDispatch[id] = block;
    for (const [id, block] of Object.entries(got.process)) {
      if (state.ethProcess[id]) continue;   // Process only from FINALIZED blocks (the scans never go past finalized)
      const time = await eth.blockTime(block); check();
      if (!validTime(time, now)) throw new Error(`block ${block} has no valid timestamp`);   // R6-02: the pass fails, the state is not committed
      state.ethProcess[id] = { block, time };
    }
  };
  const pFrom = Math.max(cfg.fromBlock, Math.min(state.ethDispatchTo, state.ethProcessTo) - OVERLAP_BLOCKS + 1);
  if (fin.number >= pFrom) {
    await addPrimary(await lockboxLogs(eth, cfg, lockboxW, pFrom, fin.number, check));
    state.ethDispatchTo = state.ethProcessTo = Math.max(state.ethDispatchTo, fin.number);
  }
  // R7-02: the second source scans on its own (own finalized head, own cursor)
  const e2 = state.eth2 || (state.eth2 = { dispatchTo: cfg.fromBlock - 1, dispatch: {}, processTo: cfg.fromBlock - 1, process: {} });
  const full = state.full || (state.full = { next: null, target: 0, doneAt: 0 });
  let fin2 = null;
  if (eth2) {
    fin2 = await eth2.finalized(); check();
    const sFrom = Math.max(cfg.fromBlock, Math.min(e2.dispatchTo, e2.processTo) - OVERLAP_BLOCKS + 1);
    if (fin2.number >= sFrom) {
      const got = await lockboxLogs(eth2, cfg, lockboxW, sFrom, fin2.number, check);
      Object.assign(e2.dispatch, got.dispatch); Object.assign(e2.process, got.process);
      e2.dispatchTo = e2.processTo = Math.max(e2.dispatchTo, fin2.number);
    }
    // R7-02: full review from FROM_BLOCK, a chunk per pass for both sources. When both sources have just read
    // everything from FROM_BLOCK in this pass (an empty state), that read IS the full review: not repeated now.
    if (full.next === null && pFrom === cfg.fromBlock && sFrom === cfg.fromBlock) full.doneAt = now;
    if (full.next === null && now - full.doneAt >= FULL_SCAN_S) { full.next = cfg.fromBlock; full.target = Math.min(fin.number, fin2.number); }
    if (full.next !== null) {
      const to = Math.min(full.next + FULL_CHUNK - 1, full.target);
      await addPrimary(await lockboxLogs(eth, cfg, lockboxW, full.next, to, check));
      const got = await lockboxLogs(eth2, cfg, lockboxW, full.next, to, check);
      Object.assign(e2.dispatch, got.dispatch); Object.assign(e2.process, got.process);
      if (to >= full.target) { full.next = null; full.doneAt = now; } else full.next = to + 1;
    }
  }
  // R7-02: both sources' sets compared up to the lower of the two cursors
  const diverged = [];
  if (eth2) {
    const upTo = Math.min(state.ethDispatchTo, e2.dispatchTo);
    const cmp = (kind, a, bm) => {
      for (const [id, blk] of Object.entries(a)) if (blk <= upTo && bm[id] === undefined) diverged.push({ kind, id, only: "LOGS_RPC" });
      for (const [id, blk] of Object.entries(bm)) if (blk <= upTo && a[id] === undefined) diverged.push({ kind, id, only: "ETH_LOGS_RPC2" });
    };
    cmp("dispatch", state.ethDispatch, e2.dispatch);
    cmp("process", Object.fromEntries(Object.entries(state.ethProcess).map(([id, p]) => [id, p.block])), e2.process);
  }

  // X1 mailbox accounts at finalized
  const snap = await x1.programAccounts(cfg.x1Mailbox); check();
  const slotTime = await x1.slotTime(snap.slot); check();
  if (!validTime(slotTime, now)) throw new Error(`X1 slot ${snap.slot} has no valid time`);
  const x1Dispatch = x1DispatchIds(snap.accounts, programHex, cfg.ethDomain, state.x1DispatchByKey);
  const unresolved = { noHistory: 0, noMatch: 0, badTime: 0 };
  for (const a of snap.accounts) {
    const k = mailboxAccount(a.data);
    if (!k || k.kind !== "processed" || state.x1Processed[k.id]) continue;
    if (processedMessagePda(k.id, cfg.x1Mailbox) !== a.pubkey) continue;
    // an ID that is a Dispatch of our lockbox is matched by content (the ID hashes the whole message)
    if (state.ethDispatch[k.id] !== undefined) { state.x1Processed[k.id] = { ours: true, matched: true }; continue; }
    const tx = await x1.creationTx(a.pubkey); check();
    if (!tx || tx.status !== "ok") { unresolved.noHistory++; continue; }
    const msg = findProcessedMessage(tx, cfg.x1Mailbox, k.id);
    if (!msg) { unresolved.noMatch++; continue; }
    if (!validTime(tx.blockTime, now)) { unresolved.badTime++; continue; }
    const m = parseMessage(msg);
    state.x1Processed[k.id] = { ours: m.recipient === programHex, origin: m.origin, sender: m.sender, time: tx.blockTime };
  }

  // candidates
  const candidates = [];
  let waiting = 0;
  for (const [id, p] of Object.entries(state.x1Processed)) {
    if (!p.ours || p.matched) continue;
    if (p.origin !== cfg.ethDomain || p.sender !== lockboxW) { candidates.push({ kind: "mint-from-foreign-sender", id }); continue; }
    if (state.ethDispatch[id] !== undefined) { p.matched = true; continue; }
    if (fin.timestamp > p.time + MARGIN_S) candidates.push({ kind: "mint-without-lock", id }); else waiting++;
  }
  for (const [id, p] of Object.entries(state.ethProcess)) {
    if (x1Dispatch.has(id)) continue;
    if (slotTime > p.time + MARGIN_S) candidates.push({ kind: "unlock-without-burn", id }); else waiting++;
  }

  // R6-01: targeted confirmation of every candidate in two independent sources per chain
  const critical = [], unconfirmed = [], ctx = { ethFinalized: fin.number, x1Slot: snap.slot };
  for (const c of candidates) {
    try {
      let ok;
      if (c.kind === "mint-from-foreign-sender") {
        // R7-03: the mint happened (PDA on both X1 RPCs) and the SECOND X1 source holds the same message (same ID = same
        // bytes) with another origin or sender; whether Ethereum has a Dispatch with this ID does not matter
        const [x1a, x1b] = await confirm.x1Processed(c.id, ctx); check();
        const m2 = await confirm.x1Message(c.id, ctx); check();
        ok = x1a === true && x1b === true && !!m2 && m2.id === c.id && m2.recipient === programHex && (m2.origin !== cfg.ethDomain || m2.sender !== lockboxW);
      } else if (c.kind === "unlock-without-burn") {
        const [p1, p2] = await confirm.ethProcessed(c.id, ctx); check();          // the unlock really happened (both ETH sources)
        const d2 = await confirm.x1Dispatched(c.id, ctx); check();                // and the second X1 source has no such burn
        ok = p1 === true && p2 === true && d2 === false;
      } else {
        const [x1a, x1b] = await confirm.x1Processed(c.id, ctx); check();          // the mint really happened (PDA on both X1 RPCs)
        const [e1, e2] = await confirm.ethDispatched(c.id, ctx); check();          // and no Dispatch with this ID on both ETH sources
        ok = x1a === true && x1b === true && e1 === false && e2 === false;
      }
      (ok ? critical : unconfirmed).push({ ...c, reason: ok ? "confirmed in two sources per chain" : "sources disagree" });
    } catch (e) { check(); unconfirmed.push({ ...c, reason: `confirmation failed: ${e.message}` }); }
  }
  const unres = unresolved.noHistory + unresolved.noMatch + unresolved.badTime;
  return { critical, unconfirmed, waiting, unresolved: unres, unresolvedBy: unresolved, diverged, secondSource: !!eth2,
    full: { running: full.next !== null, next: full.next, target: full.target, doneAt: full.doneAt },
    eth: { finalized: fin.number, dispatches: Object.keys(state.ethDispatch).length, processes: Object.keys(state.ethProcess).length,
      finalized2: fin2 && fin2.number, dispatches2: Object.keys(e2.dispatch).length, processes2: Object.keys(e2.process).length },
    x1: { slot: snap.slot, dispatches: x1Dispatch.size, processed: Object.values(state.x1Processed).filter((p) => p.ours).length } };
}

export { b58enc };
