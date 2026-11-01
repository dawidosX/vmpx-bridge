// X1 -> Ethereum from the browser: Wallet Standard discovery, transfer_remote transaction for the VMPXe warp route,
// cost preview by simulation, send through the X1 RPC, delivery tracking on Sepolia.
// Loaded on demand together with vendor/solana-web3-*.iife.min.js (global solanaWeb3). Exposes window.X1BRIDGE.
// The wallet only signs (solana:signTransaction); the page checks that the message is unchanged, adds the signature
// of a one-time message keypair that lives only in this tab, and sends the transaction itself.
(() => {
  "use strict";
  const W = window.solanaWeb3;
  const pk = (s) => new W.PublicKey(s);

  // Accounts of the testnet warp route, as used by hyperlane-sealevel-client (f556e18), checked against the CLI tx 2mvFgTvW…
  const C = {
    rpc: "https://rpc.testnet.x1.xyz",
    program: pk("8hA1rhuAuCr1HaWP9x66Ptua9gpqK5jS39LhmN4h41fR"),
    tokenPda: pk("HwsnsE3EYDxdn4xMXSWZsPFAThgLF9B7p4tYywfuH8UM"),
    mailbox: pk("74gG4yHE7DV4dU51GHrdX2z4BwtfuYQanSMizBTEjUk"),
    outbox: pk("BhMiDcPuVq4pGEpM7qg3ZY5eXL4f7KKUeEwtD1k4aMQJ"),
    dispatchAuthority: pk("3NnhMDgHqkFdwni2sA6FKhWvK9dW4GYa1mFRsbtPjnJA"),
    igpProgram: pk("JLoJ1h1jHptFr2WndUQHq5kWDy8L5jrKfujZfBw2s57"),
    igpProgramData: pk("2S6mLVpNtYjU2NufFergdnU45X85vCCtf1ghnsHx2Prw"),
    overheadIgp: pk("DP2QaXMXMLfV4ZVeM7u6ARBHrGp4oHCNWF8fzaUpiwVH"),
    igp: pk("Be8bQp2EhQVa4ZGimjzj3kGZ7CvK6Jj4Ftt8rUjeDVZg"),
    mint: pk("GjSYfUZueEiH7pjP6df1aJimEBzDZKdJbP17akxjCBzj"),
    token2022: pk("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
    ataProgram: pk("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    noop: pk("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV"),
    ethDomain: 11155111,
    x1Domain: 1479626325,
    router: "0x048c8208b0b37157fbbd71a737a34b1c5a00f6c8",   // the lockbox on Ethereum (recipient of X1 -> Ethereum messages)
    computeUnits: 250000,
    genesis: "C7ucgdDEhxLTpXHhWSZxavSVmaNTUJWwT5iTdeaviDho",   // X1 testnet (getGenesisHash)
    signTimeoutMs: 60000,
  };
  const CORE = window.BRIDGE_CORE;
  const enc = (s) => new TextEncoder().encode(s);
  const pda = (seeds, program) => W.PublicKey.findProgramAddressSync(seeds, program)[0];

  // ---------- RPC ----------
  async function rpc(method, params) {
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(C.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const j = await r.json();   // the load balancer sometimes answers with HTML: retry
        if (j.error) { const e = new Error(j.error.message || method); e.rpc = j.error; throw e; }
        return j.result;
      } catch (e) { last = e; if (e.rpc) throw e; await new Promise((res) => setTimeout(res, 800 * (i + 1))); }
    }
    throw last;
  }
  const b64 = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };

  // ---------- transaction ----------
  function ataOf(owner) { return pda([owner.toBytes(), C.token2022.toBytes(), C.mint.toBytes()], C.ataProgram); }
  function checkConstants() {   // PDAs that can be derived must match the configured accounts
    const tok = pda([enc("hyperlane_message_recipient"), enc("-"), enc("handle"), enc("-"), enc("account_metas")], C.program);
    const out = pda([enc("hyperlane"), enc("-"), enc("outbox")], C.mailbox);
    const auth = pda([enc("hyperlane_dispatcher"), enc("-"), enc("dispatch_authority")], C.program);
    return { tokenPda: tok.equals(C.tokenPda), outbox: out.equals(C.outbox), dispatchAuthority: auth.equals(C.dispatchAuthority) };
  }
  // data: [1;8] discriminator, 1 = TransferRemote, u32 LE domain, bytes32 recipient, U256 LE amount (9 decimals)
  function instructionData(recipientEth, amount9) {
    const d = new Uint8Array(77);
    d.fill(1, 0, 9);
    new DataView(d.buffer).setUint32(9, C.ethDomain, true);
    const a = recipientEth.toLowerCase().replace(/^0x/, "");
    for (let i = 0; i < 20; i++) d[13 + 12 + i] = parseInt(a.substr(i * 2, 2), 16);
    let v = BigInt(amount9);
    for (let i = 0; i < 32 && v > 0n; i++) { d[45 + i] = Number(v & 0xffn); v >>= 8n; }
    return d;
  }
  function buildTx({ sender, recipientEth, amount9, unique, blockhash }) {
    const dispatched = pda([enc("hyperlane"), enc("-"), enc("dispatched_message"), enc("-"), unique.toBytes()], C.mailbox);
    const gasPayment = pda([enc("hyperlane_igp"), enc("-"), enc("gas_payment"), enc("-"), unique.toBytes()], C.igpProgram);
    const k = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });
    const ix = new W.TransactionInstruction({
      programId: C.program,
      data: instructionData(recipientEth, amount9),
      keys: [
        k(W.SystemProgram.programId, false, false), k(C.noop, false, false), k(C.tokenPda, false, false),
        k(C.mailbox, false, false), k(C.outbox, false, true), k(C.dispatchAuthority, false, false),
        k(sender, true, true), k(unique, true, false), k(dispatched, false, true),
        k(C.igpProgram, false, false), k(C.igpProgramData, false, true), k(gasPayment, false, true),
        k(C.overheadIgp, false, false), k(C.igp, false, true),
        k(C.token2022, false, false), k(C.mint, false, true), k(ataOf(sender), false, true),
      ],
    });
    const tx = new W.Transaction({ feePayer: sender, recentBlockhash: blockhash });
    tx.add(W.ComputeBudgetProgram.setComputeUnitLimit({ units: C.computeUnits }), ix);
    return tx;
  }

  // ---------- network check (NET-03): an address format says nothing about the chain ----------
  // Before a signature: the RPC answers with the X1 testnet genesis, the mint is a Token-2022 account and the warp
  // route program is executable. Cached for a minute.
  let netOkAt = 0;
  async function checkNetwork() {
    if (Date.now() - netOkAt < 60000) return;
    const [g, mint, prog] = await Promise.all([rpc("getGenesisHash", []),
      rpc("getAccountInfo", [C.mint.toBase58(), { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]),
      rpc("getAccountInfo", [C.program.toBase58(), { encoding: "base64", dataSlice: { offset: 0, length: 0 } }])]);
    if (g !== C.genesis) throw new Error("wrong-network");
    if (!mint.value || mint.value.owner !== C.token2022.toBase58()) throw new Error("wrong-network");
    if (!prog.value || !prog.value.executable) throw new Error("wrong-network");
    netOkAt = Date.now();
  }
  // ---------- delivery of an Ethereum -> X1 message (FUN-03): the mailbox creates this account when it processes the ID ----------
  function processedPda(idHex) {
    const id = new Uint8Array(32); const h = idHex.replace(/^0x/, "");
    for (let i = 0; i < 32; i++) id[i] = parseInt(h.substr(i * 2, 2), 16);
    return pda([enc("hyperlane"), enc("-"), enc("processed_message"), enc("-"), id], C.mailbox);
  }
  async function isProcessed(idHex) {
    const r = await rpc("getAccountInfo", [processedPda(idHex).toBase58(), { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 0 } }]);
    return r.value !== null;
  }

  // ---------- balances and cost preview ----------
  async function balances(owner) {
    const o = pk(owner);
    const [lam, ta] = await Promise.all([
      rpc("getBalance", [owner, { commitment: "confirmed" }]),
      rpc("getTokenAccountBalance", [ataOf(o).toBase58(), { commitment: "confirmed" }]).catch(() => null),
    ]);
    return { xnt: BigInt(lam.value), token9: ta ? BigInt(ta.value.amount) : 0n, hasAta: !!ta };
  }
  // Cost = drop of the sender's lamports in the simulation. The X1 runtime charges the signature fee in the simulation too
  // (checked against the CLI tx: 0.05261486 = 0.05011336 IGP + rent + 0.0025015 fee), so delivery = drop - fee - protocol fee.
  async function preview({ owner, recipientEth, amount9 }) {
    const sender = pk(owner), unique = W.Keypair.generate().publicKey;
    const bh = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const tx = buildTx({ sender, recipientEth, amount9, unique, blockhash: bh.value.blockhash });
    const msg = tx.serializeMessage();
    const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const [sim, fee, pre] = await Promise.all([
      rpc("simulateTransaction", [b64(wire), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed",
        accounts: { encoding: "base64", addresses: [owner] } }]),
      rpc("getFeeForMessage", [b64(msg), { commitment: "confirmed" }]),
      rpc("getBalance", [owner, { commitment: "confirmed" }]),
    ]);
    const v = sim.value;
    const logs = v.logs || [];
    const paid = logs.find((l) => /Paid IGP .* for (\d+) gas/.test(l));
    const proto = logs.find((l) => /Protocol fee of \d+ paid/.test(l));   // the X1 mailbox protocol fee (bridge fee in XNT)
    const out = { ok: !v.err, err: v.err, logs, unitsConsumed: v.unitsConsumed, networkFee: BigInt(fee.value ?? 0), igpGas: paid ? Number(paid.match(/for (\d+) gas/)[1]) : null,
      protocolFee: proto ? BigInt(proto.match(/Protocol fee of (\d+)/)[1]) : 0n };
    if (!v.err && v.accounts && v.accounts[0]) {
      const drop = BigInt(pre.value) - BigInt(v.accounts[0].lamports);
      const rest = drop >= out.networkFee ? drop - out.networkFee : drop;
      out.deliveryCost = rest >= out.protocolFee ? rest - out.protocolFee : rest;   // IGP payment + rent of the 2 new accounts
      out.total = out.deliveryCost + out.networkFee + out.protocolFee;
    }
    return out;
  }

  // ---------- Wallet Standard (no framework) ----------
  const wallets = new Set();
  const listeners = new Set();
  const usable = (w) => w && w.features && w.features["standard:connect"] && w.features["solana:signTransaction"];
  function register(...ws) { let n = 0; for (const w of ws) if (usable(w) && !wallets.has(w)) { wallets.add(w); n++; } if (n) listeners.forEach((f) => f(list())); return () => {}; }
  window.addEventListener("wallet-standard:register-wallet", (e) => { try { e.detail({ register }); } catch {} });
  try { window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register } })); } catch {}
  function list() { return [...wallets].map((w) => ({ name: w.name, icon: typeof w.icon === "string" && /^data:image\/(svg\+xml|png|webp|gif);base64,/.test(w.icon) ? w.icon : null, wallet: w })); }
  function onWallets(f) { listeners.add(f); f(list()); }
  // NET-03: the account must be a Solana-type account (chains solana:*, 32-byte key); an Ethereum account of a
  // multi-chain wallet is refused. silent: restore an earlier authorization without a prompt (FUN-01/02, NET-05).
  async function connect(w, silent) {
    const r = await w.features["standard:connect"].connect(silent ? { silent: true } : undefined);
    const acc = (r && r.accounts && r.accounts[0]) || w.accounts[0];
    if (!acc) throw new Error("no account");
    const bad = CORE.x1AccountProblem(acc);
    if (bad) throw new Error("x1-" + bad);
    return { wallet: w, account: acc, address: new W.PublicKey(acc.publicKey).toBase58() };
  }
  /** account changes or disconnects in the wallet (Wallet Standard standard:events) -> f(address or null); returns off() */
  function onAccountChange(conn, f) {
    const ev = conn.wallet.features["standard:events"];
    if (!ev || !ev.on) return () => {};
    return ev.on("change", (p) => {
      if (!p || !("accounts" in p)) return;
      const acc = p.accounts && p.accounts[0];
      f(acc && !CORE.x1AccountProblem(acc) ? new W.PublicKey(acc.publicKey).toBase58() : null);
    });
  }
  async function disconnect(w) { try { await w.features["standard:disconnect"]?.disconnect(); } catch {} }

  // ---------- send ----------
  // steps(n, extra) is called by the page to update the tracker; returns { signature, messageId }
  // R7-05: check() is called after the LAST await before the wallet window opens and again after the signature,
  // before anything is broadcast (it throws when the account, network or operation changed).
  // R7-06: onSigned(signature, lastValidBlockHeight) persists the operation before the first broadcast.
  async function send({ conn, recipientEth, amount9, steps, check = () => {}, onSigned = () => {} }) {
    const sender = pk(conn.address);
    await checkNetwork();
    const uniqueKp = W.Keypair.generate();   // one-time message account, never stored
    const bh = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const tx = buildTx({ sender, recipientEth, amount9, unique: uniqueKp.publicKey, blockhash: bh.value.blockhash });
    const before = tx.serializeMessage();
    steps("sign");
    const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const chain = CORE.x1SignChain(conn.account);
    check();
    // FUN-05: a wallet window that never opens must not leave the page waiting; nothing is sent without a signature
    const [res] = await CORE.withTimeout(conn.wallet.features["solana:signTransaction"].signTransaction({ account: conn.account, transaction: wire, ...(chain ? { chain } : {}) }),
      C.signTimeoutMs, "sign-timeout");
    const signed = W.Transaction.from(res.signedTransaction);
    const after = signed.serializeMessage();
    if (before.length !== after.length || before.some((b, i) => b !== after[i])) throw new Error("wallet-changed-tx");
    if (!signed.signatures.find((s) => s.publicKey.equals(sender))?.signature) throw new Error("wallet-no-signature");
    check();
    signed.partialSign(uniqueKp);
    const raw = signed.serialize();   // verifies all signatures
    const sig = encode58(signed.signature);
    onSigned(sig, bh.value.lastValidBlockHeight);
    steps("sent", sig);
    // Send and re-send until the network has the transaction, then wait for FINALIZED: only finalized decides success or
    // failure (Codex round 8); "confirmed" is still in progress. An expired blockhash before the transaction was seen is
    // reconciled from history; anything unresolved is UNKNOWN with the signature, never "failed".
    let seen = false, done = false;
    const tSeen = { at: 0 };
    for (;;) {
      if (!seen) await rpc("sendTransaction", [b64(raw), { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }]).catch((e) => {
        if (!/already been processed|AlreadyProcessed/i.test(e.message)) throw e;
      });
      for (let i = 0; i < 4 && !done; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const st = await rpc("getSignatureStatuses", [[sig], { searchTransactionHistory: false }]).catch(() => null);
        const s = st && st.value && st.value[0];
        if (!s) continue;
        if (!seen) { seen = true; tSeen.at = Date.now(); }
        if (s.confirmationStatus === "finalized") { if (s.err) throw new Error("tx-failed: " + JSON.stringify(s.err)); done = true; }
      }
      if (done) break;
      if (seen && Date.now() - tSeen.at > 120000) { const e = new Error("unknown"); e.signature = sig; throw e; }   // seen, not finalized in 2 min
      if (!seen) {
        const h = await rpc("getBlockHeight", [{ commitment: "confirmed" }]).catch(() => 0);
        if (h > bh.value.lastValidBlockHeight) {
          const r = await reconcile(sig);
          if (r.status === "ok") break;
          if (r.status === "failed") throw new Error("tx-failed: " + JSON.stringify(r.err));
          const e = new Error("unknown"); e.signature = sig; throw e;
        }
      }
    }
    const messageId = await messageIdOf(sig);
    return { signature: sig, messageId };
  }
  /** the result of a signature from the transaction history: ok / failed only when FINALIZED; pending = seen but not
   *  finalized yet; none = not found after a few tries */
  async function reconcile(sig, tries = 5) {
    let pending = false;
    for (let i = 0; i < tries; i++) {
      const st = await rpc("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]).catch(() => null);
      const s = st && st.value && st.value[0];
      if (s && s.confirmationStatus === "finalized") return s.err ? { status: "failed", err: s.err } : { status: "ok" };
      if (s) pending = true;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 3000));
    }
    return { status: pending ? "pending" : "none" };
  }
  async function finalizedTx(sig) {
    return rpc("getTransaction", [sig, { encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 0 }]).catch(() => null);
  }
  /** fee payer of a finalized transaction (= the sender of a transfer built by this page), or null */
  async function feePayerOf(sig) { const t = await finalizedTx(sig); return t ? t.transaction.message.accountKeys[0] : null; }
  /** R8-06 / R9-03: a stored X1 -> Ethereum record is checked against its transaction, not against log text:
   *  - the fee payer is `from`, the transaction succeeded (finalized);
   *  - exactly one real TransferRemote instruction of OUR warp-route program (top level or CPI), to the Ethereum domain,
   *    sent by `from`;
   *  - the dispatched-message account of that instruction is a mailbox DISPATCH account; its message is rebuilt and
   *    checked: origin X1, sender = our program, destination Ethereum, recipient = our lockbox, body = the instruction's
   *    recipient and amount; the message ID is keccak256 of that message.
   *  -> { status: "ok", id } | { status: "mismatch" } | { status: "pending" } (data not available yet) */
  async function verifyX2E(sig, from) {
    const t = await finalizedTx(sig);
    if (!t) return { status: "pending" };
    const keys = [...t.transaction.message.accountKeys, ...(t.meta?.loadedAddresses?.writable || []), ...(t.meta?.loadedAddresses?.readonly || [])];
    if ((t.meta && t.meta.err) || keys[0] !== from) return { status: "mismatch" };
    const prog = C.program.toBase58();
    const all = [...t.transaction.message.instructions, ...(t.meta?.innerInstructions || []).flatMap((x) => x.instructions)];
    const ours = all.filter((ix) => keys[ix.programIdIndex] === prog).map((ix) => ({ data: decode58(ix.data), accts: ix.accounts.map((i) => keys[i]) }))
      .filter((x) => x.data.length >= 77 && x.data.slice(0, 8).every((b) => b === 1) && x.data[8] === 1);
    if (ours.length !== 1) return { status: "mismatch" };
    const ix = ours[0], dv = new DataView(ix.data.buffer, ix.data.byteOffset);
    if (dv.getUint32(9, true) !== C.ethDomain || ix.accts[6] !== from || !ix.accts[8]) return { status: "mismatch" };
    const ixRecipient = ix.data.slice(13, 45);
    let ixAmount = 0n; for (let i = 31; i >= 0; i--) ixAmount = (ixAmount << 8n) | BigInt(ix.data[45 + i]);
    // R10-06: the account is read at a slot >= the transaction's (another, lagging backend may not have it yet);
    // absence counts only when the answer's context slot proves it, anything else (incl. -32016) is pending
    if (!Number.isSafeInteger(t.slot)) return { status: "pending" };
    const acc = await rpc("getAccountInfo", [ix.accts[8], { encoding: "base64", commitment: "finalized", minContextSlot: t.slot }]).catch(() => null);
    if (!acc || !(acc.context && acc.context.slot >= t.slot)) return { status: "pending" };
    if (!acc.value || acc.value.owner !== C.mailbox.toBase58()) return { status: "mismatch" };
    const d = Uint8Array.from(atob(acc.value.data[0]), (c) => c.charCodeAt(0));
    if (d.length < 53 + 77 + 64 || d[0] !== 1 || new TextDecoder().decode(d.slice(1, 9)) !== "DISPATCH") return { status: "mismatch" };
    const m = d.slice(53), mv = new DataView(m.buffer, m.byteOffset);
    const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const routerWord = new Uint8Array(32); for (let i = 0; i < 20; i++) routerWord[12 + i] = parseInt(C.router.slice(2 + i * 2, 4 + i * 2), 16);
    let bodyAmount = 0n; for (let i = 0; i < 32; i++) bodyAmount = (bodyAmount << 8n) | BigInt(m[109 + i]);
    const ok = mv.getUint32(5) === C.x1Domain && eq(m.slice(9, 41), C.program.toBytes()) && mv.getUint32(41) === C.ethDomain
      && eq(m.slice(45, 77), routerWord) && eq(m.slice(77, 109), ixRecipient) && bodyAmount === ixAmount * 10n ** 9n;   // body in Ethereum decimals (18), instruction in X1 decimals (9)
    return ok ? { status: "ok", id: CORE.keccak256(m) } : { status: "mismatch" };
  }
  function decode58(s) {
    let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) return new Uint8Array(0); n = n * 58n + BigInt(i); }
    const out = []; while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
    for (const c of s) { if (c !== "1") break; out.unshift(0); }
    return Uint8Array.from(out);
  }
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function encode58(u8) {
    let n = 0n; for (const b of u8) n = n * 256n + BigInt(b);
    let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    for (const b of u8) { if (b !== 0) break; s = "1" + s; }
    return s;
  }
  async function messageIdOf(sig) {
    for (let i = 0; i < 10; i++) {
      const t = await finalizedTx(sig);
      const l = t && t.meta && (t.meta.logMessages || []).find((x) => /Dispatched message to \d+, ID 0x[0-9a-f]{64}/.test(x));
      if (l) return l.match(/0x[0-9a-f]{64}/)[0];
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  }

  window.X1BRIDGE = { C, buildTx, instructionData, ataOf, checkConstants, balances, preview, onWallets, connect, disconnect, onAccountChange, send, messageIdOf, encode58,
    checkNetwork, processedPda, isProcessed, reconcile, feePayerOf, verifyX2E };
})();
