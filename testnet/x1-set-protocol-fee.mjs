// Sets the protocol fee of the X1 Hyperlane mailbox (SetProtocolFeeConfig, instruction 11): a flat fee in lamports that the
// sender of every outgoing message pays to the outbox PDA; ClaimProtocolFees sends it to the beneficiary.
// The mailbox owner signs. The hyperlane-sealevel-client of f556e18 has no command for this, hence this script.
//
// Usage: node testnet/x1-set-protocol-fee.mjs <owner-keypair.json> <fee-lamports> [beneficiary] [--rpc URL] [--mailbox ID] [--yes]
//   --mailbox defaults to the X1 TESTNET mailbox and is required with any other --rpc (no testnet address on mainnet);
//   the outbox is derived from it (PDA hyperlane-outbox). Without --yes it only simulates. Prints public keys only; the keypair file is read locally to sign and never printed.
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path"; import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const args = process.argv.slice(2); const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--rpc", "--mailbox"].includes(args[i - 1])));
const [keyPath, feeArg, beneficiaryArg] = pos;
if (!keyPath || !/^\d+$/.test(feeArg || "")) { console.error("usage: node x1-set-protocol-fee.mjs <owner-keypair.json> <fee-lamports> [beneficiary] [--rpc URL] [--mailbox ID] [--yes]"); process.exit(2); }
const TESTNET_RPC = "https://rpc.testnet.x1.xyz", TESTNET_MAILBOX = "74gG4yHE7DV4dU51GHrdX2z4BwtfuYQanSMizBTEjUk";
const RPC = opt("--rpc", TESTNET_RPC);
if (RPC !== TESTNET_RPC && !flag("--mailbox")) { console.error("--mailbox <id> is required with a non-testnet --rpc"); process.exit(2); }

const ctx = { TextEncoder, TextDecoder, crypto: globalThis.crypto, console, Uint8Array, BigInt }; ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(here, "../frontend/www/vendor/solana-web3-1.98.4.iife.min.js"), "utf8"), ctx);
const W = ctx.solanaWeb3;
const MAILBOX = new W.PublicKey(opt("--mailbox", TESTNET_MAILBOX));
const enc = new TextEncoder();
const [OUTBOX] = W.PublicKey.findProgramAddressSync([enc.encode("hyperlane"), enc.encode("-"), enc.encode("outbox")], MAILBOX);

async function rpc(m, p) {
  const r = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) })).json();
  if (r.error) throw new Error(`${m}: ${JSON.stringify(r.error)}`); return r.result;
}
async function readOutbox() {
  const v = (await rpc("getAccountInfo", [OUTBOX.toBase58(), { encoding: "base64", commitment: "confirmed" }])).value;
  const d = Buffer.from(v.data[0], "base64"); let o = 1 + 4 + 1; let owner = null;
  if (d[o] === 1) { owner = new W.PublicKey(d.subarray(o + 1, o + 33)).toBase58(); o += 33; } else o += 1;
  o += 32 * 32; const count = d.readBigUInt64LE(o); o += 8;
  const max = d.readBigUInt64LE(o); o += 8; const fee = d.readBigUInt64LE(o); o += 8;
  return { owner, count, max, fee, beneficiary: new W.PublicKey(d.subarray(o, o + 32)).toBase58(), lamports: v.lamports };
}

const kp = W.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath.replace(/^~/, process.env.HOME), "utf8"))));
const before = await readOutbox();
const fee = BigInt(feeArg), beneficiary = new W.PublicKey(beneficiaryArg || before.beneficiary);
console.log(`RPC ${RPC}`);
console.log(`outbox ${OUTBOX.toBase58()}: owner ${before.owner}, messages ${before.count}, max_protocol_fee ${Number(before.max) / 1e9} XNT`);
console.log(`now:  fee ${Number(before.fee) / 1e9} XNT, beneficiary ${before.beneficiary}`);
console.log(`new:  fee ${Number(fee) / 1e9} XNT, beneficiary ${beneficiary.toBase58()}`);
console.log(`signer (from keypair file): ${kp.publicKey.toBase58()}`);
if (kp.publicKey.toBase58() !== before.owner) { console.error("STOP: the keypair is not the mailbox owner"); process.exit(1); }
if (fee > before.max) { console.error("STOP: fee is above max_protocol_fee"); process.exit(1); }

const data = new Uint8Array(41); data[0] = 11; new DataView(data.buffer).setBigUint64(1, fee, true); data.set(beneficiary.toBytes(), 9);
const ix = new W.TransactionInstruction({ programId: MAILBOX, data, keys: [{ pubkey: OUTBOX, isSigner: false, isWritable: true }, { pubkey: kp.publicKey, isSigner: true, isWritable: false }] });
const bh = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
const tx = new W.Transaction({ feePayer: kp.publicKey, recentBlockhash: bh.value.blockhash }).add(ix);
tx.sign(kp);
const raw = Buffer.from(tx.serialize()).toString("base64");
const sim = (await rpc("simulateTransaction", [raw, { encoding: "base64", commitment: "confirmed" }])).value;
console.log(`simulation: ${sim.err ? "FAILS " + JSON.stringify(sim.err) : "ok"}`); (sim.logs || []).forEach((l) => console.log("  " + l));
if (sim.err) process.exit(1);
if (!flag("--yes")) { console.log("dry run only (add --yes to send)"); process.exit(0); }

const sig = await rpc("sendTransaction", [raw, { encoding: "base64", preflightCommitment: "confirmed" }]);
console.log(`sent: ${sig}`);
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = (await rpc("getSignatureStatuses", [[sig]])).value[0];
  if (s && s.err) { console.error("FAILED", JSON.stringify(s.err)); process.exit(1); }
  if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) break;
}
const after = await readOutbox();
console.log(`after: fee ${Number(after.fee) / 1e9} XNT, beneficiary ${after.beneficiary}, max ${Number(after.max) / 1e9} XNT`);
console.log(after.fee === fee && after.beneficiary === beneficiary.toBase58() ? "OK" : "MISMATCH");
