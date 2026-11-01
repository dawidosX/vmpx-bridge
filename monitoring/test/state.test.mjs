// Round D: the evidence state is bound to the configuration (chain ID, X1 genesis, route, FROM_BLOCK), FROM_BLOCK is
// checked against the lockbox deployment block, and the state file is written only after a finished tick.
// Runs the real monitor.mjs against a local fake JSON-RPC server (an empty, healthy bridge).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MINT = "GjSYfUZueEiH7pjP6df1aJimEBzDZKdJbP17akxjCBzj";

function fakeRpc({ deployBlock, mintAuthority = MINT }) {
  const now = () => Math.floor(Date.now() / 1000);
  const answer = (method, params) => {
    switch (method) {
      case "eth_chainId": return "0xaa36a7";
      case "getGenesisHash": return "Genesis1111111111111111111111111111111111111";
      case "eth_getCode": return parseInt(params[1], 16) >= deployBlock ? "0x6080" : "0x";
      case "eth_getBlockByNumber": return { number: "0x" + (deployBlock + 500).toString(16), timestamp: "0x" + (now() - 60).toString(16) };
      case "eth_blockNumber": return "0x" + (deployBlock + 510).toString(16);
      case "eth_getLogs": return [];
      case "eth_call": return "0x" + "0".repeat(64);
      case "getProgramAccounts": return { context: { slot: 900 }, value: [] };
      case "getBlockTime": return now() - 30;
      case "getAccountInfo": return { context: { slot: 901 }, value: { data: { parsed: { info: { supply: "0", decimals: 9, mintAuthority, freezeAuthority: null } } } } };
      default: throw new Error(method);
    }
  };
  return http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      const { method, params } = JSON.parse(b);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: answer(method, params) }));
    });
  });
}

async function runMonitor({ fromBlock, deployBlock, seedState, ms = 3500, mintAuthority, stateFile: sf }) {
  const srv = fakeRpc({ deployBlock, mintAuthority });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const rpc = `http://127.0.0.1:${srv.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), "mon-")), stateFile = sf || join(dir, "ev.json"), actFile = join(dir, "activity.json");
  writeFileSync(actFile, JSON.stringify({ updated: Math.floor(Date.now() / 1000), index: { complete: true }, items: [] }));
  if (seedState) writeFileSync(stateFile, JSON.stringify(seedState));
  const port = 9800 + Math.floor(Math.random() * 90);
  let out = "";
  const child = spawn(process.execPath, [join(here, "../src/monitor.mjs")], { env: { ...process.env,
    ETH_RPC: rpc, LOGS_RPC: rpc, ETH_LOGS_RPC2: rpc, X1_RPC: rpc, X1_RPC2: rpc, ACTIVITY: actFile, LOCKBOX: "0x" + "11".repeat(20), TOKEN: "0x" + "22".repeat(20), ETH_MAILBOX: "0x" + "33".repeat(20),
    X1_MAILBOX: "74gG4yHE7DV4dU51GHrdX2z4BwtfuYQanSMizBTEjUk", X1_PROGRAM: "8hA1rhuAuCr1HaWP9x66Ptua9gpqK5jS39LhmN4h41fR", X1_MINT: MINT,
    ETH_DOMAIN: "11155111", X1_DOMAIN: "1479626325", FROM_BLOCK: String(fromBlock), STATE_FILE: stateFile, POLL_SEC: "1", PORT: String(port) } });
  child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
  try {
    await sleep(ms);
    const m = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
    await sleep(150);   // the tick line printed before that answer may reach this pipe a moment later
    const v = (k) => Number((m.match(new RegExp(`^${k} (\\S+)`, "m")) || [])[1]);
    return { v, out, state: existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null };
  } finally { child.kill(); srv.close(); }
}

test("healthy, empty bridge: OK, evidence ok, state written with the configuration fingerprint", async () => {
  const { v, out, state } = await runMonitor({ fromBlock: 1000, deployBlock: 1000 });
  assert.equal(v("vmpx_bridge_severity"), 0, out); assert.equal(v("vmpx_bridge_evidence_ok"), 1);
  const fp = JSON.parse(state.fingerprint);
  assert.equal(fp.chainId, 11155111); assert.equal(fp.fromBlock, 1000); assert.equal(fp.genesis, "Genesis1111111111111111111111111111111111111");
  assert.equal(state.ethDispatchTo, 1500);
});

test("a state from another configuration (FROM_BLOCK changed) is discarded and rebuilt", async () => {
  const old = { fingerprint: JSON.stringify({ fromBlock: 1 }), ethDispatchTo: 99999999, ethDispatch: { "0xdead": 5 }, ethProcessTo: 99999999, ethProcess: {}, x1Processed: {}, x1DispatchByKey: {} };
  const { out, state } = await runMonitor({ fromBlock: 1000, deployBlock: 1000, seedState: old });
  assert.match(out, /another configuration: discarded, full rescan/);
  assert.equal(state.ethDispatchTo, 1500); assert.deepEqual(state.ethDispatch, {});
});

test("FROM_BLOCK after the deployment block (lockbox code already there) is UNKNOWN and writes no state", async () => {
  const { v, out, state } = await runMonitor({ fromBlock: 1200, deployBlock: 1000 });
  assert.equal(v("vmpx_bridge_severity"), 3); assert.equal(v("vmpx_bridge_evidence_ok"), 0);
  assert.match(out, /FROM_BLOCK 1200 is not the lockbox deployment block/);
  assert.equal(state, null);
});

test("FROM_BLOCK before the deployment block is refused too (code missing at FROM_BLOCK)", async () => {
  const { out } = await runMonitor({ fromBlock: 900, deployBlock: 1000 });
  assert.match(out, /FROM_BLOCK 900 is not the lockbox deployment block/);
});

test("R7-01: a failed evidence cache write is reported, but never replaces a CRITICAL (changed mint authority)", async () => {
  const { v, out } = await runMonitor({ fromBlock: 1000, deployBlock: 1000, mintAuthority: "Evi1111111111111111111111111111111111111111",
    stateFile: join(mkdtempSync(join(tmpdir(), "mon-")), "no-such-dir", "ev.json") });
  assert.equal(v("vmpx_bridge_severity"), 2, out);
  assert.ok(v("vmpx_bridge_state_write_errors_total") >= 1);
  assert.match(out, /evidence cache write failed/);
  // R11-06: every tick line carries tick=<T>; the CRITICAL one equals the exported last_critical_timestamp
  const ticks = [...out.matchAll(/^\S+Z CRITICAL tick=(\d+) /gm)].map((m) => Number(m[1]));
  assert.ok(ticks.includes(v("vmpx_bridge_last_critical_timestamp")), out);
});

test("R8-01: a cache write that NEVER finishes (FIFO without a reader) does not hold back a CRITICAL or the next ticks", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "mon-")), sf = join(dir, "ev.json");
  for (const g of [1, 2]) execFileSync("mkfifo", [`${sf}.${g}.tmp`]);   // open(..., "w") on a FIFO blocks until a reader comes
  const srv = fakeRpc({ deployBlock: 1000, mintAuthority: "Evi1111111111111111111111111111111111111111" });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const rpc = `http://127.0.0.1:${srv.address().port}`, actFile = join(dir, "activity.json");
  writeFileSync(actFile, JSON.stringify({ updated: Math.floor(Date.now() / 1000), index: { complete: true }, items: [] }));
  const port = 9800 + Math.floor(Math.random() * 90);
  let out = "";
  const child = spawn(process.execPath, [join(here, "../src/monitor.mjs")], { env: { ...process.env,
    ETH_RPC: rpc, LOGS_RPC: rpc, ETH_LOGS_RPC2: rpc, X1_RPC: rpc, X1_RPC2: rpc, ACTIVITY: actFile, LOCKBOX: "0x" + "11".repeat(20), TOKEN: "0x" + "22".repeat(20), ETH_MAILBOX: "0x" + "33".repeat(20),
    X1_MAILBOX: "74gG4yHE7DV4dU51GHrdX2z4BwtfuYQanSMizBTEjUk", X1_PROGRAM: "8hA1rhuAuCr1HaWP9x66Ptua9gpqK5jS39LhmN4h41fR", X1_MINT: MINT,
    ETH_DOMAIN: "11155111", X1_DOMAIN: "1479626325", FROM_BLOCK: "1000", STATE_FILE: sf, POLL_SEC: "1", STATE_WRITE_TIMEOUT_S: "1", PORT: String(port) } });
  child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
  const metrics = async () => { const m = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text(); return (k) => Number((m.match(new RegExp(`^${k} (\\S+)`, "m")) || [])[1]); };
  try {
    await sleep(3500);
    const a = await metrics();
    await sleep(2500);
    const b = await metrics(), now = Math.floor(Date.now() / 1000);
    assert.equal(b("vmpx_bridge_severity"), 2, out);
    assert.ok(now - b("vmpx_bridge_last_critical_timestamp") <= 2, "last_critical is fresh although every cache write hangs");
    assert.equal(b("vmpx_bridge_last_critical_timestamp"), b("vmpx_bridge_last_result_timestamp"), "the CRITICAL is the last published result");
    assert.ok(b("vmpx_bridge_last_result_timestamp") > a("vmpx_bridge_last_result_timestamp"), "the next ticks keep running");
    assert.ok(b("vmpx_bridge_state_write_timeouts_total") >= 1, "the hung write is counted");
    assert.ok(b("vmpx_bridge_state_write_skipped_total") >= 1, "no pile-up of writes on a hung disk");
    assert.match(out, /evidence cache write timeout \(the published result is not affected\)/);
  } finally { child.kill("SIGKILL"); srv.close(); }
});
