import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, classifyMintState, stuckMessages, SCALE } from "../src/invariant.mjs";

const E = 10n ** 18n;

test("balanced: no in-flight", () => {
  const r = evaluate({ locked: 1000n * E, supply9: 1000n * SCALE });
  assert.equal(r.severity, "OK");
  assert.equal(r.coverageBps, 10_000);
});

test("balanced with in-flight both directions", () => {
  const r = evaluate({ locked: 1000n * E, supply9: 700n * SCALE, pendingE2X: 200n * E, pendingX2E: 100n * E });
  assert.equal(r.severity, "OK");
  assert.equal(r.delta, 0n);
});

test("CRITICAL: X1 supply exceeds lock (unbacked mint)", () => {
  const r = evaluate({ locked: 999n * E, supply9: 1000n * SCALE });
  assert.equal(r.severity, "CRITICAL");
});

test("CRITICAL: in-flight burn not redeemable", () => {
  const r = evaluate({ locked: 1000n * E, supply9: 900n * SCALE, pendingX2E: 150n * E });
  assert.equal(r.severity, "CRITICAL");
});

test("OK + surplus reported separately (donation / direct transfer, Codex I-01)", () => {
  const r = evaluate({ locked: 1001n * E, supply9: 1000n * SCALE });
  assert.equal(r.severity, "OK");
  assert.equal(r.surplus, 1n * E);
  assert.match(r.reasons.join(" "), /not a liability/);
});

test("surplus does not hide a shortfall of in-flight burns", () => {
  const r = evaluate({ locked: 1001n * E, supply9: 1000n * SCALE, pendingX2E: 2n * E });
  assert.equal(r.severity, "CRITICAL");
  assert.equal(r.surplus, 0n);
});

test("tolerance absorbs indexer lag only within bound", () => {
  assert.equal(evaluate({ locked: 1000n * E, supply9: 1000n * SCALE, pendingE2X: 1n, toleranceBase: 5n }).severity, "OK");
});

test("mint authority / freeze / extensions", () => {
  const mint = "Mint111";
  assert.deepEqual(classifyMintState({ mint, mintAuthority: mint, freezeAuthority: null, decimals: 9, extensions: ["metadataPointer", "tokenMetadata"] }), []);
  const bad = classifyMintState({ mint, mintAuthority: "Deployer", freezeAuthority: "X", decimals: 9, extensions: ["permanentDelegate"] });
  assert.equal(bad.length, 3);
  assert.ok(bad.every(([s]) => s === "CRITICAL"));
});

test("stuck messages", () => {
  const p = [{ id: "a", dispatchedAt: 0 }, { id: "b", dispatchedAt: 900 }];
  assert.deepEqual(stuckMessages(p, 1000, 600).map((m) => m.id), ["a"]);
});
