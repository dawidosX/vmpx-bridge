// Page logic of v38 (community test round): node --test frontend/tests/core.test.mjs
// core.js and x1.js run in a vm context like in the browser (no network: fetch is faked where needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const www = join(dirname(fileURLToPath(import.meta.url)), "../www");
function load(files, extra = {}) {
  const ctx = { TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob, console, setTimeout, clearTimeout, BigInt, Uint8Array, DataView, Promise,
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, ...extra };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.addEventListener = () => {}; ctx.dispatchEvent = () => {};
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(join(www, f), "utf8"), ctx);
  return ctx;
}
const C = load(["core.js"]).BRIDGE_CORE;
const ID = "0x" + "ab".repeat(32), MIN = 60000;

test("FUN-03: tracking by message ID - delivered is done, late after the limit (still polling), else wait", () => {
  const lateMs = C.TRACK.e2xLateMs;
  assert.equal(lateMs, 20 * MIN);
  assert.equal(C.trackState({ delivered: true, startedAt: 0, now: 99 * MIN, lateMs }), "done");
  assert.equal(C.trackState({ delivered: false, startedAt: 0, now: 19 * MIN, lateMs }), "wait");
  assert.equal(C.trackState({ delivered: false, startedAt: 0, now: 21 * MIN, lateMs }), "late");
});

test("FUN-03: a v37 E->X1 record (balance tracking, the stuck 416-minute case) continues by its message ID", () => {
  const now = Date.now();
  const v37 = JSON.stringify({ r: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", base: "9798500000000", want: "4850000000000", t: now - 416 * MIN, tx: "0x" + "12".repeat(32), id: ID.toUpperCase().replace("0X", "0x") });
  const p = C.migratePending(v37, "e2x", now);
  assert.deepEqual({ ...p }, { dir: "e2x", id: ID, tx: "0x" + "12".repeat(32), t: now - 416 * MIN });
  assert.equal(C.trackState({ delivered: false, startedAt: p.t, now, lateMs: C.TRACK.e2xLateMs }), "late", "past the limit: says so instead of a running clock");
});

test("NET-05: pending records - no ID, garbage, too old or wrong format are dropped; X1 signatures kept", () => {
  const now = Date.now();
  assert.equal(C.migratePending(JSON.stringify({ r: "x", base: "1", want: "1", t: now }), "e2x", now), null, "v37 record without ID");
  assert.equal(C.migratePending("{not json", "e2x", now), null);
  assert.equal(C.migratePending(JSON.stringify({ id: ID, t: now - 4 * 24 * 60 * MIN }), "e2x", now), null, "older than 3 days");
  assert.equal(C.migratePending(JSON.stringify({ id: "0x12", t: now }), "x2e", now), null);
  const sig = "5".repeat(88);
  assert.equal(C.migratePending(JSON.stringify({ id: ID, sig, t: now }), "x2e", now).tx, sig);
  assert.equal(C.migratePending(JSON.stringify({ id: ID, sig: "<img src=x>", t: now }), "x2e", now).tx, null, "only well-formed hashes reach a link");
});

test("NET-04: any change of wallet account, network, recipient or amount voids the prepared operation", () => {
  const base = { dir: "e2x", account: "0xAbC", chainId: "0xaa36a7", x1: "X1addr", amount: 5n, rcpt: "R" };
  const k = C.opKey(base);
  assert.equal(C.opKey({ ...base, account: "0xabc" }), k, "address case does not matter");
  for (const ch of [{ account: "0xdef" }, { chainId: "0x1" }, { x1: "other" }, { amount: 6n }, { rcpt: "S" }, { dir: "x2e" }])
    assert.notEqual(C.opKey({ ...base, ...ch }), k, JSON.stringify(ch, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
});

test("NET-04: checks right before each signature", () => {
  const ok = { dir: "e2x", chainId: "0xaa36a7", wantChainId: "0xaa36a7", account: "0xa", prepared: 3, current: 3, balance: 10n, amount: 5n, fee: 300n, feeShown: 300n };
  assert.deepEqual([...C.preSignProblems(ok)], []);
  assert.deepEqual([...C.preSignProblems({ ...ok, chainId: "0x1" })], ["wrongChain"]);
  assert.deepEqual([...C.preSignProblems({ ...ok, account: null })], ["noAccount"]);
  assert.deepEqual([...C.preSignProblems({ ...ok, current: 4 })], ["changed"], "account/network changed since the send started");
  assert.deepEqual([...C.preSignProblems({ ...ok, balance: 4n })], ["balance"]);
  assert.deepEqual([...C.preSignProblems({ ...ok, balance: null })], ["balance"], "unknown balance is not enough");
  assert.deepEqual([...C.preSignProblems({ ...ok, fee: 400n })], ["fee"]);
  assert.deepEqual([...C.preSignProblems({ ...ok, dir: "x2e", chainId: "0x1", fee: undefined, feeShown: undefined })], [], "X1 direction: no EVM chain check");
});

test("NET-03: X1 wallet accounts must be solana:* with a 32-byte key (an Ethereum account of a multi-chain wallet is refused)", () => {
  const key = new Uint8Array(32).fill(7);
  assert.equal(C.x1AccountProblem({ chains: ["solana:testnet"], publicKey: key }), null);
  assert.equal(C.x1AccountProblem({ chains: ["eip155:1"], publicKey: new Uint8Array(20) }), "notSolana");
  assert.equal(C.x1AccountProblem({ chains: [], publicKey: key }), "notSolana");
  assert.equal(C.x1AccountProblem({ chains: ["solana:mainnet"], publicKey: new Uint8Array(33) }), "badKey");
  assert.equal(C.x1AccountProblem(null), "noAccount");
  assert.equal(C.x1SignChain({ chains: ["eip155:1", "solana:mainnet", "solana:testnet"] }), "solana:testnet");
  assert.equal(C.x1SignChain({ chains: ["eip155:1"] }), null, "never an EVM chain for an X1 signature");
});

test("SEC-10: approve is exactly the amount, only when the allowance is short, never unlimited", () => {
  assert.equal(C.approveAmount(0n, 5n * 10n ** 18n), 5n * 10n ** 18n);
  assert.equal(C.approveAmount(5n * 10n ** 18n, 5n * 10n ** 18n), null);
  assert.equal(C.approveAmount(10n ** 30n, 1n), null);
  assert.throws(() => C.approveAmount(0n, 0n));
  const app = fs.readFileSync(join(www, "app.js"), "utf8");
  assert.ok(!/f{64}|MaxUint|2n \*\* 256n|MAX_UINT/i.test(app), "no unlimited allowance anywhere in app.js");
  assert.match(app, /CORE\.approveAmount\(allowance, op\.v18\)/, "the approve goes through approveAmount with the frozen amount");
});

test("NET-06: one send at a time", () => {
  const l = C.sendLock();
  assert.equal(l.acquire(), true);
  assert.equal(l.acquire(), false, "second click while the first send runs");
  l.release();
  assert.equal(l.acquire(), true);
});

test("FUN-03/05: default recipient is the own address on the destination chain; a typed address is kept", () => {
  const w = { ethAccount: "0xE", x1Address: "X1A" };
  assert.equal(C.defaultRecipient({ dir: "e2x", ...w, current: "", edited: false }), "X1A");
  assert.equal(C.defaultRecipient({ dir: "x2e", ...w, current: "", edited: false }), "0xE");
  assert.equal(C.defaultRecipient({ dir: "e2x", ...w, current: "Other", edited: true }), "Other");
  assert.equal(C.defaultRecipient({ dir: "e2x", ethAccount: "0xE", x1Address: null, current: "X1A", edited: false }), "", "own X1 wallet disconnected: no stale own address");
});

test("FUN-01: ETH gas warning = delivery quote + 0.0002 ETH", () => {
  const q = 10n ** 15n;
  assert.equal(C.ethGasShort(q + C.ETH_GAS_RESERVE - 1n, q), true);
  assert.equal(C.ethGasShort(q + C.ETH_GAS_RESERVE, q), false);
  assert.equal(C.ethGasShort(null, q), false, "unknown balance: no warning");
  assert.equal(C.xntShort(5n, 6n), true); assert.equal(C.xntShort(6n, 6n), false);
});

test("NET-08: send errors - rejected / rpc (nothing sent) / unknown (maybe sent, no re-send) / failed", () => {
  assert.equal(C.sendErrorClass({ code: 4001, message: "User rejected the request." }, { sent: false }), "rejected");
  assert.equal(C.sendErrorClass(new Error("RPC: Failed to fetch"), { sent: false }), "rpc");
  assert.equal(C.sendErrorClass(new Error("RPC: Failed to fetch"), { sent: true }), "unknown");
  assert.equal(C.sendErrorClass(new Error("receipt-timeout"), { sent: true }), "unknown");
  assert.equal(C.sendErrorClass(new Error("Transaction reverted"), { sent: true }), "failed");
  assert.equal(C.sendErrorClass(new Error("tx-failed: {}"), { sent: true }), "failed");
  assert.equal(C.sendErrorClass(new Error("sign-timeout"), { sent: false }), "failed", "FUN-05: not an RPC outage, the page offers to reconnect");
  assert.equal(C.sendErrorClass(new Error("wrong-network"), { sent: false }), "failed");
});

test("R7-06: operation record - future, malformed, foreign-format records are refused", () => {
  const now = Date.now(), from = "0xA2Ee625f663A0f1D884dEf2A309fcb2764d960Ea", tx = "0x" + "11".repeat(32);
  const ok = { v: 1, dir: "e2x", from, to: "X", amount: "1", t: now, hb: now, stage: "sent", tx, id: null };
  assert.equal(C.readOp(JSON.stringify(ok), now).stage, "sent");
  assert.equal(C.readOp(JSON.stringify({ ...ok, t: now + 5 * MIN }), now), null, "timestamp from the future");
  assert.equal(C.readOp(JSON.stringify({ ...ok, hb: now + 5 * MIN }), now), null, "heartbeat from the future");
  assert.equal(C.readOp(JSON.stringify({ ...ok, tx: "5".repeat(88) }), now), null, "an X1 signature in an Ethereum record");
  assert.equal(C.readOp(JSON.stringify({ ...ok, from: "3ZwnRJXxvDqYZdrU8N6mfRPfRhnHDryARi5AuR39sW5u" }), now), null, "X1 sender in an Ethereum record");
  assert.equal(C.readOp(JSON.stringify({ ...ok, stage: "tracking" }), now), null, "tracking needs a message ID");
  assert.equal(C.readOp(JSON.stringify({ ...ok, stage: "sent", tx: null }), now), null, "sent needs a hash");
  assert.equal(C.readOp(JSON.stringify({ ...ok, stage: "unknown", tx: null }), now).stage, "unknown", "unknown without a hash (wallet call cut off)");
  assert.equal(C.readOp(JSON.stringify({ ...ok, v: 2 }), now), null);
  assert.equal(C.readOp("{", now), null);
});

test("R7-06: a send is blocked while signing (live heartbeat), sent or unknown; a dead signing tab turns into unknown", () => {
  const now = Date.now(), base = { v: 1, dir: "x2e", from: "3ZwnRJXxvDqYZdrU8N6mfRPfRhnHDryARi5AuR39sW5u", t: now - 60000, stage: "signing", tx: null, id: null };
  assert.equal(C.opState({ ...base, hb: now - 3000 }, now), "signing");
  assert.equal(C.opState({ ...base, hb: now - 30000 }, now), "unknown", "the signing tab was closed: the wallet may have sent");
  for (const st of ["signing", "sent", "unknown"]) assert.equal(C.opBlocks({ ...base, hb: now, stage: st }, now), true, st);
  assert.equal(C.opBlocks({ ...base, hb: now, stage: "tracking", id: ID }, now), false, "a confirmed transfer in delivery does not block");
  assert.equal(C.opBlocks(null, now), false);
});

test("item 9: a record only counts for the wallet that sent it", () => {
  const e = { dir: "e2x", from: "0xA2Ee625f663A0f1D884dEf2A309fcb2764d960Ea" }, x = { dir: "x2e", from: "3ZwnRJXxvDqYZdrU8N6mfRPfRhnHDryARi5AuR39sW5u" };
  assert.equal(C.ownsOp(e, "0xa2ee625f663a0f1d884def2a309fcb2764d960ea"), true);
  assert.equal(C.ownsOp(e, "0x8c99d5e9023c15dBdBa99b87D0327d61e69B31d8"), false);
  assert.equal(C.ownsOp(x, "3ZwnRJXxvDqYZdrU8N6mfRPfRhnHDryARi5AuR39sW5u"), true);
  assert.equal(C.ownsOp(x, "3zwnrjxxvdqyzdru8n6mfrpfrhnhdryari5aur39sw5u"), false, "base58 is case-sensitive");
  assert.equal(C.ownsOp(e, null), false, "no wallet connected: nothing is shown");
});

test("R7-08: an X1 fee preview is valid for 60 s; a rise over 10% and 0.001 XNT needs a new click", () => {
  const now = Date.now();
  assert.equal(C.quoteFresh({ at: now - 59000 }, now), true);
  assert.equal(C.quoteFresh({ at: now - 61000 }, now), false);
  assert.equal(C.quoteFresh({}, now), false, "a preview without a time is not fresh");
  assert.equal(C.feeRose(52_000_000n, 56_000_000n), false, "+7.7%");
  assert.equal(C.feeRose(52_000_000n, 60_000_000n), true, "+15%, +0.008 XNT");
  assert.equal(C.feeRose(5_000_000n, 5_900_000n), false, "+18% but under 0.001 XNT");
});

test("R7-07: expired / unknown are not failures; our pre-broadcast codes are", () => {
  assert.equal(C.sendErrorClass(new Error("expired"), { sent: true }), "unknown");
  assert.equal(C.sendErrorClass(new Error("unknown"), { sent: true }), "unknown");
  assert.equal(C.sendErrorClass(new Error("changed"), { sent: false }), "failed");
});

test("FUN-05: a wallet window that never answers ends with sign-timeout", async () => {
  await assert.rejects(C.withTimeout(new Promise(() => {}), 50, "sign-timeout"), /sign-timeout/);
  assert.equal(await C.withTimeout(Promise.resolve(7), 50, "x"), 7);
});

// ---------- x1.js (needs the vendored web3.js) ----------
function loadX1(fetchImpl) {
  return load(["core.js", "vendor/solana-web3-1.98.4.iife.min.js", "x1.js"], { fetch: fetchImpl || (async () => { throw new Error("no network in tests"); }) });
}
const rpcFake = (answers) => async (_u, o) => { const { method } = JSON.parse(o.body); const r = answers[method]; return { json: async () => (typeof r === "function" ? r() : { result: r }) }; };

test("NET-03: the X1 connect refuses an Ethereum account and accepts a Solana one", async () => {
  const ctx = loadX1(); const X = ctx.X1BRIDGE;
  const wallet = (acc) => ({ accounts: [acc], features: { "standard:connect": { connect: async () => ({ accounts: [acc] }) } } });
  await assert.rejects(X.connect(wallet({ chains: ["eip155:11155111"], publicKey: new Uint8Array(20) })), /x1-notSolana/);
  const pk = ctx.solanaWeb3.Keypair.generate().publicKey;
  const c = await X.connect(wallet({ chains: ["solana:testnet"], publicKey: pk.toBytes() }));
  assert.equal(c.address, pk.toBase58());
});

test("NET-03: before signing, the X1 RPC must be X1 testnet (genesis) with our mint and program", async () => {
  const good = { getGenesisHash: "C7ucgdDEhxLTpXHhWSZxavSVmaNTUJWwT5iTdeaviDho", getAccountInfo: { value: { owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", executable: true } } };
  await loadX1(rpcFake(good)).X1BRIDGE.checkNetwork();
  await assert.rejects(loadX1(rpcFake({ ...good, getGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" })).X1BRIDGE.checkNetwork(), /wrong-network/);
  await assert.rejects(loadX1(rpcFake({ ...good, getAccountInfo: { value: null } })).X1BRIDGE.checkNetwork(), /wrong-network/);
});

test("FUN-03: the processed-message PDA of x1.js equals the monitor's (same seeds as the X1 mailbox)", async () => {
  const { processedMessagePda } = await import("../../monitoring/src/pda.mjs");
  const X = loadX1().X1BRIDGE;
  for (const id of [ID, "0x" + "00".repeat(31) + "01"]) assert.equal(X.processedPda(id).toBase58(), processedMessagePda(id, "74gG4yHE7DV4dU51GHrdX2z4BwtfuYQanSMizBTEjUk"));
});

test("R7-05/06/07: x1.js send - check() before the wallet and after the signature, onSigned before broadcast, expiry reconciled to UNKNOWN", async () => {
  const calls = [];
  let height = 5;
  const answers = {
    getGenesisHash: "C7ucgdDEhxLTpXHhWSZxavSVmaNTUJWwT5iTdeaviDho",
    getAccountInfo: { value: { owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", executable: true } },
    getLatestBlockhash: { value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 10 } },
    sendTransaction: () => { calls.push("broadcast"); return { result: "x" }; },
    getSignatureStatuses: { value: [null] },
    getBlockHeight: () => ({ result: (height += 10) }),
  };
  const ctx = loadX1(rpcFake(answers)); const X = ctx.X1BRIDGE, W = ctx.solanaWeb3;
  const kp = W.Keypair.generate();
  const acc = { publicKey: kp.publicKey.toBytes(), chains: ["solana:testnet"] };
  const wallet = { features: { "solana:signTransaction": { signTransaction: async ({ transaction }) => {
    calls.push("wallet"); const tx = W.Transaction.from(transaction); tx.partialSign(kp); return [{ signedTransaction: tx.serialize({ requireAllSignatures: false }) }];
  } } } };
  ctx.setTimeout = (f) => setTimeout(f, 0);   // no real waiting in the reconcile loop
  const conn = { wallet, account: acc, address: kp.publicKey.toBase58() };
  let signedSig = null;
  await assert.rejects(X.send({ conn, recipientEth: "0x" + "11".repeat(20), amount9: 1n, steps: () => {},
    check: () => calls.push("check"), onSigned: (sig, lastValid) => { signedSig = sig; calls.push("onSigned:" + lastValid); } }),
    (e) => e.message === "unknown" && e.signature === signedSig);
  assert.deepEqual(calls.slice(0, 5), ["check", "wallet", "check", "onSigned:10", "broadcast"], "check before the wallet and after it; persisted before the first broadcast");
  assert.equal(C.sendErrorClass(new Error("unknown"), { sent: true }), "unknown", "the page shows UNKNOWN with the signature, never failed");
});

test("R7-05: a failing check() after the signature stops the X1 send before any broadcast", async () => {
  const sent = [];
  const answers = { getGenesisHash: "C7ucgdDEhxLTpXHhWSZxavSVmaNTUJWwT5iTdeaviDho", getAccountInfo: { value: { owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", executable: true } },
    getLatestBlockhash: { value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 10 } }, sendTransaction: () => { sent.push(1); return { result: "x" }; } };
  const ctx = loadX1(rpcFake(answers)); const X = ctx.X1BRIDGE, W = ctx.solanaWeb3, kp = W.Keypair.generate();
  let n = 0;
  const wallet = { features: { "solana:signTransaction": { signTransaction: async ({ transaction }) => { const tx = W.Transaction.from(transaction); tx.partialSign(kp); return [{ signedTransaction: tx.serialize({ requireAllSignatures: false }) }]; } } } };
  await assert.rejects(X.send({ conn: { wallet, account: { publicKey: kp.publicKey.toBytes(), chains: ["solana:testnet"] }, address: kp.publicKey.toBase58() },
    recipientEth: "0x" + "11".repeat(20), amount9: 1n, steps: () => {}, check: () => { if (++n === 2) throw new Error("changed"); } }), /changed/);
  assert.equal(sent.length, 0, "nothing broadcast after the account changed during the signature");
});

test("R7-05: app.js uses opKey() for the frozen operation and sends FROM the frozen account", () => {
  const app = fs.readFileSync(join(www, "app.js"), "utf8");
  assert.match(app, /return CORE\.opKey\(/, "currentKey() is built with core opKey()");
  assert.match(app, /currentKey\(\) !== op\.key/, "guardOp compares the frozen key");
  assert.match(app, /params: \[\{ from: op\.from, \.\.\.tx \}\]/, "eth_sendTransaction from the frozen account, not S.account");
  assert.doesNotMatch(app, /from: S\.account, \.\.\.tx/);
});

test("R8-02/R8-03: a record keeps its opId, owner and revision; sameOp compares identity and revision", () => {
  const now = Date.now(), base = { v: 1, dir: "e2x", from: "0xA2Ee625f663A0f1D884dEf2A309fcb2764d960Ea", t: now, hb: now, stage: "sent", tx: "0x" + "11".repeat(32), id: null, opId: "ab".repeat(16), owner: "cd".repeat(8), rev: 3 };
  const r = C.readOp(JSON.stringify(base), now);
  assert.equal(r.opId, base.opId); assert.equal(r.owner, base.owner); assert.equal(r.rev, 3);
  assert.equal(C.readOp(JSON.stringify({ ...base, opId: "<x>" }), now).opId, null, "a malformed opId is dropped (the page re-identifies the record)");
  assert.equal(C.sameOp(r, { ...r }), true);
  assert.equal(C.sameOp(r, { ...r, rev: 2 }), false, "an older revision: the late caller must not write");
  assert.equal(C.sameOp(r, { ...r, opId: "ef".repeat(16) }), false, "another operation (R8-03: a late reconcile of A must not touch B)");
  assert.equal(C.sameOp({ ...r, opId: null }, { ...r, opId: null }), false, "no identity, no write");
  assert.match(C.newId(), /^[0-9a-f]{32}$/);
});

function x1With(seq) {
  // getSignatureStatuses answers from `seq` one by one (the last one repeats)
  let i = 0; const sent = [];
  const answers = { getGenesisHash: "C7ucgdDEhxLTpXHhWSZxavSVmaNTUJWwT5iTdeaviDho", getAccountInfo: { value: { owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", executable: true } },
    getLatestBlockhash: { value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 10 ** 9 } }, sendTransaction: () => { sent.push(1); return { result: "x" }; },
    getSignatureStatuses: () => ({ result: { value: [seq[Math.min(i++, seq.length - 1)]] } }), getBlockHeight: { result: 1 },
    getTransaction: { result: null } };
  const ctx = loadX1(rpcFake(answers)); ctx.setTimeout = (f) => setTimeout(f, 0);
  const W = ctx.solanaWeb3, kp = W.Keypair.generate();
  const wallet = { features: { "solana:signTransaction": { signTransaction: async ({ transaction }) => { const tx = W.Transaction.from(transaction); tx.partialSign(kp); return [{ signedTransaction: tx.serialize({ requireAllSignatures: false }) }]; } } } };
  const conn = { wallet, account: { publicKey: kp.publicKey.toBytes(), chains: ["solana:testnet"] }, address: kp.publicKey.toBase58() };
  return { X: ctx.X1BRIDGE, conn, sent };
}
test("item 8: X1 - an error seen at 'confirmed' is not final; failure only when FINALIZED with an error", async () => {
  const { X, conn } = x1With([{ confirmationStatus: "confirmed", err: { InstructionError: [0, "x"] } }, { confirmationStatus: "confirmed", err: { InstructionError: [0, "x"] } }, { confirmationStatus: "finalized", err: { InstructionError: [0, "x"] } }]);
  await assert.rejects(X.send({ conn, recipientEth: "0x" + "11".repeat(20), amount9: 1n, steps: () => {} }), /tx-failed/);
});
test("item 8: X1 - success only when FINALIZED ('confirmed' keeps waiting)", async () => {
  const { X, conn } = x1With([{ confirmationStatus: "confirmed", err: null }, { confirmationStatus: "confirmed", err: null }, { confirmationStatus: "finalized", err: null }]);
  const r = await X.send({ conn, recipientEth: "0x" + "11".repeat(20), amount9: 1n, steps: () => {} });
  assert.ok(r.signature, "finalized: success");
});
test("item 8: X1 reconcile - confirmed is 'pending', not ok or failed", async () => {
  const { X } = x1With([{ confirmationStatus: "confirmed", err: { x: 1 } }]);
  const r = await X.reconcile("5".repeat(88), 2);
  assert.equal(r.status, "pending");
});
test("R8-02: the send handlers run under an exclusive Web Lock; without Web Locks sending is refused", () => {
  const app = fs.readFileSync(join(www, "app.js"), "utf8");
  assert.match(app, /navigator\.locks\.request\(SEND_LOCK, \{ mode: "exclusive", ifAvailable: true \}/);
  assert.match(app, /withSendLock\(sendE2X\)/); assert.match(app, /withSendLock\(sendX2E\)/);
  assert.match(app, /if \(!\(navigator\.locks && navigator\.locks\.request\)\)/);
});

test("R9-03: keccak256 of core.js equals @noble/hashes (the page recomputes message IDs)", async () => {
  let noble = null; try { noble = (await import("../../monitoring/node_modules/@noble/hashes/sha3.js")).keccak_256; } catch {}
  assert.equal(C.keccak256(new Uint8Array(0)), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(C.keccak256(new TextEncoder().encode("abc")), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  if (noble) for (const n of [1, 77, 135, 136, 137, 141, 300]) { const b = crypto.getRandomValues(new Uint8Array(n)); assert.equal(C.keccak256(b), "0x" + Buffer.from(noble(b)).toString("hex"), `len ${n}`); }
});

// a fake finalized X1 transaction + DISPATCH account for verifyX2E
function x2eWorld({ forgeLogOnly = false, senderOverride = null, amountBody = null, cpi = false, accountInfo = null } = {}) {
  const base = loadX1(); const W = base.solanaWeb3, X0 = base.X1BRIDGE;
  const user = W.Keypair.generate().publicKey.toBase58(), prog = X0.C.program.toBase58(), mailbox = X0.C.mailbox.toBase58();
  const dispatched = W.Keypair.generate().publicKey.toBase58(), other = W.Keypair.generate().publicKey.toBase58();
  const rcpt = "0x" + "22".repeat(20), amount9 = 5n;
  const ixData = X0.instructionData(rcpt, amount9);
  const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const body = Buffer.concat([Buffer.from(rcpt.slice(2).padStart(64, "0"), "hex"), Buffer.from((amountBody ?? amount9 * 10n ** 9n).toString(16).padStart(64, "0"), "hex")]);
  const msg = Buffer.concat([Buffer.from([3]), u32be(7), u32be(1479626325), senderOverride || Buffer.from(X0.C.program.toBytes()), u32be(11155111),
    Buffer.from("048c8208b0b37157fbbd71a737a34b1c5a00f6c8".padStart(64, "0"), "hex"), body]);
  const acct = Buffer.concat([Buffer.from([1]), Buffer.from("DISPATCH"), Buffer.alloc(53 - 9), msg]);
  // keys: 0 user, 1 prog, 2 dispatched, 3 other program, 4 mailbox ; our ix accounts: index 6 = user, 8 = dispatched
  const keys = [user, prog, dispatched, other, mailbox];
  const ourIx = { programIdIndex: 1, accounts: [4, 4, 4, 4, 4, 4, 0, 4, 2, 4, 4, 4, 4, 4, 4, 4, 4], data: X0.encode58(ixData) };
  const forged = { programIdIndex: 3, accounts: [1, 2], data: X0.encode58(Uint8Array.from([9, 9, 9])) };
  const slot = 5000;
  const tx = { slot, transaction: { message: { accountKeys: keys, instructions: forgeLogOnly ? [forged] : cpi ? [forged] : [ourIx] } },
    meta: { err: null, innerInstructions: cpi && !forgeLogOnly ? [{ index: 0, instructions: [ourIx] }] : [],
      logMessages: [`Program log: Dispatched message to 11155111, ID ${C.keccak256(msg)}`] } };
  const real = { context: { slot: slot + 3 }, value: { owner: mailbox, data: [acct.toString("base64"), "base64"] } };
  const answers = { getTransaction: { result: tx }, getAccountInfo: { result: real } };
  const calls = [];
  const ctx = loadX1(async (_u, o) => {
    const { method, params } = JSON.parse(o.body); calls.push({ method, params });
    if (method === "getAccountInfo" && accountInfo) { const a = await accountInfo(params, real); if (a === "throw") throw new Error("network down"); return { json: async () => a }; }
    const r = answers[method]; return { json: async () => r || { result: null } };
  });
  return { X: ctx.X1BRIDGE, user, id: C.keccak256(msg), slot, calls };
}
test("R9-03: verifyX2E accepts a real TransferRemote of our program and returns keccak(message)", async () => {
  const w = x2eWorld(); const v = await w.X.verifyX2E("5".repeat(88), w.user);
  assert.equal(v.status, "ok"); assert.equal(v.id, w.id);
});
test("R9-03: our program called by CPI is accepted the same way", async () => {
  const w = x2eWorld({ cpi: true }); assert.equal((await w.X.verifyX2E("5".repeat(88), w.user)).status, "ok");
});
test("R9-03: a forged dispatch log with our program only among the accounts is refused", async () => {
  const w = x2eWorld({ forgeLogOnly: true }); assert.equal((await w.X.verifyX2E("5".repeat(88), w.user)).status, "mismatch");
});
test("R9-03: a dispatched message from another sender, or with another amount, is refused", async () => {
  const w1 = x2eWorld({ senderOverride: Buffer.alloc(32, 7) }); assert.equal((await w1.X.verifyX2E("5".repeat(88), w1.user)).status, "mismatch");
  const w2 = x2eWorld({ amountBody: 6n * 10n ** 9n }); assert.equal((await w2.X.verifyX2E("5".repeat(88), w2.user)).status, "mismatch");
});
// R10-06: the DISPATCH account comes from a possibly lagging backend; only a read at a slot >= the transaction's decides
const SIG = "5".repeat(88);
const lagging = { error: { code: -32016, message: "Minimum context slot has not been reached", data: { contextSlot: 4990 } } };
test("R10-06: the account read carries minContextSlot = the transaction's slot (finalized)", async () => {
  const w = x2eWorld(); assert.equal((await w.X.verifyX2E(SIG, w.user)).status, "ok");
  const a = w.calls.find((c) => c.method === "getAccountInfo");
  assert.equal(a.params[1].minContextSlot, w.slot); assert.equal(a.params[1].commitment, "finalized");
});
test("R10-06: a lagging backend (-32016) is pending, not mismatch", async () => {
  const w = x2eWorld({ accountInfo: () => lagging }); assert.equal((await w.X.verifyX2E(SIG, w.user)).status, "pending");
});
test("R10-06: value:null with a context slot below the transaction's is pending", async () => {
  const w = x2eWorld({ accountInfo: () => ({ result: { context: { slot: 4999 }, value: null } }) }); assert.equal((await w.X.verifyX2E(SIG, w.user)).status, "pending");
  const w2 = x2eWorld({ accountInfo: () => ({ result: { value: null } }) }); assert.equal((await w2.X.verifyX2E(SIG, w2.user)).status, "pending");
});
test("R10-06: value:null with a context slot >= the transaction's is a real absence -> mismatch", async () => {
  const w = x2eWorld({ accountInfo: () => ({ result: { context: { slot: 5000 }, value: null } }) }); assert.equal((await w.X.verifyX2E(SIG, w.user)).status, "mismatch");
});
test("R10-06: an RPC that throws (network) is pending", async () => {
  const w = x2eWorld({ accountInfo: () => "throw" }); assert.equal((await w.X.verifyX2E(SIG, w.user)).status, "pending");
});
test("R10-06: lagging first, the real account later -> pending, then ok with the same ID", async () => {
  let n = 0; const w = x2eWorld({ accountInfo: (_p, real) => (n++ === 0 ? lagging : { result: real }) });
  assert.equal((await w.X.verifyX2E(SIG, w.user)).status, "pending");
  const v = await w.X.verifyX2E(SIG, w.user); assert.equal(v.status, "ok"); assert.equal(v.id, w.id);
});
test("R10-06: app.js keeps the X1 record on a pending verifyX2E (no clear, retry later); only mismatch clears it", () => {
  const app = fs.readFileSync(join(www, "app.js"), "utf8");
  const body = app.slice(app.indexOf("async function reconcileOp"), app.indexOf("async function migrateOldPending"));
  const pend = body.match(/v = await X\.verifyX2E[^\n]*\n[^\n]*\n\s*if \(v\.status === "pending"\) \{([^\n]*)\}/);
  assert.ok(pend, "pending branch after verifyX2E"); assert.ok(!/clearOpIf|saveOpIf/.test(pend[1])); assert.ok(/setTimeout\(reconcileOp/.test(pend[1]));
  assert.ok(/if \(v\.status === "pending"\) \{ setTimeout\(\(\) => resumeOps\(\)/.test(app), "migration retries on pending");
  assert.ok(/x1\.js\?v=7/.test(app));
});

test("F-04: X1 recipient = exactly 32 bytes, canonical base58, not the zero key (same bytes as solana-web3)", () => {
  const W = load(["core.js", "vendor/solana-web3-1.98.4.iife.min.js"]);
  const PK = W.solanaWeb3.PublicKey, X = W.BRIDGE_CORE;
  const hex = (b) => "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  for (const a of ["DfGSUkaDJfqSqeUPitGD8HCdLzzoLZzvaMJDkuiZnNMb", "74gG4yHE7DV4dU51GHrdX2z4BwtfuYQanSMizBTEjUk",
    "8hA1rhuAuCr1HaWP9x66Ptua9gpqK5jS39LhmN4h41fR", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]) {
    assert.equal(X.x1AddrToHex32(a), hex(new PK(a).toBytes()), a);
  }
  // a key with leading zero bytes: base58 starts with '1' per zero byte, still valid and exact
  const lead = new Uint8Array(32); lead[2] = 7; lead[31] = 255;
  const s = new PK(lead).toBase58();
  assert.ok(s.startsWith("11"));
  assert.equal(X.x1AddrToHex32(s), hex(lead));
  const bad = {
    "32 × '2' (decodes to 23 bytes)": "2".repeat(32),
    "zero key (system program)": "11111111111111111111111111111111",
    "truncated to 32 chars (< 32 bytes)": "DfGSUkaDJfqSqeUPitGD8HCdLzzoLZzv",
    "extra leading '1' (33 bytes)": "1" + "DfGSUkaDJfqSqeUPitGD8HCdLzzoLZzvaMJDkuiZnNMb",
    "one char too many": "DfGSUkaDJfqSqeUPitGD8HCdLzzoLZzvaMJDkuiZnNMbz",
    "invalid char 0": "0fGSUkaDJfqSqeUPitGD8HCdLzzoLZzvaMJDkuiZnNMb",
    "44 × 'z' (> 32 bytes)": "z".repeat(44),
    "empty": "", "not a string": 12345,
  };
  for (const [name, a] of Object.entries(bad)) assert.equal(X.x1AddrToHex32(a), null, name);
  // the old validator accepted "2"*32 and padded it to another key; the page now uses CORE.x1AddrToHex32 only
  const app = fs.readFileSync(new URL("../www/app.js", import.meta.url), "utf8");
  assert.match(app, /const b58ToHex32 = \(s\) => CORE\.x1AddrToHex32\(s\)/);
  assert.doesNotMatch(app, /padStart\(64, "0"\);\s*\n\}/);
});

// ===================== White Paper (#/wp, page v44) =====================
const wpDoc = (l) => JSON.parse(fs.readFileSync(join(www, "wp", `${l}.json`), "utf8"));
const isSeg = (s) => typeof s === "string" || (s && typeof s === "object" && !Array.isArray(s) && Object.keys(s).length === 1 && (typeof s.b === "string" || typeof s.g === "string"));
const isText = (v) => typeof v === "string" || (Array.isArray(v) && v.length > 0 && v.every(isSeg));
function wpSchemaErrors(d) {
  const e = [], need = (ok, msg) => { if (!ok) e.push(msg); };
  need(d.schema === 1, "schema 1"); need(typeof d.lang === "string", "lang");
  const m = d.meta || {};
  for (const k of ["eyebrow", "version", "date", "site"]) need(typeof m[k] === "string" && m[k], `meta.${k}`);
  need(isText(m.title) && isText(m.lead), "meta.title/lead");
  need(m.labels && ["version", "date", "site"].every((k) => typeof m.labels[k] === "string"), "meta.labels");
  need(m.draft === undefined || typeof m.draft === "boolean", "meta.draft boolean");
  need(Array.isArray(d.metrics) && d.metrics.every((x) => typeof x.v === "string" && typeof x.l === "string"), "metrics");
  need(Array.isArray(d.sections) && d.sections.length > 0, "sections");
  for (const [i, s] of (d.sections || []).entries()) {
    need(typeof s.num === "string" && typeof s.title === "string" && isText(s.lead) && Array.isArray(s.blocks) && s.blocks.length, `section ${i}`);
    for (const [j, b] of (s.blocks || []).entries()) {
      const at = `section ${s.num} block ${j} (${b.type})`;
      if (b.type === "p") need(isText(b.text), at);
      else if (b.type === "h2") need(typeof b.text === "string", at);
      else if (b.type === "ul") need(Array.isArray(b.items) && b.items.length && b.items.every(isText), at);
      else if (b.type === "table") need(Array.isArray(b.head) && b.head.every((h) => typeof h === "string") && Array.isArray(b.rows) && b.rows.every((r) => Array.isArray(r) && r.length === b.head.length && r.every((c) => typeof c === "string")) && (b.num === undefined || (Array.isArray(b.num) && b.num.every((n) => Number.isInteger(n) && n < b.head.length))), at);
      else if (b.type === "callout") need(["gold", "info"].includes(b.tone) && typeof b.label === "string" && isText(b.text), at);
      else if (b.type === "card") need(typeof b.title === "string" && Array.isArray(b.body) && b.body.every(isText), at);
      else e.push(`${at}: unknown type`);
    }
  }
  return e;
}
const allStrings = (v, out = []) => { if (typeof v === "string") out.push(v); else if (v && typeof v === "object") for (const x of Object.values(v)) allStrings(x, out); return out; };
const shape = (d) => ({ metrics: d.metrics.length, sections: d.sections.map((s) => ({ num: s.num, blocks: s.blocks.map((b) => b.type + (b.type === "table" ? `:${b.head.length}x${b.rows.length}` : b.type === "ul" ? `:${b.items.length}` : "")) })) });

test("WP: wp/en.json and wp/pl.json follow the schema (known block types, segments only string/{b}/{g})", () => {
  for (const l of ["en", "pl"]) assert.deepEqual(wpSchemaErrors(wpDoc(l)), [], l);
});
test("WP: both languages have the same structure (8 sections 01-08, same blocks, tables and metrics)", () => {
  const en = wpDoc("en"), pl = wpDoc("pl");
  assert.equal(pl.sections.length, 8);
  assert.deepEqual(pl.sections.map((s) => s.num), ["01", "02", "03", "04", "05", "06", "07", "08"]);
  assert.deepEqual(shape(en), shape(pl));
});
test("WP: no HTML in any string of the content; links/markup only as data segments", () => {
  for (const l of ["en", "pl"]) for (const s of allStrings(wpDoc(l))) assert.doesNotMatch(s, /<\/?[a-z!]|&[a-z#0-9]+;|javascript:/i, `${l}: ${s.slice(0, 60)}`);
});
test("WP: published versions — EN (team-approved) and PL, neither marked draft", () => {
  assert.notEqual(wpDoc("en").meta.draft, true);
  assert.equal(wpDoc("en").lang, "en");
  assert.notEqual(wpDoc("pl").meta.draft, true);
});
test("WP: the renderer builds DOM with createElement/textContent only (no innerHTML, no inline styles) and links the EN PDF", () => {
  const src = fs.readFileSync(join(www, "wp.js"), "utf8");
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|\.style\b|setAttribute\(\s*["']style|\bon[a-z]+\s*=/);
  assert.match(src, /document\.createElement\(/); assert.match(src, /textContent/);
  assert.match(src, /"wp\/VMPX-Bridge-WP-EN\.pdf"/); assert.match(src, /"wp\/VMPX-Bridge-WP-PL\.pdf"/);
  const app = fs.readFileSync(join(www, "app.js"), "utf8");
  const wpPart = app.slice(app.indexOf("if (wp) {"), app.indexOf("if (stats) {"));
  assert.ok(wpPart.length > 20 && !/innerHTML/.test(wpPart), "the #/wp branch in app.js does not use innerHTML");
  assert.match(app, /loadScript\("wp\.js\?v=2"\)/); assert.match(app, /loadScript\("stats\.js\?v=9"\)/);
});

// a tiny DOM (only what wp.js uses) to render the JSON as the browser would
function fakeDom() {
  class Node { constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.className = ""; this._t = null; }
    appendChild(c) { this.children.push(c); return c; } replaceChildren(...c) { this.children = c; }
    setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; }
    set textContent(v) { this._t = String(v); this.children = []; } get textContent() { return this._t ?? this.children.map((c) => c.textContent).join(""); }
    get firstChild() { return this.children[0] || null; } }
  class TextNode { constructor(t) { this.tagName = "#text"; this.textContent = t; this.children = []; } }
  const all = (n, f, out = []) => { if (f(n)) out.push(n); for (const c of n.children || []) all(c, f, out); return out; };
  return { document: { createElement: (t) => new Node(t.toUpperCase()), createTextNode: (t) => new TextNode(t) }, all };
}
test("WP: rendered DOM - 8 sections, DRAFT badge only for EN, PDF link, tables, every content string present", () => {
  for (const l of ["en", "pl"]) {
    const D = fakeDom(), d = wpDoc(l);
    const W = load(["wp.js"], { document: D.document, t: (k) => k, LANG: l, $: () => null, fetch: () => Promise.reject(new Error("no network")) }).WP;
    assert.ok(W.valid(d));
    const art = W.build(d);
    assert.equal(art.tagName, "ARTICLE");
    assert.equal(D.all(art, (n) => n.tagName === "SECTION").length, 8, l);
    assert.equal(D.all(art, (n) => n.attrs && n.className === "wpdraft").length, 0, `${l} draft badge`);
    const pdf = D.all(art, (n) => n.id === "wpPdf")[0];
    assert.equal(pdf.getAttribute("href"), "wp/VMPX-Bridge-WP-EN.pdf");
    assert.equal(D.all(art, (n) => n.tagName === "TABLE").length, 2);
    assert.equal(D.all(art, (n) => n.className === "wptable").every((n) => n.tagName === "DIV"), true, "tables inside their own scroll container");
    const txt = art.textContent;
    for (const s of allStrings({ m: [d.meta.title, d.meta.lead], s: d.sections, x: d.metrics })) if (!/^(p|ul|h2|table|callout|card|gold|info)$/.test(s)) assert.ok(txt.includes(s), `${l}: missing "${s.slice(0, 50)}"`);
    assert.ok(D.all(art, (n) => n.tagName === "STRONG").length >= 20, "bold segments as <strong>");
    assert.match(txt, l === "en" ? /Version 0\.1 · 1 November 2026 · bridge\.x1watch\.xyz · a XEN community project/ : /Wersja 0\.1 · 1 listopada 2026 · bridge\.x1watch\.xyz · projekt społeczności XEN/);
    assert.doesNotMatch(txt, /draft|robocza/i);
  }
  const bad = load(["wp.js"], { document: fakeDom().document, t: (k) => k, LANG: "en", $: () => null }).WP;
  assert.equal(bad.valid({ meta: { title: "x" }, sections: [] }), false); assert.equal(bad.valid(null), false);
});
test("WP: page wiring - visible footer link to #/wp, the view, versions v46 / style v4", () => {
  const html = fs.readFileSync(join(www, "index.html"), "utf8");
  assert.match(html, /<a id="wpLink" href="#\/wp" data-i18n="wpLink">/);
  assert.match(html, /id="viewWp"/); assert.match(html, /app\.js\?v=47/); assert.match(html, /style\.css\?v=4/);
  assert.doesNotMatch(html, /\sstyle=|<style|<script>(?!<\/script>)/, "no inline styles or scripts");
});

// i18n tables of app.js and stats.js: same keys in EN and PL
function appI18n() {
  const app = fs.readFileSync(join(www, "app.js"), "utf8");
  const src = app.slice(app.indexOf("const I18N = {"), app.indexOf("\nlet LANG"));
  const ctx = {}; vm.createContext(ctx); vm.runInContext(src + "\nthis.I18N = I18N;", ctx);
  return ctx.I18N;
}
test("i18n: EN and PL have the same keys (app.js and stats.js)", () => {
  const I = appI18n();
  assert.deepEqual(Object.keys(I.pl).sort(), Object.keys(I.en).sort());
  for (const k of ["wpLink", "wpPdf", "wpPdfPl", "wpDraft", "wpErr"]) assert.ok(I.en[k] && I.pl[k], k);
  const before = { en: new Set(Object.keys(I.en)), pl: new Set(Object.keys(I.pl)) };
  load(["stats.js"], { I18N: I, document: {}, location: {} });
  const added = (l) => Object.keys(I[l]).filter((k) => !before[l].has(k)).sort();
  assert.ok(added("en").length > 10); assert.deepEqual(added("pl"), added("en"));
});
test("naming: VMPX on Ethereum, VMPXe on X1, project VMPX Bridge - no 'eVMPX' left in the page or the frontend README", () => {
  for (const f of ["index.html", "app.js", "stats.js", "core.js", "x1.js", "wp.js", "wp/en.json", "wp/pl.json"]) assert.doesNotMatch(fs.readFileSync(join(www, f), "utf8"), /eVMPX/, f);
  assert.doesNotMatch(fs.readFileSync(join(www, "../README.md"), "utf8"), /eVMPX/);
  const I = appI18n();
  assert.equal(I.en.brandSub, "VMPX Bridge"); assert.equal(I.pl.brandSub, "VMPX Bridge");
  assert.equal(I.en.statX1, "VMPXe on X1"); assert.equal(I.pl.statX1, "VMPXe na X1");
});

// ---- v46: ANL ecosystem bar and footer ----
const pageHtml = () => fs.readFileSync(join(www, "index.html"), "utf8");
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)) + b.length);
const hrefs = (frag) => [...frag.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((m) => m[1]);
// EIP-55 checksum with the page's own keccak256
function eip55(a) {
  const lo = a.slice(2).toLowerCase(), h = C.keccak256(new TextEncoder().encode(lo)).slice(2);
  return "0x" + [...lo].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
}
test("v46 eco bar: above the bridge header, ANL logo -> ANL home, links in the ANL menu order, VMPX Bridge active", () => {
  const html = pageHtml(), bar = between(html, '<nav class="eco"', "</nav>");
  assert.ok(html.indexOf('<nav class="eco"') < html.indexOf('<header class="top">'), "the bar comes before the bridge header");
  assert.match(bar, /<a class="ecologo" href="https:\/\/anl-protocol\.com\/"[^>]*>.*<b>ANL PROTOCOL<\/b><\/a>/s);
  const tabs = between(bar, '<div class="ecotabs"', "</div>");
  assert.deepEqual(hrefs(tabs), ["https://anl-protocol.com/", "https://anl-protocol.com/nft.html", "https://x1watch.xyz/", "#/", "#/wp"]);
  const names = [...tabs.matchAll(/<a\b[^>]*>(.*?)<\/a>/gs)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
  assert.deepEqual(names, ["Home", "NFT Marketplace", "x1watch", "VMPX Bridge", "Whitepaper"]);
  const active = [...tabs.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).filter((a) => /aria-current="page"/.test(a));
  assert.equal(active.length, 1); assert.match(active[0], /class="ecotab t-vmpx on"/); assert.match(active[0], /href="#\/"/);
  assert.match(bar, /<span class="netstat"><span class="live" aria-hidden="true"><\/span>X1 Network<\/span>/);
  assert.match(bar, /data-href-pl="https:\/\/anl-protocol\.com\/pl\/index\.html"/); assert.match(bar, /data-href-pl="https:\/\/anl-protocol\.com\/pl\/nft\.html"/);
  const I = appI18n(); assert.equal(I.en.ecoHome, "Home"); assert.equal(I.pl.ecoHome, "Start");
});
const T_TOKEN = "0xCC0c84755384b041470C021D338639EDa8831E09", T_ROUTER = "0x048C8208B0B37157FBbD71a737a34B1C5A00f6C8",
  T_MINT = "GjSYfUZueEiH7pjP6df1aJimEBzDZKdJbP17akxjCBzj", M_VMPX = "0xb48Eb8368c9C6e9b0734de1Ef4ceB9f484B80b9C";
const chipsOf = (ul) => [...ul.matchAll(/<li class="addrchip[^"]*">(.*?)<\/li>/gs)].map((m) => ({ li: m[1],
  copy: (m[1].match(/data-copy="([^"]+)"/) || [])[1] || null, href: (m[1].match(/<a [^>]*href="([^"]+)"/) || [])[1] || null,
  code: (m[1].match(/<code title="([^"]+)">([^<]+)<\/code>/) || []).slice(1), soon: /data-i18n="soon"/.test(m[1]) }));
test("v46 footer contracts: testnet chips (copy + explorer), mainnet set, addresses = NET config, valid EIP-55", () => {
  const html = pageHtml(), app = fs.readFileSync(join(www, "app.js"), "utf8");
  const test_ = chipsOf(between(html, '<ul class="chips" id="chipsTest">', "</ul>")), main = chipsOf(between(html, '<ul class="chips hidden" id="chipsMain">', "</ul>"));
  assert.deepEqual(test_.map((c) => [c.copy, c.href]), [
    [T_TOKEN, `https://sepolia.etherscan.io/token/${T_TOKEN}`],
    [T_ROUTER, `https://sepolia.etherscan.io/address/${T_ROUTER}`],
    [T_MINT, `https://explorer.testnet.x1.xyz/address/${T_MINT}`]]);
  for (const c of test_) { assert.equal(c.code[0], c.copy); assert.equal(c.code[1], c.copy.slice(0, 6) + "…" + c.copy.slice(-4)); assert.match(c.li, /<button type="button" class="copy" data-copy="[^"]+" data-i18n="copy">Copy<\/button>/); assert.match(c.li, /target="_blank" rel="noopener"/); }
  assert.deepEqual(main.map((c) => [c.copy, c.href, c.soon]), [[M_VMPX, `https://etherscan.io/token/${M_VMPX}`, false], [null, null, true], [null, null, true]]);
  // same addresses as the page config (router / mint / explorer) and the token section
  assert.match(app, new RegExp(`router: "${T_ROUTER.toLowerCase()}"`)); assert.match(app, new RegExp(`x1Mint: "${T_MINT}"`));
  assert.match(app, /explorer: "https:\/\/explorer\.testnet\.x1\.xyz"/); assert.match(app, /explorer: "https:\/\/sepolia\.etherscan\.io"/);
  assert.match(html, new RegExp(`<code>${T_TOKEN}</code>`));
  for (const a of [T_TOKEN, T_ROUTER, M_VMPX]) assert.equal(eip55(a), a, `EIP-55 ${a}`);
  assert.match(html, /<button type="button" id="ctrTest" aria-pressed="true"/); assert.match(html, /<button type="button" id="ctrMain" aria-pressed="false"/);
  assert.match(app, /function setCtrNet\(main\)/);
});
test("v46 footer: row, disclaimer EN/PL, bottom link row hrefs in the ANL order, version in the footer", () => {
  const html = pageHtml(), I = appI18n(), app = fs.readFileSync(join(www, "app.js"), "utf8");
  const foot = between(html, '<footer class="foot">', "</footer>");
  assert.match(foot, /<span>VMPX Bridge · X1 Network<\/span>/); assert.match(foot, /data-i18n="ecoPart">Part of the ANL ecosystem\.</);
  assert.match(foot, /<p class="disc" id="disc" data-i18n="disc">/);
  assert.equal(I.en.disc, "VMPX Bridge is not an investment offer, financial advice or a financial instrument. It is an independent community project, not affiliated with X1 Labs. The code is reviewed with AI tools, without a paid external audit. The bridge currently runs on testnet; testnet tokens have no value. On-chain values can be verified independently. DYOR.");
  assert.match(I.pl.disc, /^VMPX Bridge nie jest ofertą inwestycyjną, doradztwem finansowym ani instrumentem finansowym\. .*niepowiązany z X1 Labs\. .*bez płatnego audytu zewnętrznego\. .*tokeny testowe nie mają wartości\. Wartości on-chain możesz zweryfikować samodzielnie\. DYOR\.$/);
  assert.equal(I.pl.ecoPart, "Część ekosystemu ANL."); assert.equal(I.pl.ctrH, "Kontrakty on-chain");
  const bar = between(foot, '<div class="ecobar"', "</div>");
  assert.deepEqual(hrefs(bar), ["#/wp", "https://github.com/dawidosX/vmpx-bridge", "https://github.com/dawidosX/vmpx-bridge/blob/main/SECURITY.md",
    "https://x1.xyz", "https://anl-protocol.com/", "https://t.me/anlprotocol", "https://x.com/ANLprotocol"]);
  assert.match(foot, /<a id="tgContact" href="https:\/\/t\.me\/dawidosX" target="_blank" rel="noopener">Telegram @dawidosX<\/a>/);
  assert.ok(I.en.contact && I.pl.contact, "security contact label EN/PL");
  assert.doesNotMatch(html, /evmpx-x1-bridge/);
  const items = bar.replace(/<span class="dot"[^>]*>·<\/span>/g, "|").replace(/<[^>]+>/g, "").split("|").map((x) => x.trim());
  assert.deepEqual(items, ["White Paper", "GitHub", "Security", "Powered by X1", "Part of the ANL Ecosystem", "Telegram", "X"]);
  assert.match(bar, /<a id="wpLink" href="#\/wp" data-i18n="wpLink">/); assert.doesNotMatch(bar, /wpLink"[^>]*hidden/);
  for (const a of bar.match(/<a [^>]*href="https:[^>]*>/g)) if (!/anl-protocol\.com\/"/.test(a)) assert.match(a, /target="_blank" rel="noopener"/, a);
  assert.match(app, /const PAGE_VERSION = "v47";/); assert.match(app, /t\("foot", NET\.eth\.name, NET\.x1\.name\) \+ " · " \+ PAGE_VERSION/);
  assert.doesNotMatch(foot, /\/srv|\/etc\/|\/home\/|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, "no server paths or IPs");
});
test("v46: new code without innerHTML/inline styles; i18n keys of the bar and footer in EN and PL", () => {
  const app = fs.readFileSync(join(www, "app.js"), "utf8"), html = pageHtml();
  const part = between(app, "// footer \"On-chain contracts\"", "if (document.fonts) document.fonts.ready.then(ecoInView);");
  assert.ok(part.length > 200); assert.doesNotMatch(part, /innerHTML|outerHTML|insertAdjacentHTML|\.style\b|eval\(/);
  const lang = between(app, 'document.querySelectorAll("a[data-href-pl]")', "});");
  assert.doesNotMatch(lang, /innerHTML/);
  assert.doesNotMatch(html, /\sstyle=|<style|<script>(?!<\/script>)|\son[a-z]+=/i, "no inline styles, scripts or handlers");
  assert.doesNotMatch(html, /<(img|script|link)[^>]+(src|href)="https?:/i, "no external images, scripts or stylesheets");
  const I = appI18n();
  for (const k of ["ecoAria", "ecoLogoAria", "ecoHome", "ecoPart", "ecoSec", "ecoPowered", "ecoPartLink", "ctrH", "ctrNetAria", "ctrRouter", "ctrMint", "disc", "tgNote", "soon", "copy", "tokX1Exp", "wpLink"])
    assert.ok(I.en[k] && I.pl[k], k);
  for (const k of [...html.matchAll(/data-i18n(?:-aria|-html|-title|-ph)?="([^"]+)"/g)].map((m) => m[1])) assert.ok(k in I.en && k in I.pl, `missing key ${k}`);
});

test("v46: hero White Paper button → #/wp and PDF link by language; eco bar Whitepaper → #/wp", () => {
  const html = fs.readFileSync(new URL("../www/index.html", import.meta.url), "utf8");
  assert.match(html, /<a class="wpbtn" id="heroWp" href="#\/wp" data-i18n="heroWp">White Paper<\/a>/);
  assert.match(html, /<a class="wppdf" id="heroPdf" href="wp\/VMPX-Bridge-WP-EN\.pdf" data-href-pl="wp\/VMPX-Bridge-WP-PL\.pdf" target="_blank" rel="noopener" data-i18n="heroPdf">PDF<\/a>/);
  assert.match(html, /<a class="ecotab t-wp" id="ecoWp" href="#\/wp">/);
  assert.ok(html.indexOf('id="heroCta"') > html.indexOf('data-i18n="lede"'), "buttons right under the lede");
  const app = fs.readFileSync(new URL("../www/app.js", import.meta.url), "utf8");
  for (const k of ["heroWp", "heroPdf", "ecoWp"]) assert.equal((app.match(new RegExp(`\\b${k}:`, "g")) || []).length, 2, k);
});

test("v47: view changes keep the ANL bar and header on screen (no plain scrollTo(0,0), manual scroll restoration, re-check after async render)", () => {
  const app = fs.readFileSync(new URL("../www/app.js", import.meta.url), "utf8");
  assert.match(app, /history\.scrollRestoration = "manual"/);
  assert.match(app, /revealWanted = window\.scrollY > barKeepY\(\)/); assert.match(app, /window\.scrollTo\(\{ top: 0, left: 0, behavior: "instant" \}\)/);
  assert.doesNotMatch(app, /window\.scrollTo\(0, 0\)/, "no unconditional scroll to 0 left");
  for (const v of ["WP.show(focus)).then(() => { if (focus) revealAfterRender(); })", "STATS.show(r, focus)).then(() => { if (focus) revealAfterRender(); })", "loadTx(false).then(() => { if (focus) revealAfterRender(); })"]) assert.ok(app.includes(v), v);
  assert.ok(app.includes("if (!revealWanted || userScrollAt > routeAt) return;"), "a user scroll after the route change wins");
});
