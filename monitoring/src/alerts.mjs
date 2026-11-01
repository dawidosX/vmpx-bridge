// Operator alerts to Telegram: monitor metrics, auto-pause journal, low balances (logic in alerts-core.mjs).
//   node alerts.mjs          run the loop (systemd service)
//   node alerts.mjs --test   send one test message and exit
// env:
//   TELEGRAM_ENV_FILE  file with TELEGRAM_BOT_TOKEN= and TELEGRAM_CHAT_ID= (default: $CREDENTIALS_DIRECTORY/telegram,
//                      i.e. systemd LoadCredential=telegram:/path); the token never goes to argv, env or logs
//   METRICS_URL (http://127.0.0.1:9465/metrics), POLL_SEC (30), LABEL (prefix of every message), ONCE=1 (one poll, exit)
//   AUTOPAUSE_UNIT (vmpx-autopause.service), MONITOR_UNIT (vmpx-monitor.service), JOURNALCTL (journalctl)
//   BALANCE_WATCH  "label|eth|0xaddr|min,label|x1|base58|min" (min in ETH / XNT), ETH_RPC, X1_RPC, BALANCE_EVERY_SEC (600)
//   DAILY_HOUR_UTC (7; empty = off): one "channel alive" message a day
//   STATE_FILE (default $STATE_DIRECTORY/state.json; state.json.bak = the previous version, state.json.corrupt = an
//              unreadable one set aside), TELEGRAM_API (https://api.telegram.org; http only for 127.0.0.1)
//   STALE_SEC, UNKNOWN_SEC, DIVERGED_FOR_SEC, UNREACHABLE_FOR_SEC, REPEAT_SEC, EVENT_REPEAT_SEC, MAX_PER_WINDOW,
//   URGENT_MAX_PER_WINDOW, WINDOW_SEC, QUEUE_MAX, RECOVER_SINCE_SEC (alerts-core DEFAULTS)
// Round H (Codex r10): one state write per poll holds the journal cursor AND the queue built from that batch (written
// to a temporary file, flushed, renamed; the previous file becomes state.json.bak). Messages leave the queue only after
// Telegram accepted them. An unreadable state file: the backup is used; without one the auto-pause journal is read
// back RECOVER_SINCE_SEC (duplicates filtered by event ID) and an urgent "state lost" message is queued.
// v1 state files (first release) are migrated on load.
// Round I (R11-03): a missing state.json AND state.json.bak is NOT taken as a first start. The service writes the marker
// <state dir>/installed after its first successful state write (also right after migrating a v1 file). Missing both
// files is a first start (journal read from now, no alarm) only when the marker is absent AND FIRST_INSTALL=1; anything
// else is "state lost": the journal is read back RECOVER_SINCE_SEC and an urgent alarm is queued. Set FIRST_INSTALL=1
// only for the very first start (e.g. the install script's test run), not permanently in the EnvironmentFile.
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { DEFAULTS, PRIO, parseMetrics, checkMetrics, conditions, pauseEvent, eventId, needsReason, reasonKey, reasonWindow, pickReason,
  step, newState, loadState, enqueue, nextToSend, markSent, deliveryText, checkTelegramApi, checkToken, checkChat, errorCode, redact, fmtDur } from "./alerts-core.mjs";

const env = process.env;
const cfg = { ...DEFAULTS };
for (const [k, e] of [["staleSec", "STALE_SEC"], ["unknownSec", "UNKNOWN_SEC"], ["divergedForSec", "DIVERGED_FOR_SEC"], ["unreachableForSec", "UNREACHABLE_FOR_SEC"],
  ["repeatSec", "REPEAT_SEC"], ["eventRepeatSec", "EVENT_REPEAT_SEC"], ["maxPerWindow", "MAX_PER_WINDOW"], ["urgentMaxPerWindow", "URGENT_MAX_PER_WINDOW"],
  ["windowSec", "WINDOW_SEC"], ["queueMax", "QUEUE_MAX"], ["recoverSinceSec", "RECOVER_SINCE_SEC"]]) if (env[e]) cfg[k] = Number(env[e]);
const LABEL = env.LABEL ?? "most testnet";
const POLL = Number(env.POLL_SEC || 30) * 1000;
const STATE_FILE = env.STATE_FILE || (env.STATE_DIRECTORY ? `${env.STATE_DIRECTORY.split(":")[0]}/state.json` : "");
const JCTL = env.JOURNALCTL || "journalctl";
const secrets = [];
const log = (...a) => console.log(redact([new Date().toISOString(), ...a].join(" "), secrets));
const nowSec = () => Math.floor(Date.now() / 1000);
const fail = (msg) => { log(`refusing to start: ${msg}`); process.exit(2); };

// R10-07: the endpoint and the token are checked before anything is sent; their values are never printed
const api = checkTelegramApi(env.TELEGRAM_API || "https://api.telegram.org");
if (!api.ok) fail(`TELEGRAM_API ${api.why}`);
function telegramConfig() {
  const f = env.TELEGRAM_ENV_FILE || (env.CREDENTIALS_DIRECTORY ? `${env.CREDENTIALS_DIRECTORY}/telegram` : "");
  if (!f) fail("no TELEGRAM_ENV_FILE / credential 'telegram'");
  let text;
  try { text = readFileSync(f, "utf8"); } catch (e) { fail(`cannot read the Telegram credential (${errorCode(e)})`); }
  const kv = Object.fromEntries(text.split("\n").map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
  if (kv.TELEGRAM_BOT_TOKEN) secrets.push(kv.TELEGRAM_BOT_TOKEN, kv.TELEGRAM_BOT_TOKEN.split(":").slice(1).join(":"));
  if (!kv.TELEGRAM_BOT_TOKEN || !kv.TELEGRAM_CHAT_ID) fail("incomplete Telegram credential (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)");
  if (!checkToken(kv.TELEGRAM_BOT_TOKEN)) fail("TELEGRAM_BOT_TOKEN has an invalid format");
  if (!checkChat(kv.TELEGRAM_CHAT_ID)) fail("TELEGRAM_CHAT_ID has an invalid format");
  return { token: kv.TELEGRAM_BOT_TOKEN, chat: kv.TELEGRAM_CHAT_ID };
}
const TG = telegramConfig();
let SEND_URL;
try { SEND_URL = new URL(`${api.base}/bot${TG.token}/sendMessage`); } catch { fail("cannot build the Telegram URL"); }

class SendError extends Error {}
// every error leaving send() is a controlled code: never the URL (it holds the token) or a raw exception message
async function send(text) {
  let r;
  try {
    r = await fetch(SEND_URL, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ chat_id: TG.chat, text: text.slice(0, 4000), disable_web_page_preview: true }),
    });
  } catch (e) { throw new SendError(`telegram transport error ${errorCode(e)}`); }
  let j;
  try { j = await r.json(); } catch { throw new SendError(`telegram http ${r.status} non-JSON response`); }
  if (!j || j.ok !== true) throw new SendError(`telegram http ${r.status}${Number.isInteger(j?.error_code) ? ` error ${j.error_code}` : ""}`);
}

if (process.argv.includes("--test")) {
  try { await send(`[${LABEL}] Test usługi alarmów: kanał działa (${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC).`); }
  catch (e) { log(`test message failed: ${e instanceof SendError ? e.message : `telegram error ${errorCode(e)}`}`); process.exit(1); }
  log("test message sent"); process.exit(0);
}

// --- state file -------------------------------------------------------------------------------------------------
const BAK = `${STATE_FILE}.bak`;
const MARKER = STATE_FILE ? `${dirname(STATE_FILE)}/installed` : "";
let markerOk = false;
function saveState(s) {
  if (!STATE_FILE) return;
  const tmp = `${STATE_FILE}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try { writeFileSync(fd, JSON.stringify(s)); fsyncSync(fd); } finally { closeSync(fd); }
  if (existsSync(STATE_FILE)) renameSync(STATE_FILE, BAK);
  renameSync(tmp, STATE_FILE);
  try { const d = openSync(dirname(STATE_FILE), "r"); try { fsyncSync(d); } finally { closeSync(d); } } catch { /* not supported everywhere */ }
  if (!markerOk) {
    if (!existsSync(MARKER)) { writeFileSync(MARKER, `${new Date().toISOString()}\n`, { mode: 0o600 }); log("installed marker written"); }
    markerOk = true;
  }
}
function startState(now) {
  const lost = (why) => ({ id: `state-lost:${now}`, prio: PRIO.URGENT,
    text: `⚠️ Stan usługi alarmów utracony (${why}). Czytam log auto-pauzy z ostatnich ${fmtDur(cfg.recoverSinceSec)}, duplikaty odfiltrowane po ID zdarzeń; starsze zdarzenia mogły przepaść, część wysłanych może przyjść ponownie. Sprawdź most i log auto-pauzy.` });
  if (!STATE_FILE) return { st: newState(now), notices: [] };
  const hasMain = existsSync(STATE_FILE), hasBak = existsSync(BAK);
  let why = "brak state.json";
  if (!hasMain && !hasBak) {
    const marker = existsSync(MARKER);
    if (!marker && env.FIRST_INSTALL === "1") { log("no state file, FIRST_INSTALL=1 and no installed marker: first start, the auto-pause journal is read from now"); return { st: newState(now), notices: [] }; }
    why = marker ? "brak state.json i kopii przy istniejącym znaczniku instalacji" : "brak state.json, kopii i znacznika instalacji, FIRST_INSTALL nie ustawione";
  }
  if (hasMain) {
    try { return { st: loadState(JSON.parse(readFileSync(STATE_FILE, "utf8")), now), notices: [] }; }
    catch (e) {
      why = "state.json nieczytelny";
      log(`state file unreadable (${e instanceof SyntaxError ? "not JSON" : errorCode(e) === "unknown" ? "bad shape" : errorCode(e)}): set aside as state.json.corrupt`);
      try { renameSync(STATE_FILE, `${STATE_FILE}.corrupt`); } catch { /* the next save replaces it */ }
    }
  }
  if (hasBak) {
    try {
      const st = loadState(JSON.parse(readFileSync(BAK, "utf8")), now);
      log("state restored from state.json.bak");
      return { st, notices: [{ id: `state-bak:${now}`, prio: PRIO.URGENT,
        text: `⚠️ Stan usługi alarmów odtworzony z kopii (${why}). Log auto-pauzy czytam od kursora z kopii, duplikaty odfiltrowane; ostatnie wiadomości mogą przyjść ponownie.` }] };
    } catch { log("state.json.bak unreadable too"); why += ", kopia też"; }
  }
  const st = newState(now);
  st.startedAt = now - cfg.recoverSinceSec;
  log(`state lost: reading the auto-pause journal back ${cfg.recoverSinceSec}s`);
  return { st, notices: [lost(why)] };
}

// --- journal ------------------------------------------------------------------------------------------------------
const run = (args) => new Promise((res, rej) => execFile(JCTL, args, { timeout: 15000, maxBuffer: 8 << 20 },
  (e, out) => (e ? rej(new Error(`journalctl ${e.killed ? "timeout" : `exit ${e.code ?? errorCode(e)}`}`)) : res(out))));
const msgText = (m) => (Array.isArray(m) ? Buffer.from(m).toString("utf8") : String(m ?? ""));
const ref = (cursor) => createHash("sha256").update(cursor).digest("hex").slice(0, 20);

// the auto-pause journal after the cursor (no cursor: since startedAt). The WHOLE batch is parsed before anything is
// used: one bad line rejects it, and the cursor stays where it was.
async function journalBatch(st) {
  const args = ["-u", env.AUTOPAUSE_UNIT || "vmpx-autopause.service", "-o", "json", "--no-pager"];
  if (st.cursor) args.push("--after-cursor", st.cursor); else args.push("--since", `@${st.startedAt}`);
  const entries = [];
  let cursor = st.cursor;
  for (const l of (await run(args)).split("\n")) {
    if (!l.trim()) continue;
    let j;
    try { j = JSON.parse(l); } catch { throw new Error("journal output not JSON (batch not applied)"); }
    if (typeof j.__CURSOR !== "string" || !j.__CURSOR) throw new Error("journal entry without cursor (batch not applied)");
    cursor = j.__CURSOR;
    entries.push({ msg: msgText(j.MESSAGE), ref: ref(j.__CURSOR), ts: Math.floor(Number(j.__REALTIME_TIMESTAMP) / 1e6) || undefined });
  }
  return { entries, cursor };
}
// the monitor's CRITICAL reason per incident (by time window, not "the last one"); null = journal not readable
async function reasonsFor(events, st) {
  const out = {};
  for (const e of events) {
    const rk = reasonKey(e), w = reasonWindow(e);   // no incident tick (old format): no reason, by design
    if (!needsReason(e) || !rk || !w || rk in out || st.seen[eventId(e, cfg)] || (e.incident && st.incidents[e.incident]?.reason)) continue;
    try {
      const text = await run(["-u", env.MONITOR_UNIT || "vmpx-monitor.service", "--since", `@${Math.floor(w.from)}`, "--until", `@${Math.ceil(w.to)}`, "-o", "cat", "--no-pager"]);
      out[rk] = pickReason(text, w.tick);
    } catch (e2) { log(`monitor journal: ${e2.message}`); out[rk] = null; }
  }
  return out;
}

// --- balances -----------------------------------------------------------------------------------------------------
const watch = (env.BALANCE_WATCH || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
  const [label, chain, address, min] = x.split("|");
  return { label, chain, address, min: Number(min), unit: chain === "x1" ? "XNT" : "ETH" };
});
async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error("rpc error"); return j.result;
}
async function balanceOf(w) {
  if (w.chain === "x1") return (await rpc(env.X1_RPC, "getBalance", [w.address, { commitment: "confirmed" }])).value / 1e9;
  return Number(BigInt(await rpc(env.ETH_RPC, "eth_getBalance", [w.address, "latest"]))) / 1e18;
}

// --- poll ---------------------------------------------------------------------------------------------------------
let st, pendingNotices, stateError, journalFails = 0;

async function poll() {
  const now = nowSec();
  let metrics = null, metricsError;
  try {
    const r = await fetch(env.METRICS_URL || "http://127.0.0.1:9465/metrics", { signal: AbortSignal.timeout(10000) });
    if (!r.ok) metricsError = `HTTP ${r.status}`; else metrics = parseMetrics(await r.text());
  } catch (e) { metricsError = errorCode(e); }

  st.balances ||= {};
  const balErr = {};
  for (const w of watch) {
    const b = st.balances[w.label];
    if (b && now - b.at < Number(env.BALANCE_EVERY_SEC || 600)) continue;
    try { st.balances[w.label] = { value: await balanceOf(w), at: now }; }
    catch (e) { balErr[w.label] = errorCode(e); log(`balance ${w.label}: ${balErr[w.label]}`); if (b && now - b.at > 3600) delete st.balances[w.label]; } // keep the last value up to 1 h
  }
  const balances = watch.map((w) => ({ ...w, value: st.balances[w.label]?.value, error: balErr[w.label] }));

  let batch = null, journalError;
  const notices = pendingNotices; pendingNotices = [];
  let resetCursor = false;
  try { batch = await journalBatch(st); journalFails = 0; }
  catch (e) {
    journalError = e.message; journalFails++;
    log(`journal: ${journalError}`);
    // a cursor journalctl no longer accepts (rotated, corrupt): read back the recovery window, dedup by event ID
    if (journalFails >= 3 && st.cursor) {
      resetCursor = true; journalFails = 0;
      notices.push({ id: `cursor-reset:${now}`, prio: PRIO.ALARM, text: `⚠️ Kursor logu auto-pauzy odrzucony (${journalError}): czytam ponownie ostatnie ${fmtDur(cfg.recoverSinceSec)}, duplikaty odfiltrowane po ID zdarzeń.` });
    }
  }
  const events = batch ? batch.entries.map((x) => pauseEvent(x.msg, { ref: x.ref, ts: x.ts })).filter(Boolean) : [];
  const reasons = await reasonsFor(events, st);

  const conds = conditions({ metrics, metricsError, balances, journalError, stateError, now, cfg });
  const next = step(st, { conds, events, reasons, notices, cursor: batch ? batch.cursor : undefined, now, cfg, label: LABEL }).state;
  if (resetCursor) { next.cursor = null; next.startedAt = now - cfg.recoverSinceSec; }

  const h = env.DAILY_HOUR_UTC ?? "7", day = new Date(now * 1000).toISOString().slice(0, 10);
  if (h !== "" && new Date(now * 1000).getUTCHours() === Number(h) && next.daily !== day) {
    next.daily = day;
    const ok = metrics && !checkMetrics(metrics).length;
    const active = Object.values(next.active).filter((a) => a.alarmed).map((a) => a.name);
    enqueue(next, { id: `daily:${day}`, prio: PRIO.INFO, at: now, text: `[${LABEL}] Kanał alarmów działa. Monitor: ${ok ? `severity ${metrics.vmpx_bridge_severity}, wynik sprzed ${now - metrics.vmpx_bridge_last_result_timestamp} s` : "brak pełnych metryk"}. Aktywne alarmy: ${active.length ? active.join(", ") : "brak"}. W kolejce: ${next.queue.length}.` }, cfg, `[${LABEL}] `);
  }

  // R10-04: cursor and queue in ONE write. If it fails the file keeps the previous cursor (the batch is read again
  // after a restart); this process goes on from memory and raises the "state write" alarm.
  try { saveState(next); stateError = undefined; }
  catch (e) { stateError = errorCode(e); log(`state write failed (${stateError}): continuing from memory, the file keeps the previous cursor`); }
  st = next;

  let sent = 0;
  for (let m; (m = nextToSend(st, nowSec(), cfg));) {
    try { await send(deliveryText(m, nowSec(), cfg)); }
    catch (e) { log(`send failed (${st.queue.length} queued): ${e instanceof SendError ? e.message : `telegram error ${errorCode(e)}`}`); break; }
    markSent(st, m.id, nowSec()); sent++;
    log("sent:", m.text.split("\n")[0].slice(0, 160));
  }
  if (sent) {
    try { saveState(st); stateError = undefined; }
    catch (e) { stateError = errorCode(e); log(`state write failed (${stateError}) after sending: those messages may repeat after a restart`); }
  }
  if (st.queue.length) log(`queued: ${st.queue.length} (urgent ${st.queue.filter((q) => q.prio === PRIO.URGENT).length})`);
}

({ st, notices: pendingNotices } = startState(nowSec()));
log(`vmpx-alerts start: label "${LABEL}", poll ${POLL / 1000}s, balances ${watch.map((w) => w.label).join(", ") || "-"}, queued ${st.queue.length}`);
let stop = false;
process.on("SIGTERM", () => { stop = true; });
while (!stop) {
  try { await poll(); } catch (e) { log(`poll error: ${errorCode(e)} ${String(e?.message).slice(0, 200)}`); } // log() redacts the token
  if (env.ONCE) process.exit(0);
  await new Promise((r) => setTimeout(r, POLL));
}
