// Solana program-derived addresses without dependencies (same algorithm as svm/compat/check-x1.mjs and
// indexer/activity.py): sha256(seeds | bump | program | "ProgramDerivedAddress"), first bump whose hash is NOT a
// point on ed25519.
import { createHash } from "node:crypto";

const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58enc(b) {
  let n = BigInt("0x" + (Buffer.from(b).toString("hex") || "0")), s = "";
  while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
  for (const x of b) { if (x === 0) s = "1" + s; else break; }
  return s;
}
export function b58dec(s) {
  let n = 0n; for (const c of s) n = n * 58n + BigInt(A.indexOf(c));
  let h = n.toString(16); if (h.length % 2) h = "0" + h; if (n === 0n) h = "";
  return Buffer.concat([Buffer.alloc(s.length - s.replace(/^1+/, "").length), Buffer.from(h, "hex")]);
}
const P = 2n ** 255n - 19n;
const md = (a) => ((a % P) + P) % P;
const pw = (b, e) => { let r = 1n; b = md(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
const D = md(-121665n * pw(121666n, P - 2n));
function onCurve(h) {
  const y = BigInt("0x" + Buffer.from(h).reverse().toString("hex")) & ((1n << 255n) - 1n);
  if (y >= P) return false;
  const u = md(y * y - 1n), v = md(D * y * y + 1n), x2 = u * pw(v, P - 2n) % P;
  if (x2 === 0n) return (h[31] >> 7) === 0;
  let x = pw(x2, (P + 3n) / 8n);
  if (md(x * x - x2) !== 0n) x = x * pw(2n, (P - 1n) / 4n) % P;
  return md(x * x - x2) === 0n;
}
export function findPda(seeds, programB58) {
  const prog = b58dec(programB58);
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash("sha256").update(Buffer.concat([...seeds.map((s) => Buffer.from(s)), Buffer.from([bump]), prog, Buffer.from("ProgramDerivedAddress")])).digest();
    if (!onCurve(h)) return b58enc(h);
  }
  throw new Error("no PDA");
}
/** X1 mailbox account that exists once an Ethereum -> X1 message is processed (upstream mailbox pda_seeds.rs). */
export function processedMessagePda(messageIdHex, mailboxB58) {
  return findPda(["hyperlane", "-", "processed_message", "-", Buffer.from(messageIdHex.replace(/^0x/, ""), "hex")], mailboxB58);
}
