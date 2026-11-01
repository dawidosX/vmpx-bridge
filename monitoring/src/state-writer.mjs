// Evidence cache writer (round F, Codex R8-01). The cache is an optimisation (it saves a rescan after a restart), so it
// must never hold back the result of a tick:
//  - the monitor publishes the result FIRST and only then hands the state to write(), without waiting for it;
//  - every write goes to its own temporary file (<file>.<generation>.tmp), is flushed, then renamed over <file>;
//  - renames run one at a time and the newest generation wins: a write that finishes after a newer one was renamed is
//    dropped (its temporary file is removed), so a late, slow write can never replace a newer state;
//  - write() resolves "timeout" after timeoutMs even if the file system call hangs; at most maxInFlight writes are
//    pending, further ones are skipped (a hung disk does not pile up writes or block the threads of the I/O pool).
// fs: { writeAndSync(path, text), rename(from, to), unlink(path) } (injected so the ordering can be tested).

export function createStateWriter({ file, fs, timeoutMs = 10000, maxInFlight = 2 }) {
  let gen = 0, renamedGen = 0, inFlight = 0, chain = Promise.resolve();
  const stats = { ok: 0, errors: 0, timeouts: 0, skipped: 0, stale: 0 };

  function renameNewest(g, tmp) {
    const p = chain.then(async () => {
      if (g <= renamedGen) { stats.stale++; await fs.unlink(tmp).catch(() => {}); return "stale"; }
      await fs.rename(tmp, file); renamedGen = g; stats.ok++; return "ok";
    });
    chain = p.catch(() => {});   // one failed rename does not stop later ones
    return p;
  }

  /** -> Promise<"ok" | "stale" | "timeout" | "skipped">, rejects on a write error (counted in stats.errors) */
  function write(state) {
    if (inFlight >= maxInFlight) { stats.skipped++; return Promise.resolve("skipped"); }
    const g = ++gen, tmp = `${file}.${g}.tmp`, body = JSON.stringify(state);
    inFlight++;
    const work = (async () => { await fs.writeAndSync(tmp, body); return renameNewest(g, tmp); })()
      .catch((e) => { stats.errors++; fs.unlink(tmp).catch(() => {}); throw e; })
      .finally(() => { inFlight--; });
    let timer;
    const limit = new Promise((resolve) => { timer = setTimeout(() => { stats.timeouts++; resolve("timeout"); }, timeoutMs); });
    work.catch(() => {});   // a write that fails after its timeout was reported must not become an unhandled rejection
    return Promise.race([work, limit]).finally(() => clearTimeout(timer));
  }

  return { write, stats, get inFlight() { return inFlight; }, get generation() { return gen; }, get renamedGeneration() { return renamedGen; } };
}
