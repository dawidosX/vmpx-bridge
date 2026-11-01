// alerts.mjs end to end with ONCE=1 against local fakes: an HTTP server for metrics and the Telegram API, a fake
// journalctl (a script reading a JSON file). Nothing leaves 127.0.0.1.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { newState } from "../src/alerts-core.mjs";

const ALERTS = join(dirname(fileURLToPath(import.meta.url)), "../src/alerts.mjs");
const TOKEN = "987654321:ZZsecretTOKENpartXXyyWWvvUUttSSrrQQpp";
const SECRET = TOKEN.split(":")[1];
const now = () => Math.floor(Date.now() / 1000);
const iso = (t, ms = "") => new Date(t * 1000).toISOString().replace(/\.\d+Z$/, `${ms}Z`);

// fake journalctl: -u, -o json|cat, --after-cursor, --since @t, --until @t; FAKE_JOURNAL_FAIL=1 fails
const FAKE_JCTL = `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2), arg = (k) => { const i = a.indexOf(k); return i < 0 ? undefined : a[i + 1]; };
if (process.env.FAKE_JOURNAL_FAIL) { process.stderr.write("fake failure\\n"); process.exit(1); }
const j = JSON.parse(fs.readFileSync(process.env.FAKE_JOURNAL, "utf8"));
let es = j[arg("-u")] || [];
const ac = arg("--after-cursor");
if (ac !== undefined) { const i = es.findIndex((e) => e.c === ac); if (i < 0) { process.stderr.write("Failed to seek to cursor\\n"); process.exit(1); } es = es.slice(i + 1); }
const at = (s) => Number(String(s).slice(1));
if (arg("--since")) es = es.filter((e) => e.t >= at(arg("--since")));
if (arg("--until")) es = es.filter((e) => e.t <= at(arg("--until")));
for (const e of es) {
  if (e.raw) { console.log(e.raw); continue; }
  console.log(arg("-o") === "json" ? JSON.stringify({ __CURSOR: e.c, __REALTIME_TIMESTAMP: String(Math.round(e.t * 1e6)), MESSAGE: e.m }) : e.m);
}
`;

let server, port, deadPort, dir;
const srv = { metrics: { status: 200, body: "" }, tg: "up", sent: [] };
const okMetrics = (o = {}) => Object.entries({ vmpx_bridge_severity: 0, vmpx_bridge_last_result_timestamp: now() - 5, vmpx_bridge_unknown_seconds: 0,
  vmpx_bridge_evidence_unknown_seconds: 0, vmpx_bridge_evidence_sources_diverged: 0, vmpx_bridge_evidence_critical: 0,
  vmpx_bridge_balance_alarm: 0, vmpx_bridge_balance_stale: 0, vmpx_bridge_balance_observed_age_seconds: 20, ...o }).map(([k, v]) => `${k} ${v}`).join("\n") + "\n";

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "vmpx-alerts-"));
  writeFileSync(join(dir, "journalctl"), FAKE_JCTL, { mode: 0o755 });
  writeFileSync(join(dir, "telegram"), `TELEGRAM_BOT_TOKEN=${TOKEN}\nTELEGRAM_CHAT_ID=-100123\n`, { mode: 0o600 });
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      if (req.url === "/metrics") { res.writeHead(srv.metrics.status, { "content-type": "text/plain" }).end(srv.metrics.body); return; }
      if (req.url !== `/bot${TOKEN}/sendMessage`) { res.writeHead(404).end(); return; }
      if (srv.tg === "html") { res.writeHead(200, { "content-type": "text/html" }).end("<html>oops</html>"); return; }
      if (srv.tg === "401") { res.writeHead(401, { "content-type": "application/json" }).end('{"ok":false,"error_code":401,"description":"Unauthorized"}'); return; }
      srv.sent.push(JSON.parse(body).text);
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true,"result":{}}');
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  const tmp = http.createServer();   // a port with nothing listening = connection refused
  await new Promise((r) => tmp.listen(0, "127.0.0.1", r));
  deadPort = tmp.address().port;
  await new Promise((r) => tmp.close(r));
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

function setup(name) {
  const d = join(dir, name);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d);
  const c = { d, state: join(d, "state.json"), journal: join(d, "journal.json") };
  c.write = (j) => writeFileSync(c.journal, JSON.stringify(j));
  // a running service's state that has not read the journal yet (a fresh install reads it from "now")
  c.seed = (since) => writeFileSync(c.state, JSON.stringify({ ...newState(since), startedAt: since }));
  return c;
}

function runAlerts(c, { args = [], api, extra = {} } = {}) {
  const env = { PATH: process.env.PATH, ONCE: "1", LABEL: "T", DAILY_HOUR_UTC: "", STATE_FILE: c.state, TELEGRAM_ENV_FILE: join(dir, "telegram"),
    TELEGRAM_API: api ?? `http://127.0.0.1:${port}`, METRICS_URL: `http://127.0.0.1:${port}/metrics`, JOURNALCTL: join(dir, "journalctl"),
    FAKE_JOURNAL: c.journal, ...extra };
  return new Promise((res) => execFile(process.execPath, [ALERTS, ...args], { env, timeout: 30000 }, (e, stdout, stderr) =>
    res({ code: e ? e.code : 0, out: stdout + stderr })));
}
const noToken = (out) => { assert.ok(!out.includes(TOKEN), "token in output"); assert.ok(!out.includes(SECRET), "token secret in output"); };
const readState = (c) => JSON.parse(readFileSync(c.state, "utf8"));
const take = () => srv.sent.splice(0);

// journal builder: auto-pause lines with cursors, monitor lines
function journal(pause, monitor = []) {
  return { "vmpx-autopause.service": pause.map((p, i) => ({ c: p.c || `ap-${i}`, t: p.t, m: p.raw ? undefined : `${iso(p.t)} ${p.m}`, raw: p.raw })),
    "vmpx-monitor.service": monitor.map((m, i) => ({ c: `mon-${i}`, t: m.t, m: `${iso(m.t, ".250")} ${m.m.replace("CRITICAL ", `CRITICAL tick=${m.t} `)}` })) };
}

test("Telegram down for many polls, more than QUEUE_MAX messages incl. a pause event: the pause survives, overflow alarm, all in order once up", async () => {
  const c = setup("down");
  const t0 = now() - 300, crit = t0;
  c.seed(t0 - 60);
  const pause = [{ t: t0 + 2, m: `pauseAll broadcast incident=crit-${crit} tx=0xaa nonce=7` }];
  for (let i = 0; i < 8; i++) pause.push({ t: t0 + 10 + i, m: `CRITICAL (confirmed 2s ago) -> WOULD pauseAll (DRY_RUN, nothing sent) incident=crit-${crit + 10 + i}` });
  c.write(journal(pause, [{ t: crit, m: "CRITICAL unbacked mint id 0x12 evidence failed tasks {}" }]));
  srv.metrics = { status: 200, body: okMetrics({ vmpx_bridge_severity: 2, vmpx_bridge_evidence_critical: 3 }) };
  const extra = { QUEUE_MAX: "4", EVENT_REPEAT_SEC: "0", MAX_PER_WINDOW: "100" };
  for (let i = 0; i < 3; i++) {
    const r = await runAlerts(c, { api: `http://127.0.0.1:${deadPort}`, extra });
    assert.equal(r.code, 0, r.out); noToken(r.out);
    assert.match(r.out, /send failed \(\d+ queued\): telegram transport error ECONNREFUSED/);
  }
  let st = readState(c);
  assert.equal(st.cursor, "ap-8");
  const urgent = st.queue.filter((q) => q.prio === 0);
  assert.equal(urgent.length, 1); assert.match(urgent[0].text, /pauseAll rozesłana, tx 0xaa, nonce 7/);
  assert.match(urgent[0].text, /Powód \(monitor\): unbacked mint id 0x12/);
  const o = st.queue.find((q) => q.overflow);
  assert.ok(o && o.dropped >= 5, JSON.stringify(st.queue.map((q) => q.id)));
  assert.ok(st.queue.length <= 5);
  // Telegram back: the pause first (urgent), then the overflow alarm at the head of the rest
  take();
  const r = await runAlerts(c, { extra });
  assert.equal(r.code, 0, r.out); noToken(r.out);
  const sent = take();
  assert.equal(sent.length, st.queue.length);
  assert.match(sent[0], /^\[T\] 🛑 AUTO-PAUZA: pauseAll rozesłana, tx 0xaa/);
  assert.match(sent[1], /przepełnienie kolejki alarmów \(limit 4\): usunięto \d+ wiadomości/);
  st = readState(c); assert.equal(st.queue.length, 0);
  // R11-04: the CRITICAL condition alarm found no room while the queue was full; it was not marked delivered and comes
  // now that there is room (not an hour later)
  let r2 = await runAlerts(c, { extra });
  assert.equal(r2.code, 0, r2.out); assert.deepEqual(take(), ["[T] 🔴 ALARM: Monitor: CRITICAL (dowód naruszenia zabezpieczenia, wiadomości: 3). Auto-pauza powinna zadziałać, sprawdź most."]);
  // restart with the state intact: nothing again
  r2 = await runAlerts(c, { extra });
  assert.equal(r2.code, 0, r2.out); assert.deepEqual(take(), []);
});

test("restart with the state intact: no duplicates; a new line is the only new message; repeated tx = one message", async () => {
  const c = setup("restart");
  const crit = now() - 100;
  c.seed(crit - 60);
  const p = [{ t: crit + 1, m: `pauseAll broadcast incident=crit-${crit} tx=0xbb nonce=3` }, { t: crit + 20, m: `pauseAll tx 0xbb status 1 block 50 incident=crit-${crit} blockhash=0xh` }];
  c.write(journal(p, [{ t: crit, m: "CRITICAL reason A evidence x" }]));
  srv.metrics = { status: 200, body: okMetrics() };
  take();
  let r = await runAlerts(c);
  assert.equal(r.code, 0, r.out);
  let sent = take();
  assert.equal(sent.length, 2); assert.match(sent[0], /rozesłana, tx 0xbb.*\n.*\nPowód \(monitor\): reason A/s); assert.match(sent[1], /w bloku 50/);
  r = await runAlerts(c); assert.deepEqual(take(), []);
  p.push({ t: crit + 25, m: `pauseAll broadcast incident=crit-${crit} tx=0xbb nonce=3` });   // the same tx again
  p.push({ t: crit + 30, m: `bridge paused in both directions incident=crit-${crit} tx=0xbb` });
  c.write(journal(p, [{ t: crit, m: "CRITICAL reason A evidence x" }]));
  r = await runAlerts(c);
  sent = take();
  assert.equal(sent.length, 1, sent.join("\n---\n")); assert.match(sent[0], /Auto-pauza potwierdzona/);
  assert.equal(readState(c).cursor, "ap-3");
});

test("corrupted state: recovery from the journal window with dedup and a state-lost alarm; corrupt main with a good backup", async () => {
  const c = setup("corrupt");
  const t = now();
  const p = [{ t: t - 7 * 3600, m: `ALERT pauseAll FAILED incident=crit-${t - 7 * 3600} after 3 attempts: pause by hand now` },
    { t: t - 3600, m: `pauseAll broadcast incident=crit-${t - 3601} tx=0xcc nonce=9` },
    { t: t - 3590, m: `pauseAll broadcast incident=crit-${t - 3601} tx=0xcc nonce=9` },
    { t: t - 3580, m: `pause executed in block 77 incident=crit-${t - 3601} tx=0xcc` }];
  c.write(journal(p, [{ t: t - 3601, m: "CRITICAL reason B evidence x" }]));
  srv.metrics = { status: 200, body: okMetrics() };
  writeFileSync(c.state, "{ not json");
  take();
  let r = await runAlerts(c);
  assert.equal(r.code, 0, r.out); noToken(r.out);
  let sent = take();
  assert.equal(sent.length, 3, sent.join("\n---\n"));
  assert.match(sent[0], /Stan usługi alarmów utracony \(state\.json nieczytelny\).*ostatnich 6 h 0 min/);
  assert.match(sent[1], /rozesłana, tx 0xcc/); assert.match(sent[2], /Pauza wykonana w bloku 77/);
  assert.ok(!sent.some((s) => /NIEUDANA/.test(s)), "an event older than the window came back");
  assert.ok(existsSync(`${c.state}.corrupt`));
  // run again: a valid state and its backup now; nothing new
  r = await runAlerts(c); assert.deepEqual(take(), []);
  assert.ok(existsSync(`${c.state}.bak`));
  // main corrupt, backup good: restored from it, events not repeated
  writeFileSync(c.state, "garbage");
  r = await runAlerts(c);
  sent = take();
  assert.equal(sent.length, 1, sent.join("\n---\n")); assert.match(sent[0], /odtworzony z kopii/);
  // old v1 file of the running service: migrated, its outbox delivered, its cursor kept
  writeFileSync(c.state, JSON.stringify({ active: {}, eventLast: {}, sent: [], dropped: 0, outbox: ["[T] 🛑 AUTO-PAUZA wysłana: v1 message"], cursor: "ap-3", startedAt: t - 100 }));
  r = await runAlerts(c);
  sent = take(); assert.deepEqual(sent, ["[T] 🛑 AUTO-PAUZA wysłana: v1 message"]);
  assert.equal(readState(c).v, 2);
});

test("R11-03: missing state.json and .bak is a first start only with FIRST_INSTALL=1 and no installed marker; otherwise state lost + recovery", async () => {
  const c = setup("marker");
  const t = now(), marker = join(c.d, "installed");
  const crit = t - 1800;
  c.write(journal([{ t: crit + 1, m: `pauseAll broadcast incident=crit-${crit} tx=0xee nonce=2` }], [{ t: crit, m: "CRITICAL reason M evidence x" }]));
  srv.metrics = { status: 200, body: okMetrics() };
  take();
  // first install, explicitly: from now, no alarm, the past event is not replayed; the marker appears
  let r = await runAlerts(c, { extra: { FIRST_INSTALL: "1" } });
  assert.equal(r.code, 0, r.out); assert.deepEqual(take(), []);
  assert.ok(existsSync(marker), r.out); assert.equal(readState(c).v, 2);
  // the state directory loses both files later (marker still there, FIRST_INSTALL left set by mistake): state lost
  rmSync(c.state); rmSync(`${c.state}.bak`, { force: true });
  r = await runAlerts(c, { extra: { FIRST_INSTALL: "1" } });
  let sent = take();
  assert.equal(sent.length, 2, sent.join("\n---\n"));
  assert.match(sent[0], /Stan usługi alarmów utracony \(brak state\.json i kopii przy istniejącym znaczniku instalacji\)/);
  assert.match(sent[1], /rozesłana, tx 0xee.*Powód \(monitor\): reason M/s);
  // everything gone incl. the marker, no FIRST_INSTALL: not a silent first start either
  rmSync(c.state); rmSync(`${c.state}.bak`, { force: true }); rmSync(marker);
  r = await runAlerts(c);
  sent = take();
  assert.equal(sent.length, 2); assert.match(sent[0], /znacznika instalacji, FIRST_INSTALL nie ustawione/);
  assert.ok(existsSync(marker));
});

test("R11-03: migrating the running round G service (v1 state.json, no marker) writes the marker", async () => {
  const c = setup("v1marker");
  c.write(journal([]));
  srv.metrics = { status: 200, body: okMetrics() };
  writeFileSync(c.state, JSON.stringify({ active: {}, eventLast: {}, sent: [], dropped: 0, outbox: [], cursor: null, startedAt: now() - 60 }));
  take();
  const r = await runAlerts(c);
  assert.equal(r.code, 0, r.out); assert.deepEqual(take(), []);
  assert.ok(existsSync(join(c.d, "installed"))); assert.equal(readState(c).v, 2);
});

test("cursor not advanced when the batch cannot be parsed or the state cannot be written", async () => {
  const c = setup("cursor");
  const crit = now() - 60;
  c.seed(crit - 60);
  const good = { t: crit + 1, m: `ALERT pauseAll result UNKNOWN incident=crit-${crit} tx=0xdd nonce=4: may still be mined, settle the pauser nonce before any unpause` };
  c.write(journal([good, { t: crit + 2, raw: "{ truncated" }]));
  srv.metrics = { status: 200, body: okMetrics() };
  take();
  let r = await runAlerts(c);
  assert.match(r.out, /journal: journal output not JSON \(batch not applied\)/);
  assert.equal(readState(c).cursor, null); assert.deepEqual(take(), []);
  c.write(journal([good]));
  r = await runAlerts(c);
  let sent = take();
  assert.equal(sent.length, 1); assert.match(sent[0], /Wynik pauseAll NIEZNANY \(tx 0xdd, nonce 4; /); assert.doesNotMatch(sent[0], /NIEUDANA/);
  assert.match(sent[0], new RegExp(`Powód nieustalony \\(brak wpisu monitora dla tick=${crit}\\)`));
  assert.equal(readState(c).cursor, "ap-0");
  if (process.getuid && process.getuid() === 0) return;   // root ignores the directory mode below
  c.write(journal([good, { t: crit + 5, m: `ALERT pause not confirmed incident=crit-${crit + 3}: the pause may still have worked, check by hand now` }]));
  chmodSync(c.d, 0o500);
  try {
    r = await runAlerts(c);
    assert.match(r.out, /state write failed \(EACCES\)/);
    assert.equal(readState(c).cursor, "ap-0");   // the file keeps the previous cursor
    assert.equal(take().length, 1);               // the process still delivered from memory
  } finally { chmodSync(c.d, 0o700); }
  r = await runAlerts(c);
  sent = take();
  assert.equal(sent.length, 1); assert.match(sent[0], /NIEPOTWIERDZONA/);   // read again: at least once
  assert.equal(readState(c).cursor, "ap-1");
});

test("metrics: empty 200 and HTML keep the alarms; no false back to normal", async () => {
  const c = setup("metrics");
  c.seed(now());
  c.write(journal([]));
  srv.metrics = { status: 200, body: okMetrics({ vmpx_bridge_severity: 2, vmpx_bridge_evidence_critical: 1 }) };
  take();
  await runAlerts(c);
  assert.match(take()[0], /ALARM: Monitor: CRITICAL/);
  for (const body of ["", "<html><body>Bad gateway</body></html>", okMetrics().replace(/vmpx_bridge_evidence_unknown_seconds .*\n/, "")]) {
    srv.metrics = { status: 200, body };
    const r = await runAlerts(c, { extra: { UNREACHABLE_FOR_SEC: "0" } });
    const sent = take();
    assert.ok(!sent.some((s) => /Wróciło do normy/.test(s)), sent.join("\n"));
    assert.ok(readState(c).active.critical.alarmed, r.out);
  }
  assert.ok(readState(c).active.metrics.alarmed);
});

test("R10-07: invalid endpoint or token refuses to start; transport errors are codes; the token never appears", async () => {
  const c = setup("token");
  c.write(journal([]));
  srv.metrics = { status: 200, body: okMetrics() };
  for (const api of ["api.telegram.org", "http://example.com", "https://user:pw@api.telegram.org", "not a url at all"]) {
    const r = await runAlerts(c, { api, args: ["--test"] });
    assert.equal(r.code, 2, r.out); assert.match(r.out, /refusing to start: TELEGRAM_API/); noToken(r.out);
  }
  writeFileSync(join(dir, "telegram-bad"), `TELEGRAM_BOT_TOKEN=${TOKEN}/../x\nTELEGRAM_CHAT_ID=-100123\n`);
  let r = await runAlerts(c, { args: ["--test"], extra: { TELEGRAM_ENV_FILE: join(dir, "telegram-bad") } });
  assert.equal(r.code, 2); assert.match(r.out, /TELEGRAM_BOT_TOKEN has an invalid format/); noToken(r.out);
  r = await runAlerts(c, { args: ["--test"], api: `http://127.0.0.1:${deadPort}` });
  assert.equal(r.code, 1); assert.match(r.out, /test message failed: telegram transport error ECONNREFUSED/); noToken(r.out);
  for (const [mode, re] of [["html", /telegram http 200 non-JSON response/], ["401", /telegram http 401 error 401/]]) {
    srv.tg = mode;
    try {
      r = await runAlerts(c, { args: ["--test"] }); assert.equal(r.code, 1); assert.match(r.out, re); noToken(r.out);
      r = await runAlerts(c); assert.equal(r.code, 0); noToken(r.out);
    } finally { srv.tg = "up"; }
  }
  take();
  r = await runAlerts(c, { args: ["--test"] }); assert.equal(r.code, 0); assert.match(take()[0], /Test usługi alarmów/);
  noToken(readFileSync(c.state, "utf8"));
});
