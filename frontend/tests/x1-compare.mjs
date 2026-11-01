// Usage: node frontend/tests/x1-compare.mjs frontend/www <owner X1 address holding tVMPXe and XNT> <recipient 0x…>
//   (read-only: builds, compares with the CLI tx, simulates; never signs or sends)
// Compares the page's transfer_remote with the CLI transaction 2mvFgTvW… (test 2) and simulates without signing.
import fs from "node:fs"; import vm from "node:vm";
const www = process.argv[2];
const ctx = { window: {}, TextEncoder, TextDecoder, crypto: globalThis.crypto, fetch, btoa, atob, console, setTimeout, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, BigInt, Uint8Array, DataView };
ctx.window = ctx; ctx.window.addEventListener = () => {}; ctx.window.dispatchEvent = () => {}; ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(www + "/vendor/solana-web3-1.98.4.iife.min.js", "utf8"), ctx);
vm.runInContext(fs.readFileSync(www + "/x1.js", "utf8"), ctx);
const X = ctx.X1BRIDGE, W = ctx.solanaWeb3;
const rpc = async (m, p) => (await (await fetch("https://rpc.testnet.x1.xyz", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) })).json()).result;
let pass = 0, fail = 0; const ok = (name, c, info = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"} ${name}${info ? "  " + info : ""}`); };

console.log("== derived constants", JSON.stringify(X.checkConstants()));
for (const [k, v] of Object.entries(X.checkConstants())) ok("PDA " + k, v);

const cli = await rpc("getTransaction", ["2mvFgTvWzGjuhfST4bZDJkeeipfaqm5SJe12CSs41KPLv54AYWdoe6NrtYFxizT86g75L6y7dSzRzjPdHwMnu5C7", { encoding: "json", maxSupportedTransactionVersion: 0 }]);
const m = cli.transaction.message, K = m.accountKeys, h = m.header;
const isS = (i) => i < h.numRequiredSignatures;
const isW = (i) => i < h.numRequiredSignatures - h.numReadonlySignedAccounts || (i >= h.numRequiredSignatures && i < K.length - h.numReadonlyUnsignedAccounts);
const cliIx = m.instructions.map((ix) => ({ program: K[ix.programIdIndex], data: Buffer.from(W.bs58 ? W.bs58.decode(ix.data) : []).toString("hex"), keys: ix.accounts.map((a) => [K[a], isS(a), isW(a)]) }));
const dec58 = (s) => { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let n = 0n; for (const c of s) n = n * 58n + BigInt(A.indexOf(c)); let hex = n.toString(16); if (hex.length % 2) hex = "0" + hex; return "00".repeat(s.length - s.replace(/^1+/, "").length) + hex; };
cliIx.forEach((ix, i) => ix.data = dec58(m.instructions[i].data));

// rebuild with the same sender and the same one-time account -> everything except the blockhash must match
// taken from the CLI tx itself: sender = writable signer other than the fee payer, unique = read-only signer,
// recipient = bytes32 at offset 13 of the transfer_remote data (the 17-account instruction)
const signers = K.map((_, i) => i).filter(isS);
const sender = K[signers.find((i) => i > 0 && isW(i))], unique = K[signers.find((i) => !isW(i))];
const tr = cliIx.reduce((a, b) => (b.keys.length > a.keys.length ? b : a));
const cliRecipient = "0x" + tr.data.slice(26 + 24, 26 + 64);
const tx = X.buildTx({ sender: new W.PublicKey(sender), recipientEth: cliRecipient, amount9: 1000000000n, unique: new W.PublicKey(unique), blockhash: m.recentBlockhash });
const ours = tx.instructions.map((ix) => ({ program: ix.programId.toBase58(), data: Buffer.from(ix.data).toString("hex"), keys: ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]) }));
ok("instruction count", ours.length === cliIx.length, `${ours.length} vs ${cliIx.length}`);
ours.forEach((ix, i) => {
  ok(`ix${i} program`, ix.program === cliIx[i].program, ix.program);
  ok(`ix${i} data`, ix.data === cliIx[i].data, ix.data.length / 2 + " bytes");
  ok(`ix${i} accounts`, ix.keys.length === cliIx[i].keys.length, `${ix.keys.length} vs ${cliIx[i].keys.length}`);
  ix.keys.forEach((k, j) => { const c = cliIx[i].keys[j]; if (!(k[0] === c[0] && k[1] === c[1] && k[2] === c[2])) ok(`ix${i} account ${j}`, false, JSON.stringify(k) + " vs " + JSON.stringify(c)); });
});
const allKeysEqual = ours.every((ix, i) => ix.keys.every((k, j) => JSON.stringify(k) === JSON.stringify(cliIx[i].keys[j])));
ok("all 17+0 account metas identical (key, signer, writable)", allKeysEqual);

// simulation without signatures for an address holding tVMPXe and XNT
const owner = process.argv[3], recipientEth = process.argv[4];
if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(recipientEth || "")) { console.log(`PASS ${pass} FAIL ${fail} (simulation skipped: pass <owner> <recipient 0x…>)`); process.exit(fail ? 1 : 0); }
const p = await X.preview({ owner, recipientEth, amount9: 1000000000n });
ok("simulation ok", p.ok, JSON.stringify(p.err));
ok("logs BurnChecked", p.logs.some((l) => l.includes("BurnChecked")));
ok("logs Dispatched message", p.logs.some((l) => /Dispatched message to 11155111, ID 0x/.test(l)));
ok("logs Paid IGP", p.igpGas > 0, `gas ${p.igpGas}`);
console.log(`cost: network fee ${Number(p.networkFee) / 1e9} XNT, IGP+rent ${Number(p.deliveryCost) / 1e9} XNT, total ${Number(p.total) / 1e9} XNT, CU ${p.unitsConsumed}`);
const bad = await X.preview({ owner, recipientEth, amount9: 10n ** 18n });
ok("simulation rejects amount > balance", !bad.ok, JSON.stringify(bad.err));
const b = await X.balances(owner); console.log("balances", owner.slice(0, 6), "XNT", Number(b.xnt) / 1e9, "tVMPXe", Number(b.token9) / 1e9);
console.log(`PASS ${pass} FAIL ${fail}`);
