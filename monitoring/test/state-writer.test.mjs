// R8-01: the evidence cache writer — bounded in time, newest generation wins, a late old write never replaces a newer one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStateWriter } from "../src/state-writer.mjs";

const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
/** fake fs: writeAndSync waits for gate[path] if one is set; the "disk" maps path -> text */
function fakeFs() {
  const disk = new Map(), gates = new Map(), log = [];
  return { disk, gates, log, fs: {
    writeAndSync: async (path, text) => { log.push("write " + path); if (gates.has(path)) await gates.get(path).p; disk.set(path, text); },
    rename: async (from, to) => { log.push(`rename ${from}`); if (gates.has("rename:" + from)) await gates.get("rename:" + from).p; disk.set(to, disk.get(from)); disk.delete(from); },
    unlink: async (path) => { log.push("unlink " + path); disk.delete(path); },
  } };
}

test("a late completion of an OLDER write never replaces a newer state", async () => {
  const { disk, gates, fs } = fakeFs();
  const w = createStateWriter({ file: "ev.json", fs, timeoutMs: 1000 });
  gates.set("ev.json.1.tmp", deferred());                 // generation 1 hangs in write+fsync
  const a = w.write({ gen: 1 });
  const b = await w.write({ gen: 2 });                      // generation 2 is written and renamed
  assert.equal(b, "ok"); assert.equal(JSON.parse(disk.get("ev.json")).gen, 2);
  gates.get("ev.json.1.tmp").resolve();                     // generation 1 finally finishes
  assert.equal(await a, "stale");
  assert.equal(JSON.parse(disk.get("ev.json")).gen, 2, "the newer state stays");
  assert.ok(!disk.has("ev.json.1.tmp"), "the late temporary file is removed");
  assert.equal(w.stats.stale, 1);
});

test("a write that never finishes resolves 'timeout' at the limit, the cap of writes in flight skips further ones", async () => {
  const { gates, fs } = fakeFs();
  const w = createStateWriter({ file: "ev.json", fs, timeoutMs: 50, maxInFlight: 2 });
  gates.set("ev.json.1.tmp", deferred()); gates.set("ev.json.2.tmp", deferred());
  const t0 = Date.now();
  assert.equal(await w.write({ n: 1 }), "timeout");
  assert.ok(Date.now() - t0 < 500, "bounded");
  assert.equal(await w.write({ n: 2 }), "timeout");
  assert.equal(await w.write({ n: 3 }), "skipped", "two hung writes in flight: no third one");
  assert.deepEqual({ timeouts: w.stats.timeouts, skipped: w.stats.skipped, inFlight: w.inFlight }, { timeouts: 2, skipped: 1, inFlight: 2 });
});

test("a failed rename is counted and does not stop later writes", async () => {
  const { disk, fs } = fakeFs();
  let fail = true;
  const w = createStateWriter({ file: "ev.json", fs: { ...fs, rename: async (a, b) => { if (fail) { fail = false; throw new Error("EIO"); } return fs.rename(a, b); } }, timeoutMs: 1000 });
  await assert.rejects(w.write({ n: 1 }), /EIO/);
  assert.equal(await w.write({ n: 2 }), "ok");
  assert.equal(JSON.parse(disk.get("ev.json")).n, 2); assert.equal(w.stats.errors, 1);
});

test("renames are serialized: two writes finishing together end with the newest on disk", async () => {
  const { disk, gates, fs } = fakeFs();
  const w = createStateWriter({ file: "ev.json", fs, timeoutMs: 1000 });
  gates.set("rename:ev.json.1.tmp", deferred());           // the rename of generation 1 is slow
  const a = w.write({ gen: 1 }), b = w.write({ gen: 2 });
  await new Promise((r) => setTimeout(r, 20));
  gates.get("rename:ev.json.1.tmp").resolve();
  assert.deepEqual([await a, await b], ["ok", "ok"]);
  assert.equal(JSON.parse(disk.get("ev.json")).gen, 2);
});
