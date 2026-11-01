// Page logic without DOM or network (v38, community test round): transfer tracking by message ID, invalidation of a
// prepared operation when the wallet changes, X1 wallet checks, exact approve, one send at a time, default recipient,
// gas warnings and send-error classes. Loaded before app.js; also loaded by frontend/tests/core.test.mjs in Node.
(() => {
  "use strict";
  const MIN = 60000;
  const TRACK = { e2xLateMs: 20 * MIN, x2eLateMs: 20 * MIN, keepMs: 3 * 24 * 60 * MIN };
  const RE_ID = /^0x[0-9a-f]{64}$/;

  // ---------- tracking by message ID (FUN-03, NET-05) ----------
  /** decision for one poll: delivered -> "done"; past the limit -> "late" (keep polling, tell the user); else "wait" */
  function trackState({ delivered, startedAt, now, lateMs }) {
    if (delivered) return "done";
    return now - startedAt > lateMs ? "late" : "wait";
  }
  /**
   * A pending record from localStorage -> { dir, id, tx, t } or null (drop it). Only public data: message ID, tx hash
   * or X1 signature, start time. v37 E->X1 records tracked the recipient balance ({ r, base, want, ... }); with a message
   * ID they continue by ID, without one they are dropped (they could never finish, community test FUN-03).
   */
  function migratePending(raw, dir, now) {
    let p;
    try { p = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
    if (!p || typeof p !== "object") return null;
    const id = typeof p.id === "string" ? p.id.toLowerCase() : "";
    const t = Number(p.t);
    if (!RE_ID.test(id) || !Number.isFinite(t) || t <= 0 || now - t > TRACK.keepMs) return null;
    const tx = dir === "e2x" ? (/^0x[0-9a-fA-F]{64}$/.test(p.tx || "") ? p.tx : null) : (/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(p.sig || p.tx || "") ? (p.sig || p.tx) : null);
    return { dir, id, tx, t };
  }

  // ---------- prepared operation (NET-04) ----------
  /** everything a signature depends on; a different key = the prepared operation (preview, quote) is void */
  function opKey(o) {
    return [o.dir, (o.account || "").toLowerCase(), o.chainId || "", o.x1 || "", o.amount ?? "", (o.rcpt || "").toLowerCase()].join("|");
  }
  /** checks right before a signature; returns a list of problem codes (empty = go) */
  function preSignProblems({ dir, chainId, wantChainId, account, prepared, current, balance, amount, fee, feeShown }) {
    const p = [];
    if (dir === "e2x" && chainId !== wantChainId) p.push("wrongChain");
    if (!account) p.push("noAccount");
    if (prepared !== current) p.push("changed");
    if (balance == null || amount == null || balance < amount) p.push("balance");
    if (fee !== undefined && fee !== feeShown) p.push("fee");
    return p;
  }

  // ---------- X1 wallet (NET-03) ----------
  /** a Wallet Standard account must declare a solana:* chain and carry a 32-byte public key */
  function x1AccountProblem(acc) {
    if (!acc) return "noAccount";
    const chains = Array.isArray(acc.chains) ? acc.chains : [];
    if (!chains.some((c) => typeof c === "string" && /^solana:/.test(c))) return "notSolana";
    const pk = acc.publicKey;
    if (!pk || typeof pk.length !== "number" || pk.length !== 32) return "badKey";
    return null;
  }
  /** the chain to pass when signing: testnet/devnet first, otherwise the first solana:* chain */
  function x1SignChain(acc) {
    const chains = (acc && acc.chains || []).filter((c) => /^solana:/.test(c));
    return chains.find((c) => /testnet|devnet/.test(c)) || chains[0] || null;
  }

  // ---------- approve (SEC-10) ----------
  /** the approve amount: exactly the transfer amount when the allowance is short, otherwise none (null). Never max. */
  function approveAmount(allowance, amount) {
    if (typeof allowance !== "bigint" || typeof amount !== "bigint" || amount <= 0n) throw new Error("bad amount");
    return allowance >= amount ? null : amount;
  }

  // ---------- one send at a time (NET-06) ----------
  function sendLock() {
    let held = false;
    return { acquire() { if (held) return false; held = true; return true; }, release() { held = false; }, get held() { return held; } };
  }

  // ---------- default recipient (FUN-03/05) ----------
  /** the connected address on the destination chain, unless the user typed a different one on purpose */
  function defaultRecipient({ dir, ethAccount, x1Address, current, edited }) {
    const own = dir === "e2x" ? x1Address : ethAccount;
    if (edited && current) return current;
    return own || (edited ? current : "") || "";
  }

  // ---------- gas warnings (FUN-01) ----------
  const ETH_GAS_RESERVE = 2n * 10n ** 14n;   // 0.0002 ETH on top of the delivery fee
  /** ETH -> X1: the wallet needs the delivery quote + a reserve for approve/transfer gas */
  function ethGasShort(ethBal, quote) {
    if (ethBal == null) return false;
    return ethBal < (quote || 0n) + ETH_GAS_RESERVE;
  }
  function xntShort(xnt, total) { return xnt != null && total != null && xnt < total; }

  // ---------- persisted operation (R7-06, v39) ----------
  // One record in localStorage ("vmpx-op") from the moment the user starts a send. Stages:
  //   signing  - the wallet window is open in some tab (that tab refreshes hb every few seconds)
  //   sent     - an Ethereum hash / X1 signature exists, the result is not known yet (no message ID)
  //   unknown  - the result could not be established (needs "Check status" or an explicit decision)
  //   tracking - confirmed on the source chain, message ID known, delivery is tracked
  // Only public data: addresses, amount, hash/signature, message ID, times.
  const OP = { hbMs: 5000, hbStaleMs: 20000, futureMs: 60000, keepMs: TRACK.keepMs };
  const RE_EVM = /^0x[0-9a-fA-F]{40}$/, RE_X1A = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, RE_HASH = /^0x[0-9a-fA-F]{64}$/, RE_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
  /** a stored record -> normalized record or null (malformed, from the future, too old, or a hash of the wrong form) */
  function readOp(raw, now) {
    let r; try { r = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
    if (!r || typeof r !== "object" || r.v !== 1 || !["e2x", "x2e"].includes(r.dir)) return null;
    if (!["signing", "sent", "unknown", "tracking"].includes(r.stage)) return null;
    const t = Number(r.t), hb = Number(r.hb || r.t);
    if (!Number.isFinite(t) || t <= 0 || t > now + OP.futureMs || hb > now + OP.futureMs || now - t > OP.keepMs) return null;
    const e2x = r.dir === "e2x";
    if (!(e2x ? RE_EVM : RE_X1A).test(r.from || "")) return null;
    if (r.tx != null && !(e2x ? RE_HASH : RE_SIG).test(r.tx)) return null;
    if (r.id != null && !RE_ID.test(r.id)) return null;
    if (r.stage !== "signing" && !r.tx) { if (r.stage !== "unknown") return null; }   // only "unknown" may lack a hash (wallet call cut off)
    if (r.stage === "tracking" && !r.id) return null;
    return { v: 1, dir: r.dir, from: r.from, to: String(r.to || ""), amount: String(r.amount || ""), t, hb, stage: r.stage, tx: r.tx || null,
      id: r.id ? r.id.toLowerCase() : null, lastValid: Number.isFinite(Number(r.lastValid)) ? Number(r.lastValid) : null,
      // v40 (R8-02/R8-03): identity of the operation, the tab that owns it and a revision bumped by every write
      opId: /^[0-9a-f]{16,64}$/.test(r.opId || "") ? r.opId : null, owner: /^[0-9a-f]{8,64}$/.test(r.owner || "") ? r.owner : null,
      rev: Number.isInteger(r.rev) && r.rev >= 0 ? r.rev : 0 };
  }
  /** effective state now: a "signing" record whose tab stopped its heartbeat becomes "unknown" (the wallet may have sent) */
  function opState(r, now) {
    if (!r) return null;
    if (r.stage === "signing") return now - r.hb > OP.hbStaleMs ? "unknown" : "signing";
    return r.stage;
  }
  /** a new send is blocked while an operation is being signed, sent with an unknown result, or unknown */
  function opBlocks(r, now) { const s = opState(r, now); return s === "signing" || s === "sent" || s === "unknown"; }
  /** the record belongs to the connected wallet of its direction (EVM addresses compared case-insensitively) */
  function ownsOp(r, account) {
    if (!r || !account) return false;
    return r.dir === "e2x" ? r.from.toLowerCase() === String(account).toLowerCase() : r.from === account;
  }

  /** R8-03: the stored record is still the one a caller read (same operation, same revision) */
  const sameOp = (cur, seen) => !!cur && !!seen && !!cur.opId && cur.opId === seen.opId && cur.rev === seen.rev;
  const newId = (bytes = 16) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

  // ---------- keccak256 (R9-03: the page recomputes the Hyperlane message ID itself) ----------
  // Keccak-f[1600] with BigInt lanes; small inputs only (a Hyperlane message). Checked against @noble/hashes in tests.
  const RC = [0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n,
    0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
    0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
  const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
  const M64 = (1n << 64n) - 1n, rol = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);
  function keccakF(A) {
    for (let r = 0; r < 24; r++) {
      const C = [0, 1, 2, 3, 4].map((x) => A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20]);
      for (let x = 0; x < 5; x++) { const d = C[(x + 4) % 5] ^ rol(C[(x + 1) % 5], 1); for (let y = 0; y < 25; y += 5) A[y + x] ^= d; }
      const B = new Array(25);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rol(A[x + 5 * y], ROT[x + 5 * y]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x + 5 * y] = B[x + 5 * y] ^ (~B[(x + 1) % 5 + 5 * y] & M64 & B[(x + 2) % 5 + 5 * y]);
      A[0] ^= RC[r];
    }
  }
  /** keccak256(bytes) -> "0x" + 64 hex chars */
  function keccak256(bytes) {
    const rate = 136, msg = Uint8Array.from(bytes), padLen = rate - (msg.length % rate), p = new Uint8Array(msg.length + padLen);
    p.set(msg); p[msg.length] ^= 0x01; p[p.length - 1] ^= 0x80;
    const A = new Array(25).fill(0n);
    for (let off = 0; off < p.length; off += rate) {
      for (let i = 0; i < rate / 8; i++) { let v = 0n; for (let b = 7; b >= 0; b--) v = (v << 8n) | BigInt(p[off + i * 8 + b]); A[i] ^= v; }
      keccakF(A);
    }
    let hex = "";
    for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) hex += Number((A[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, "0");
    return "0x" + hex;
  }

  // ---------- X1 fee preview (R7-08) ----------
  const QUOTE_MAX_AGE_MS = 60000;
  const quoteFresh = (q, now) => !!q && Number.isFinite(q.at) && now - q.at <= QUOTE_MAX_AGE_MS;
  /** a fresh quote right before signing that costs noticeably more (over 10% and over 0.001 XNT) needs a new acceptance */
  function feeRose(shownTotal, freshTotal) {
    const d = BigInt(freshTotal) - BigInt(shownTotal);
    return d > 1000000n && d * 10n > BigInt(shownTotal);
  }

  // ---------- send errors (NET-08) ----------
  /**
   * "rejected": the user cancelled in the wallet (nothing sent); "rpc": no connection before anything was sent;
   * "unknown": something may have been sent (a hash or signature exists, or the wallet call failed after signing) -
   * the page shows the hash and does NOT suggest sending again; "failed": the transaction failed on chain.
   */
  function sendErrorClass(e, { sent }) {
    const m = (e && (e.message || String(e))) || "";
    const code = e && e.code;
    if (code === 4001 || /user (rejected|denied)|rejected the request|cancel/i.test(m)) return "rejected";
    if (/reverted|tx-failed/i.test(m)) return "failed";
    if (/^(sign-timeout|wrong-network|wallet-|x1-|changed$)/.test(m)) return "failed";   // our own codes before broadcast: nothing sent
    if (/^(unknown|expired)/.test(m)) return "unknown";   // R7-07: an expired blockhash is not a failure until the signature is reconciled
    if (sent) return "unknown";
    if (/fetch|network|timeout|load|Failed to|RPC/i.test(m)) return "rpc";
    return "failed";
  }

  /** resolves with the promise, or rejects with Error(code) after ms (the promise itself keeps running) */
  function withTimeout(promise, ms, code) {
    let timer;
    return Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(code)), ms); })]).finally(() => clearTimeout(timer));
  }

  // F-04 (full audit): an X1 recipient is valid only if it decodes (leading '1' = leading zero byte) to EXACTLY 32 bytes,
  // re-encodes to the same text (canonical) and is not the zero key; returns the bytes32 hex or null
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58decode(s) {
    if (typeof s !== "string" || !s) return null;
    let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
    const body = []; while (n > 0n) { body.unshift(Number(n & 255n)); n >>= 8n; }
    let z = 0; while (z < s.length && s[z] === "1") z++;
    return Uint8Array.from([...new Array(z).fill(0), ...body]);
  }
  function b58encode(b) {
    let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x);
    let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    let z = 0; while (z < b.length && b[z] === 0) z++;
    return "1".repeat(z) + s;
  }
  function x1AddrToHex32(s) {
    if (typeof s !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return null;
    const b = b58decode(s);
    if (!b || b.length !== 32 || b58encode(b) !== s || b.every((x) => x === 0)) return null;
    return "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  const api = { TRACK, trackState, migratePending, opKey, preSignProblems, x1AccountProblem, x1SignChain, approveAmount, sendLock,
    defaultRecipient, ETH_GAS_RESERVE, ethGasShort, xntShort, sendErrorClass, withTimeout,
    OP, readOp, opState, opBlocks, ownsOp, sameOp, newId, QUOTE_MAX_AGE_MS, quoteFresh, feeRose, keccak256, b58decode, b58encode, x1AddrToHex32 };
  (typeof window !== "undefined" ? window : globalThis).BRIDGE_CORE = api;
})();
