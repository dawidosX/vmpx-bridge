// Message IDs: @noble/hashes keccak_256 (pinned) against vectors computed with Foundry's `cast keccak`, including the
// 136-byte rate boundary, and against a real message ID from X1 testnet. If `cast` is installed, it is also run live.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { keccak256 } from "../src/evidence.mjs";

const VECTORS = [   // [bytes, cast keccak 0x<hex>] computed 31 Oct 2026 with cast (Foundry)
  [Buffer.alloc(0), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"],
  [Buffer.from("abc"), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"],
  [Buffer.alloc(135, 7), "0x316ef5fac392334013c099d269106bf60e177aa75b6b3e0ccefc0cd19ef6adb2"],
  [Buffer.alloc(136, 7), "0xfe7b19f0a766c96fdae42d45fa0de3423bfe68a710492afee13853eb6004d9c4"],
  [Buffer.alloc(300, 9), "0x53749b9038206576c56eb66b4e1e84e228bf7c1d46a1b8f1edd9511c6039d561"],
];

test("noble keccak_256 matches cast keccak vectors (incl. rate boundary 135/136 bytes)", () => {
  for (const [b, want] of VECTORS) assert.equal(keccak256(b), want, `${b.length} bytes`);
});

test("noble keccak_256 matches cast keccak live (skipped without cast)", (t) => {
  let cast;
  try { execFileSync("cast", ["--version"], { stdio: "ignore" }); cast = "cast"; } catch { return t.skip("cast not installed"); }
  for (const [b] of VECTORS) assert.equal(keccak256(b), execFileSync(cast, ["keccak", "0x" + b.toString("hex")]).toString().trim());
});

test("a real Hyperlane message from X1 testnet hashes to its processed-message ID", () => {
  // message of the InboxProcess that created the processed account DB42a225… on X1 testnet (30 Oct 2026)
  const msg = Buffer.from("03000d584900aa36a7000000000000000000000000048c8208b0b37157fbbd71a737a34b1c5a00f6c858314e55724b3be00087c10e54637d08c713120a53092f5650f82a03fe3e22fd5e1e89cc8677e172d3cdbba85fefc68df3f3b7e0e3067cda981fa9fd71281e92da74e1b000000000000000000000000000000000000000000000152c41850c204c871600", "hex");
  assert.equal(keccak256(msg), "0x65cae0b13c8559239a4965f70502b9fa0b4a0e17debee9e1ce87bfec1ade197e");
});
