// R5-04 / R6-04 / R7-01: a hung RPC must end each task at its own budget by really aborting its requests, ticks must not
// overlap, an aborted evidence task must not commit the evidence state, and the metrics must show it.
// Runs the real monitor.mjs against a local RPC server that never answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("hung RPC: the task budgets abort the requests, no overlapping ticks, no state written, UNKNOWN", async () => {
  let inflight = 0, maxInflight = 0;
  const hang = http.createServer((req, res) => { inflight++; maxInflight = Math.max(maxInflight, inflight); req.on("close", () => inflight--); /* never answer */ });
  await new Promise((r) => hang.listen(0, "127.0.0.1", r));
  const rpc = `http://127.0.0.1:${hang.address().port}`;
  const stateFile = join(mkdtempSync(join(tmpdir(), "mon-")), "ev.json");
  const port = 9900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, [join(here, "../src/monitor.mjs")], { env: { ...process.env,
    ETH_RPC: rpc, LOGS_RPC: rpc, X1_RPC: rpc, ACTIVITY: rpc, LOCKBOX: "0x" + "11".repeat(20), TOKEN: "0x" + "22".repeat(20), ETH_MAILBOX: "0x" + "33".repeat(20),
    X1_MAILBOX: "74gG4yHE7DV4dU51GHrdX2z4BwtfuYQanSMizBTEjUk", X1_PROGRAM: "8hA1rhuAuCr1HaWP9x66Ptua9gpqK5jS39LhmN4h41fR", X1_MINT: "GjSYfUZueEiH7pjP6df1aJimEBzDZKdJbP17akxjCBzj",
    ETH_DOMAIN: "11155111", X1_DOMAIN: "1479626325", FROM_BLOCK: "1", STATE_FILE: stateFile,
    RPC_TIMEOUT_S: "60", MINT_BUDGET_S: "0.5", EVIDENCE_BUDGET_S: "1", BALANCE_BUDGET_S: "1", POLL_SEC: "1", PORT: String(port) }, stdio: "ignore" });
  try {
    await sleep(6500);
    const m = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
    const v = (k) => Number((m.match(new RegExp(`^${k.replace(/[{}]/g, "\\$&")} (\\S+)`, "m")) || [])[1]);
    assert.equal(v("vmpx_bridge_severity"), 3, "UNKNOWN");
    assert.ok(v("vmpx_bridge_poll_errors_total") >= 2, "every hung tick counted as a read error");
    assert.ok(v("vmpx_bridge_last_result_timestamp") > 0, "ticks finish (at the time limit)");
    assert.equal(v("vmpx_bridge_last_ok_timestamp"), 0, "never OK");
    assert.equal(v("vmpx_bridge_last_critical_timestamp"), 0, "never CRITICAL");
    // the per-RPC limit (60 s) is far away: only the task budgets can have ended these ticks and closed their requests
    assert.ok(v('vmpx_bridge_task_timeouts_total{task="mint"}') >= 2, "mint task ended by its budget");
    assert.ok(v('vmpx_bridge_task_timeouts_total{task="evidence"}') >= 2, "evidence task ended by its budget");
    assert.equal(v("vmpx_bridge_mint_check_ok"), 0);
    assert.ok(maxInflight <= 2, `no overlapping ticks: aborted requests are closed (max concurrent requests ${maxInflight})`);
    assert.equal(v("vmpx_bridge_evidence_ok"), 0);
    assert.ok(v("vmpx_bridge_evidence_unknown_seconds") >= 0);
    assert.equal(existsSync(stateFile), false, "an aborted tick does not write the evidence state");
  } finally { child.kill(); hang.closeAllConnections?.(); hang.close(); }
});
