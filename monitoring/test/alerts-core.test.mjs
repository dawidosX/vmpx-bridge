import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, PRIO, parseMetrics, checkMetrics, conditions, pauseEvent, eventId, step, newState, loadState, enqueue, nextToSend, markSent,
  deliveryText, pickReason, reasonWindow, checkTelegramApi, checkToken, errorCode, redact } from "../src/alerts-core.mjs";

const T = 1_800_000_000;
const ok = (o = {}) => ({ vmpx_bridge_severity: 0, vmpx_bridge_last_result_timestamp: T - 10, vmpx_bridge_unknown_seconds: 0,
  vmpx_bridge_evidence_unknown_seconds: 0, vmpx_bridge_evidence_sources_diverged: 0, vmpx_bridge_evidence_critical: 0,
  vmpx_bridge_balance_alarm: 0, vmpx_bridge_balance_stale: 0, vmpx_bridge_balance_observed_age_seconds: 20, vmpx_bridge_balance_shortfall_seconds: 0, ...o });
const keys = (c) => c.filter((x) => !x.hold).map((x) => x.key).sort();
const iso = (t) => new Date(t * 1000).toISOString().replace(/\.\d+Z$/, "Z");
// delivery: everything queued is sent (the runner does this within the budgets)
const drain = (st) => { const s = { ...st, queue: [] }; return s; };

test("parseMetrics: unlabelled and labelled samples, comments skipped", () => {
  const m = parseMetrics('# HELP x\nvmpx_bridge_severity 2\nvmpx_bridge_task_ok{task="mint"} 1\n');
  assert.equal(m.vmpx_bridge_severity, 2);
  assert.equal(m['vmpx_bridge_task_ok{task="mint"}'], 1);
});

test("conditions: healthy -> none", () => {
  assert.deepEqual(conditions({ metrics: ok(), now: T }), []);
});

test("conditions: metrics unreachable or stale result -> stale", () => {
  assert.deepEqual(keys(conditions({ metrics: null, metricsError: "ECONNREFUSED", now: T })), ["stale"]);
  assert.deepEqual(keys(conditions({ metrics: ok({ vmpx_bridge_last_result_timestamp: T - 301 }), now: T })), ["stale"]);
  assert.deepEqual(keys(conditions({ metrics: ok({ vmpx_bridge_last_result_timestamp: T - 299 }), now: T })), []);
  assert.deepEqual(keys(conditions({ metrics: ok({ vmpx_bridge_last_result_timestamp: 0 }), now: T })), ["stale"]);
});

test("conditions: UNKNOWN > 10 min from either metric, diverged, critical", () => {
  assert.deepEqual(keys(conditions({ metrics: ok({ vmpx_bridge_unknown_seconds: 600 }), now: T })), []);
  assert.deepEqual(keys(conditions({ metrics: ok({ vmpx_bridge_unknown_seconds: 601 }), now: T })), ["unknown"]);
  assert.deepEqual(keys(conditions({ metrics: ok({ vmpx_bridge_evidence_unknown_seconds: 900 }), now: T })), ["unknown"]);
  assert.deepEqual(keys(conditions({ metrics: ok({ vmpx_bridge_evidence_sources_diverged: 1 }), now: T })), ["diverged"]);
  assert.deepEqual(keys(conditions({ metrics: ok({ vmpx_bridge_severity: 2 }), now: T })), ["critical"]);
});

test("R10-02: diverged and evidence_critical are counts: 2 and larger alarm, 1 -> 2 is not back to normal", () => {
  for (const n of [1, 2, 3, 17, 1000]) {
    assert.deepEqual(keys(conditions({ metrics: ok({ vmpx_bridge_evidence_sources_diverged: n }), now: T })), ["diverged"], `diverged ${n}`);
    assert.deepEqual(keys(conditions({ metrics: ok({ vmpx_bridge_evidence_critical: n }), now: T })), ["critical"], `critical ${n}`);
  }
  const at = (t, o) => conditions({ metrics: ok({ vmpx_bridge_last_result_timestamp: t - 10, ...o }), now: t });
  let r = step(newState(T), { conds: at(T, { vmpx_bridge_evidence_sources_diverged: 1, vmpx_bridge_evidence_critical: 1 }), now: T });
  r = step(drain(r.state), { conds: at(T + 130, { vmpx_bridge_evidence_sources_diverged: 1, vmpx_bridge_evidence_critical: 1 }), now: T + 130 });
  assert.deepEqual(Object.keys(r.state.active).sort(), ["critical", "diverged"]);
  r = step(drain(r.state), { conds: at(T + 160, { vmpx_bridge_evidence_sources_diverged: 2, vmpx_bridge_evidence_critical: 2 }), now: T + 160 });
  assert.deepEqual(r.messages, []);
  assert.ok(r.state.active.diverged.alarmed && r.state.active.critical.alarmed);
  r = step(drain(r.state), { conds: at(T + 190, { vmpx_bridge_evidence_sources_diverged: 0, vmpx_bridge_evidence_critical: 0 }), now: T + 190 });
  assert.equal(r.messages.length, 2); assert.ok(r.messages.every((m) => /Wróciło do normy/.test(m)));
});

test("failed evidence tick (evidence_* not exported): diverged/critical held, no 'metrics unreadable' alarm, no back to normal", () => {
  const at = (t, o) => conditions({ metrics: ok({ vmpx_bridge_last_result_timestamp: t - 10, ...o }), now: t });
  const noEv = (t) => { const m = ok({ vmpx_bridge_evidence_unknown_seconds: 60, vmpx_bridge_last_result_timestamp: t - 10 }); delete m.vmpx_bridge_evidence_critical; delete m.vmpx_bridge_evidence_sources_diverged; return m; };
  assert.deepEqual(checkMetrics(noEv(T)), []);
  let r = step(newState(T), { conds: at(T, { vmpx_bridge_evidence_sources_diverged: 2 }), now: T });
  r = step(drain(r.state), { conds: at(T + 130, { vmpx_bridge_evidence_sources_diverged: 2 }), now: T + 130 });
  assert.equal(r.messages.length, 1);
  for (const t of [T + 160, T + 400]) {
    r = step(drain(r.state), { conds: conditions({ metrics: noEv(t), now: t }), now: t });
    assert.deepEqual(r.messages, []);
    assert.deepEqual(Object.keys(r.state.active).sort(), ["diverged"]);
  }
  assert.ok(checkMetrics(ok({ vmpx_bridge_evidence_critical: NaN })).length > 0);
});

test("R10-05: empty 200, HTML, a missing field, NaN = unreadable: alarms held, metrics alarm after the debounce, never back to normal", () => {
  const bad = {
    empty: parseMetrics(""),
    html: parseMetrics("<!doctype html>\n<html><body>502 Bad Gateway</body></html>\n"),
    missing: (() => { const m = ok(); delete m.vmpx_bridge_evidence_unknown_seconds; return m; })(),
    nan: ok({ vmpx_bridge_evidence_sources_diverged: NaN }),
    nanText: parseMetrics(Object.entries(ok({ vmpx_bridge_severity: "NaN" })).map(([k, v]) => `${k} ${v}`).join("\n")),
    inf: ok({ vmpx_bridge_unknown_seconds: Infinity }),
  };
  assert.deepEqual(checkMetrics(ok()), []);
  for (const [name, m] of Object.entries(bad)) {
    assert.ok(checkMetrics(m).length > 0, name);
    // an active CRITICAL and UNKNOWN first
    let r = step(newState(T), { conds: conditions({ metrics: ok({ vmpx_bridge_severity: 2, vmpx_bridge_unknown_seconds: 700 }), now: T }), now: T });
    assert.equal(r.messages.length, 2);
    r = step(drain(r.state), { conds: conditions({ metrics: m, now: T + 30 }), now: T + 30 });
    assert.deepEqual(r.messages, [], name);
    assert.deepEqual(Object.keys(r.state.active).sort(), ["critical", "metrics", "unknown"], name);
    r = step(drain(r.state), { conds: conditions({ metrics: m, now: T + 150 }), now: T + 150 });
    assert.equal(r.messages.length, 1, name); assert.match(r.messages[0], /ALARM: Monitor: dokument metryk niekompletny/);
    assert.ok(!r.messages.some((x) => /Wróciło do normy/.test(x)), name);
  }
});

test("conditions: low balances; unknown balance is held, a failing read alarms after the debounce", () => {
  const c = conditions({ metrics: ok(), now: T, balances: [
    { label: "bot X1", unit: "XNT", value: 0.5, min: 1 }, { label: "pauser", unit: "ETH", value: 0.05, min: 0.02 },
    { label: "bot ETH", unit: "ETH", value: undefined, min: 0.02 }] });
  assert.deepEqual(keys(c), ["low:bot X1"]);
  assert.match(c[0].text, /0\.5 XNT/);
  const e = conditions({ metrics: ok(), now: T, balances: [{ label: "bot ETH", unit: "ETH", value: undefined, error: "TimeoutError", min: 0.02 }] });
  assert.deepEqual(keys(e), ["balread:bot ETH"]);
  assert.equal(e.find((x) => x.key === "balread:bot ETH").forSec, DEFAULTS.unreachableForSec);
});

test("step: metrics or a balance unreadable keep the alarms (no false back-to-normal); unreachable alarms after 120 s", () => {
  let r = step(newState(T), { conds: conditions({ metrics: ok({ vmpx_bridge_unknown_seconds: 700 }), now: T,
    balances: [{ label: "bot", unit: "XNT", value: 0.1, min: 1 }] }), now: T });
  assert.equal(r.messages.length, 2);
  r = step(drain(r.state), { conds: conditions({ metrics: null, metricsError: "fetch failed", now: T + 30, balances: [{ label: "bot", unit: "XNT", min: 1 }] }), now: T + 30 });
  assert.equal(r.messages.length, 0);
  assert.deepEqual(Object.keys(r.state.active).sort(), ["low:bot", "stale", "unknown"]);
  r = step(drain(r.state), { conds: conditions({ metrics: null, metricsError: "fetch failed", now: T + 150, balances: [{ label: "bot", unit: "XNT", min: 1 }] }), now: T + 150 });
  assert.equal(r.messages.length, 1); assert.match(r.messages[0], /brak metryk/);
  r = step(drain(r.state), { conds: conditions({ metrics: ok({ vmpx_bridge_last_result_timestamp: T + 170 }), now: T + 180, balances: [{ label: "bot", unit: "XNT", value: 5, min: 1 }] }), now: T + 180 });
  assert.equal(r.messages.length, 3); assert.ok(r.messages.every((m) => /Wróciło do normy/.test(m)));
});

test("pauseEvent: the incident line contract", () => {
  const I = "incident=crit-1800000000";
  const p = (l) => pauseEvent(`2027-01-15T08:00:05Z ${l}`);
  assert.equal(p(`CRITICAL (confirmed 3s ago) -> WOULD pauseAll (DRY_RUN, nothing sent) ${I}`).kind, "would");
  assert.equal(p(`CRITICAL -> pauseAll ${I} nonce=7`), null);   // the attempt itself is not a message
  let e = p(`pauseAll broadcast ${I} tx=0xAB nonce=7 replaces=0xaa`);
  assert.deepEqual([e.kind, e.tx, e.nonce, e.replaces, e.incident, e.crit], ["broadcast", "0xAB", "7", "0xaa", "crit-1800000000", T]);
  e = p(`pauseAll tx 0xab status 1 block 99 ${I} blockhash=0xbh`);
  assert.deepEqual([e.kind, e.tx, e.status, e.block, e.blockhash], ["mined", "0xab", "1", "99", "0xbh"]);
  assert.deepEqual([p(`pause executed in block 99 ${I} tx=0xab`).kind, p(`pause executed in block 99 ${I} tx=0xab`).block], ["executed", "99"]);
  assert.equal(p(`bridge paused in both directions ${I} tx=0xab`).kind, "paused");
  assert.equal(p(`bridge no longer paused at latest ${I} block=120`).kind, "unpaused");
  assert.equal(p(`ALERT pauseAll FAILED ${I} after 3 attempts: pause by hand now`).kind, "failed");
  e = p(`ALERT pauseAll result UNKNOWN ${I} tx=0xab nonce=7 waited 90s: may still be mined, settle the pauser nonce before any unpause`);
  assert.deepEqual([e.kind, e.tx, e.nonce], ["unknown", "0xab", "7"]);
  assert.equal(p(`ALERT pause not confirmed ${I} on both directions within 120s: the pause may still have worked, check by hand now`).kind, "not_confirmed");
  assert.equal(p(`ALERT CRITICAL but no pauser key configured ${I} (PAUSER_KEYSTORE): pause by hand now`).kind, "no_key");
  assert.equal(p("ALERT PAUSE_ISM not set: configuration error, auto-pause not running").kind, "config");
  for (const l of ["severity=0 -> no action", "ALERT metrics unreachable -> no action", "ALERT evidence unknown for 700s -> no action, check now",
    "not confirmed yet (RPC behind or answers disagree), reading again", "ALERT monitor has no finished tick for 400s -> no action"]) assert.equal(p(l), null, l);
  // the incident ID ends at whitespace or a colon
  assert.equal(p(`ALERT pauseAll FAILED incident=crit-1800000000: pause by hand now`).incident, "crit-1800000000");
});

test("pauseEvent: old format without incident (backward compatible)", () => {
  const e = pauseEvent("2026-11-01T10:37:31Z pauseAll tx 0xabc status 1 block 12040453", { ref: "r1" });
  assert.deepEqual([e.kind, e.tx, e.status, e.block, e.incident], ["mined", "0xabc", "1", "12040453", undefined]);
  assert.equal(eventId(e), "mined:0xabc");
  assert.equal(pauseEvent("2026-11-01T10:37:31Z bridge paused in both directions", { ref: "r2" }).kind, "paused");
  assert.equal(eventId(pauseEvent("bridge paused in both directions", { ref: "r2" })), "paused:r2"); // no time at all: the journal entry
  assert.equal(pauseEvent("x CRITICAL (confirmed 3s ago) -> WOULD pauseAll (DRY_RUN, nothing sent)").kind, "would");
  assert.equal(pauseEvent("2026-11-01T10:00:00Z ALERT pauseAll FAILED after 3 attempts: pause by hand now").kind, "failed");
  assert.equal(pauseEvent("2026-11-01T10:00:00Z ALERT pause not confirmed on both directions within 120s (last: ...)").kind, "not_confirmed");
  assert.equal(pauseEvent("x CRITICAL -> pauseAll, attempt 1"), null);
  const r = step(newState(T), { events: [e], now: T, label: "most testnet" });
  assert.match(r.messages[0], /^\[most testnet\] 🛑 AUTO-PAUZA: pauseAll w bloku 12040453, tx 0xabc, status 1/);
  assert.match(r.messages[0], /Powód nieustalony \(linia bez incident=crit-…\)/);   // R11-06: no nearest guess
});

test("incidents: one incident groups reason, tx and confirmation; the same tx twice = one message; kinds are distinct", () => {
  const I = "incident=crit-1800000000", t = iso(T + 5);
  const lines = [`pauseAll broadcast ${I} tx=0xab nonce=7`, `pauseAll broadcast ${I} tx=0xab nonce=7`, `pauseAll tx 0xab status 1 block 99 ${I} blockhash=0xbh`,
    `pauseAll tx 0xAB status 1 block 99 ${I} blockhash=0xbh`, `pause executed in block 99 ${I} tx=0xab`, `bridge paused in both directions ${I} tx=0xab`];
  const ev = lines.map((l, i) => pauseEvent(`${t} ${l}`, { ref: `c${i}` }));
  let r = step(newState(T), { events: ev, reasons: { "crit-1800000000": "unbacked mint id 0x12" }, now: T + 10, label: "L" });
  assert.equal(r.messages.length, 4);
  assert.match(r.messages[0], /pauseAll rozesłana, tx 0xab, nonce 7\. .*\nIncydent: crit-1800000000 \(CRITICAL \d\d:\d\d:\d\d UTC\)\nPowód \(monitor\): unbacked mint id 0x12/s);
  assert.match(r.messages[1], /pauseAll w bloku 99, tx 0xab, status 1, hash bloku 0xbh/);
  assert.match(r.messages[2], /Pauza wykonana w bloku 99/); assert.match(r.messages[3], /potwierdzona: oba kierunki/);
  assert.ok(r.state.queue.every((q) => q.prio === PRIO.URGENT));
  assert.deepEqual(r.state.incidents["crit-1800000000"].txs, ["0xab"]);
  // reported again later (re-read, restart): nothing new; a replacement tx is its own message
  r = step(drain(r.state), { events: [...ev, pauseEvent(`${t} pauseAll broadcast ${I} tx=0xcd nonce=7 replaces=0xab`)], now: T + 60, label: "L" });
  assert.equal(r.messages.length, 1); assert.match(r.messages[0], /tx 0xcd, nonce 7 \(zastępuje tx 0xab z tym samym nonce\)/);
  assert.match(r.messages[0], /Powód \(monitor\): unbacked mint id 0x12/); // from the incident record
  // not confirmed / UNKNOWN / FAILED are different messages; only FAILED says NIEUDANA
  const J = "incident=crit-1800000100";
  r = step(newState(T), { events: [
    pauseEvent(`${t} ALERT pause not confirmed ${J} within 120s: the pause may still have worked, check by hand now`),
    pauseEvent(`${t} ALERT pauseAll result UNKNOWN ${J} tx=0xef nonce=8: may still be mined, settle the pauser nonce before any unpause`),
    pauseEvent(`${t} ALERT pauseAll FAILED ${J} after 3 attempts: pause by hand now`)], reasons: { "crit-1800000100": "" }, now: T });
  assert.equal(r.messages.length, 3);
  assert.match(r.messages[0], /Pauza NIEPOTWIERDZONA \(mogła zadziałać\)/); assert.doesNotMatch(r.messages[0], /NIEUDANA/);
  assert.match(r.messages[1], /Wynik pauseAll NIEZNANY \(tx 0xef, nonce 8; szczegóły: .*rozlicz nonce pausera/s); assert.doesNotMatch(r.messages[1], /NIEUDANA/);
  assert.match(r.messages[2], /AUTO-PAUZA NIEUDANA/);
  assert.ok(r.messages.every((m) => /Powód nieustalony \(brak wpisu monitora dla tick=1800000100\)/.test(m)));
});

test("events without incident and tx: the same text once per eventRepeatSec bucket (a stuck pending record is not a page a minute)", () => {
  const l = (t) => pauseEvent(`${iso(t)} ALERT pauseAll result UNKNOWN incident=? tx=? nonce=? pending record unreadable (/var/lib/x/pending): may still be mined, settle the pauser nonce before any unpause`, { ref: `c${t}` });
  assert.equal(l(T).incident, undefined); assert.equal(l(T).tx, undefined);
  let r = step(newState(T), { events: [l(T + 10), l(T + 70), l(T + 130)], now: T + 130 });
  assert.equal(r.messages.length, 1); assert.match(r.messages[0], /Wynik pauseAll NIEZNANY/);
  r = step(drain(r.state), { events: [l(T + DEFAULTS.eventRepeatSec + 10)], now: T + DEFAULTS.eventRepeatSec + 10 });
  assert.equal(r.messages.length, 1);
  // a different text in the same bucket is its own message
  r = step(drain(r.state), { events: [pauseEvent(`${iso(T + 20)} ALERT pauseAll FAILED after 3 attempts: pause by hand now`)], now: T + DEFAULTS.eventRepeatSec + 20 });
  assert.equal(r.messages.length, 1);
});

test("R11-06: the reason is the monitor line with exactly tick=<crit>; a neighbouring CRITICAL or an old line without tick is never used", () => {
  const w = reasonWindow(pauseEvent(`${iso(T + 30)} pauseAll broadcast incident=crit-${T} tx=0x1 nonce=1`));
  assert.deepEqual(w, { from: T - 60, to: T + 300, tick: T });
  assert.equal(reasonWindow(pauseEvent(`${iso(T)} pauseAll tx 0x1 status 1 block 2`)), null);   // old format: not looked up
  const line = (t, rest) => `${new Date(t * 1000).toISOString()} ${rest}`;
  const mon = [line(T - 30, `CRITICAL tick=${T - 30} previous incident evidence ok`), line(T, `CRITICAL tick=${T} unbacked mint id 0x12 evidence failed tasks {}`),
    line(T + 30, `CRITICAL tick=${T + 30} next incident evidence x`), line(T + 1, `OK tick=${T + 1} - evidence ok`)];
  assert.equal(pickReason(mon.join("\n"), T), "unbacked mint id 0x12");
  // the line for T is missing: the CRITICAL of T+30 (Codex scenario) and of T-30 are NOT taken
  assert.equal(pickReason(mon.filter((l) => !/unbacked/.test(l)).join("\n"), T), "");
  // old monitor lines without tick=: no reason, not the nearest one
  assert.equal(pickReason(line(T, "CRITICAL unbacked mint id 0x12 evidence failed"), T), "");
  // tick= must be the field right after the severity, a reasons text containing "tick=" does not count
  assert.equal(pickReason(line(T, `CRITICAL tick=${T + 30} reason mentions tick=${T} evidence x`), T), "");
  const e = pauseEvent(`${iso(T + 2)} pauseAll broadcast incident=crit-${T} tx=0x1 nonce=1`);
  assert.match(step(newState(T), { events: [e], reasons: { [`crit-${T}`]: "" }, now: T + 5 }).messages[0], new RegExp(`Powód nieustalony \\(brak wpisu monitora dla tick=${T}\\)`));
  assert.match(step(newState(T), { events: [e], reasons: { [`crit-${T}`]: null }, now: T + 5 }).messages[0], /Powód nieustalony \(nie udało się odczytać logu monitora\)/);
});

test("UNKNOWN dedup policy: one message per (incident, tx, class); the same class repeated is one message, a new class is a new one", () => {
  const I = `incident=crit-${T}`, u = (tx, why) => pauseEvent(`${iso(T + 9)} ALERT pauseAll result UNKNOWN ${I} tx=${tx} nonce=4 ${why}: may still be mined, settle the pauser nonce before any unpause`);
  const timeout = "hashes=0x1 no settled receipt within 90s", timeout2 = "hashes=0x1,0x2 no settled receipt within 180s";
  const foreign = "latest_nonce=5 hashes=0x1 nonce used by an unknown transaction (or our receipt not visible yet)";
  const binding = "pending record bound to another signer/chain/pauser (signer 0xabc)";
  assert.deepEqual([timeout, foreign, binding, "pending record unreadable (/x)", "pending record not reconciled (DRY_RUN)", "something new"].map((w) => u("0x1", w).cls),
    ["timeout", "foreign", "binding", "record", "dryrun", "other"]);
  let r = step(newState(T), { events: [u("0x1", timeout), u("0x1", timeout2)], reasons: { [`crit-${T}`]: "R" }, now: T + 10 });
  assert.equal(r.messages.length, 1);                          // the same class with other numbers: one message
  r = step(drain(r.state), { events: [u("0x1", timeout), u("0x1", foreign), u("0x1", foreign)], now: T + 70 });
  assert.equal(r.messages.length, 1); assert.match(r.messages[0], /NIEZNANY \(tx 0x1, nonce 4; nonce zużyty przez nieznaną transakcję\)/);
  r = step(drain(r.state), { events: [u("0x2", timeout)], now: T + 130 });   // another tx (replacement): its own message
  assert.equal(r.messages.length, 1);
});

test("step: alarm once (queued = alarmed), repeat after repeatSec once delivered, back to normal once", () => {
  const c = [{ key: "unknown", name: "UNKNOWN > 10 min", forSec: 0, text: "U" }];
  let r = step(newState(T), { conds: c, now: T });
  assert.equal(r.messages.length, 1); assert.match(r.messages[0], /ALARM: U/);
  assert.ok(r.state.active.unknown.alarmed); assert.equal(r.state.queue.length, 1);
  r = { state: drain(r.state) };
  for (let t = T + 30; t < T + DEFAULTS.repeatSec; t += 30) { r = step(r.state, { conds: c, now: t }); assert.equal(r.messages.length, 0); }
  r = step(r.state, { conds: c, now: T + DEFAULTS.repeatSec }); assert.equal(r.messages.length, 1); assert.match(r.messages[0], /NADAL: U \(trwa 1 h 0 min\)/);
  r = step(drain(r.state), { conds: [], now: T + DEFAULTS.repeatSec + 30 }); assert.deepEqual(r.messages.length, 1); assert.match(r.messages[0], /Wróciło do normy: UNKNOWN > 10 min/);
  r = step(drain(r.state), { conds: [], now: T + DEFAULTS.repeatSec + 60 }); assert.equal(r.messages.length, 0);
});

test("step: forSec debounce; a flap shorter than forSec sends nothing at all", () => {
  const c = [{ key: "diverged", forSec: 120, text: "D" }];
  let r = step(newState(T), { conds: c, now: T }); assert.equal(r.messages.length, 0);
  r = step(r.state, { conds: c, now: T + 60 }); assert.equal(r.messages.length, 0);
  r = step(r.state, { conds: [], now: T + 90 }); assert.equal(r.messages.length, 0); // cleared before alarming: no "back to normal"
  r = step(r.state, { conds: c, now: T + 100 }); r = step(r.state, { conds: c, now: T + 220 }); assert.equal(r.messages.length, 1);
});

test("step: an alarm still waiting in the queue is not repeated, and when it clears it becomes one message", () => {
  const c = [{ key: "stale", name: "S", forSec: 0, text: "S" }];
  let r = step(newState(T), { conds: c, now: T });
  r = step(r.state, { conds: c, now: T + DEFAULTS.repeatSec }); assert.equal(r.messages.length, 0); // still queued: no reminder
  r = step(r.state, { conds: [], now: T + DEFAULTS.repeatSec + 30 }); assert.equal(r.messages.length, 0);
  assert.equal(r.state.queue.length, 1); assert.match(r.state.queue[0].text, /ALARM: S\n\(już ustąpił, trwał 1 h 1 min\)/);
});

test("step: would-pause once per incident and at most every eventRepeatSec", () => {
  const w = (t, inc) => pauseEvent(`${iso(t)} CRITICAL (confirmed 3s ago) -> WOULD pauseAll (DRY_RUN, nothing sent) incident=crit-${inc}`);
  let r = step(newState(T), { events: [w(T, T)], reasons: { [`crit-${T}`]: "R" }, now: T });
  assert.equal(r.messages.length, 1); assert.match(r.messages[0], /ZAPAUZOWAŁABY.*Powód \(monitor\): R/s);
  assert.equal(r.state.queue[0].prio, PRIO.ALARM);
  for (let t = T + 60; t < T + DEFAULTS.eventRepeatSec; t += 60) { r = step(drain(r.state), { events: [w(t, t), w(t, T)], now: t }); assert.equal(r.messages.length, 0); }
  r = step(drain(r.state), { events: [w(T + DEFAULTS.eventRepeatSec, T + DEFAULTS.eventRepeatSec)], now: T + DEFAULTS.eventRepeatSec }); assert.equal(r.messages.length, 1);
});

test("R10-03: the budget limits sending, not alarms: an alarm over the budget waits and goes out when the window allows", () => {
  const cfg = { ...DEFAULTS, maxPerWindow: 3, urgentMaxPerWindow: 2, windowSec: 600 };
  const conds = [1, 2, 3, 4, 5].map((i) => ({ key: `k${i}`, forSec: 0, text: `C${i}` }));
  const fail = pauseEvent(`${iso(T)} ALERT pauseAll FAILED incident=crit-${T} after 3 attempts: pause by hand now`);
  let { state: st } = step(newState(T), { conds, events: [fail], now: T, cfg });
  assert.equal(st.queue.length, 6);
  const out = [];
  const send = (now) => { for (let m; (m = nextToSend(st, now, cfg));) { out.push(m.text); markSent(st, m.id, now); } };
  send(T);
  assert.equal(out.length, 4); assert.match(out[0], /NIEUDANA/); // urgent first, own budget
  assert.deepEqual(out.slice(1), ["🔴 ALARM: C1", "🔴 ALARM: C2", "🔴 ALARM: C3"]);
  // urgent messages never wait for the normal budget, and never use it
  ({ state: st } = step(st, { conds, events: [pauseEvent(`${iso(T)} ALERT pause not confirmed incident=crit-${T + 1}: check by hand now`)], now: T + 10, cfg }));
  send(T + 10); assert.equal(out.length, 5); assert.match(out[4], /NIEPOTWIERDZONA/);
  // the cause goes away before the window frees: the waiting alarms are still delivered (marked as cleared), no bare "back to normal"
  ({ state: st } = step(st, { conds: [], now: T + 300, cfg }));
  send(T + 300); assert.equal(out.length, 5);
  send(T + 601);
  assert.deepEqual(out.slice(5).map((x) => x.split("\n")[0]), ["🔴 ALARM: C4", "🔴 ALARM: C5", "✅ Wróciło do normy: k1 (trwało 5 min)."]);
  assert.match(out[5], /już ustąpił/);
  send(T + 1300); assert.equal(st.queue.length, 0);
});

test("R10-03: normal messages never block urgent ones and urgent ones never starve normal ones", () => {
  const cfg = { ...DEFAULTS, maxPerWindow: 2, urgentMaxPerWindow: 2 };
  const st = newState(T);
  for (let i = 0; i < 5; i++) enqueue(st, { id: `n${i}`, prio: PRIO.ALARM, text: `n${i}`, at: T }, cfg);
  for (let i = 0; i < 5; i++) enqueue(st, { id: `u${i}`, prio: PRIO.URGENT, text: `u${i}`, at: T }, cfg);
  const out = [];
  for (let m; (m = nextToSend(st, T, cfg));) { out.push(m.id); markSent(st, m.id, T); }
  assert.deepEqual(out, ["u0", "u1", "n0", "n1"]);
});

test("R10-04: queue cap drops the lowest priority first, never urgent; one overflow alarm with the count", () => {
  const cfg = { ...DEFAULTS, queueMax: 5 };
  const st = newState(T);
  enqueue(st, { id: "u0", prio: PRIO.URGENT, text: "pause", at: T }, cfg);
  enqueue(st, { id: "a0", prio: PRIO.ALARM, text: "alarm", at: T }, cfg);
  for (let i = 0; i < 3; i++) enqueue(st, { id: `i${i}`, prio: PRIO.INFO, text: "info", at: T }, cfg);
  enqueue(st, { id: "n0", prio: PRIO.NORMAL, text: "normal", at: T }, cfg);
  assert.deepEqual(st.queue.map((q) => q.id), ["overflow:" + T, "u0", "a0", "i1", "i2", "n0"]);
  for (let i = 0; i < 6; i++) enqueue(st, { id: `u${i + 1}`, prio: PRIO.URGENT, text: "pause", at: T + 1 }, cfg);
  // info, then back to normal, then the alarm went; every urgent message stays, over the cap if needed
  assert.deepEqual(st.queue.map((q) => q.id), ["overflow:" + T, "u0", "u1", "u2", "u3", "u4", "u5", "u6"]);
  const o = st.queue.find((q) => q.overflow);
  assert.equal(o.dropped, 5); assert.match(o.text, /usunięto 5 wiadomości/);
  // the overflow alarm goes out first in the normal class
  st.budget = { urgent: Array(99).fill(T), normal: [] };
  assert.equal(nextToSend(st, T + 1, cfg).id, "overflow:" + T);
});

test("state: v1 file of the running service migrates; v2 round-trips; junk is rejected", () => {
  const v1 = { active: { stale: { since: T - 100, lastSent: T - 100, alarmed: true, name: "brak świeżego wyniku monitora" } }, eventLast: { would_pause: T - 50 },
    sent: [T - 100], dropped: 2, outbox: ["[L] 🛑 AUTO-PAUZA wysłana: pauseAll tx 0x1", "[L] 🔴 ALARM: x"], cursor: "s=abc;i=1", startedAt: T - 1000, balances: { bot: { value: 1, at: T } }, daily: "2027-01-15" };
  const st = loadState(JSON.parse(JSON.stringify(v1)), T);
  assert.equal(st.v, 2); assert.equal(st.cursor, "s=abc;i=1"); assert.equal(st.eventLast.would, T - 50);
  assert.deepEqual(st.queue.map((q) => q.prio), [PRIO.URGENT, PRIO.ALARM, PRIO.INFO]);
  assert.ok(st.active.stale.alarmed);
  // an active v1 alarm clears into a back-to-normal
  const r = step(st, { conds: [], now: T });
  assert.equal(r.messages.length, 1); assert.match(r.messages[0], /Wróciło do normy: brak świeżego wyniku monitora/);
  assert.deepEqual(loadState(JSON.parse(JSON.stringify(r.state)), T + 1), r.state);
  for (const junk of [null, [], "x", 5, { v: 3 }, { v: 2, queue: "no" }, { v: 2, queue: [{ id: 1 }], seen: {}, incidents: {}, budget: { urgent: [], normal: [] } },
    { outbox: "x" }, { cursor: 5 }, { active: [] }]) assert.throws(() => loadState(junk, T), undefined, JSON.stringify(junk));
});

test("R11-04: a condition alarm that found no room stays undelivered and is queued as soon as there is room", () => {
  const cfg = { ...DEFAULTS, queueMax: 3 };
  let st = newState(T);
  for (let i = 0; i < 3; i++) enqueue(st, { id: `u${i}`, prio: PRIO.URGENT, text: `u${i}`, at: T }, cfg);
  const c = [{ key: "critical", name: "CRITICAL", forSec: 0, text: "C" }];
  let r = step(st, { conds: c, now: T, cfg });
  assert.deepEqual(r.messages, []); assert.equal(r.state.active.critical.alarmed, false);
  const o = r.state.queue.find((q) => q.overflow); assert.equal(o.dropped, 1);
  r = step(r.state, { conds: c, now: T + 30, cfg });                 // still no room: not counted again
  assert.equal(r.state.queue.find((q) => q.overflow).dropped, 1); assert.equal(r.state.active.critical.alarmed, false);
  st = r.state;
  for (const q of [...st.queue]) markSent(st, q.id, T + 40);          // Telegram delivers, room appears
  r = step(st, { conds: c, now: T + 60, cfg });                      // well before repeatSec
  assert.equal(r.messages.length, 1); assert.match(r.messages[0], /ALARM: C/); assert.ok(r.state.active.critical.alarmed);
  // an already queued alarm evicted later by a higher priority one is undelivered again and comes back
  st = newState(T);
  r = step(st, { conds: [{ key: "info", forSec: 0, text: "I" }], now: T, cfg: { ...cfg, queueMax: 1 } });
  st = r.state; enqueue(st, { id: "u", prio: PRIO.URGENT, text: "u", at: T }, { ...cfg, queueMax: 1 });
  assert.equal(st.active.info.alarmed, false);
  markSent(st, "u", T + 1); st.queue = st.queue.filter((q) => !q.overflow);
  r = step(st, { conds: [{ key: "info", forSec: 0, text: "I" }], now: T + 2, cfg: { ...cfg, queueMax: 1 } });
  assert.match(r.messages[0], /ALARM: I/);
});

test("deliveryText: a delayed message says when it happened", () => {
  assert.equal(deliveryText({ text: "x", at: T }, T + 60), "x");
  assert.match(deliveryText({ text: "x", at: T }, T + 3700), /^x\n\(z \d\d:\d\d:\d\d UTC, wysłane z opóźnieniem 1 h 2 min\)$/);
});

test("R10-07: endpoint and token checks, controlled error codes, redaction", () => {
  assert.equal(checkTelegramApi("https://api.telegram.org").base, "https://api.telegram.org");
  assert.equal(checkTelegramApi("http://127.0.0.1:8081/").base, "http://127.0.0.1:8081");
  for (const bad of ["api.telegram.org", "http://api.telegram.org", "ftp://x", "https://u:p@x", "https://x/?a=1", "http://localhost:1", ""]) assert.equal(checkTelegramApi(bad).ok, false, bad);
  assert.ok(checkToken("123456789:AAbbCCddEEffGGhhIIjjKKllMMnnOOppQQr"));
  for (const bad of ["", "abc", "123:short", "123456789:AAbb CCddEEffGGhhIIjjKKllMMnnOO", "123456789:AAbbCCddEEffGGhhIIjj/KKllMMnnOO"]) assert.equal(checkToken(bad), false, bad);
  const tok = "123456789:AAbbCCddEEffGGhhIIjjKKllMMnnOOppQQr";
  let err;
  try { new Request(`api.telegram.org/bot${tok}/sendMessage`); } catch (e) { err = e; }
  assert.ok(String(err.message).includes(tok)); // what R10-07 found: the raw message holds the token
  assert.doesNotMatch(errorCode(err), /AAbb/);
  assert.equal(errorCode({ cause: { code: "ECONNREFUSED" } }), "ECONNREFUSED");
  assert.equal(errorCode({ name: "TimeoutError" }), "TimeoutError");
  assert.equal(errorCode({ message: tok }), "unknown");
  assert.equal(redact(`x ${tok} y AAbbCCddEEffGGhhIIjjKKllMMnnOOppQQr`, [tok, tok.split(":")[1]]), "x <redacted> y <redacted>");
});

// --- F-01: collateral shortfall (balance_alarm) and staleness of the balance observation -------------------------
const bal = (t, o = {}) => conditions({ metrics: ok({ vmpx_bridge_last_result_timestamp: t - 10, ...o }), now: t });
const SHORT = { vmpx_bridge_severity: 1, vmpx_bridge_balance_alarm: 1, vmpx_bridge_balance_shortfall_seconds: 1900,
  vmpx_bridge_locked_tokens: 1000, vmpx_bridge_circulating_tokens: 1012.5, vmpx_bridge_pending_e2x_tokens: 3, vmpx_bridge_pending_x2e_tokens: 0,
  vmpx_bridge_delta_tokens: -15.5 };
const STALE = { vmpx_bridge_balance_alarm: 0, vmpx_bridge_balance_stale: 1, vmpx_bridge_balance_observed_age_seconds: 400 };

test("F-01: shortfall with evidence OK (WARN) fires at once with duration, delta, locked, circulating, pending", () => {
  const c = bal(T, SHORT);
  assert.deepEqual(keys(c), ["shortfall"]);
  const s = c.find((x) => x.key === "shortfall");
  assert.equal(s.forSec, 0); assert.equal(s.name, "niedobór pokrycia");
  assert.match(s.text, /niedobór pokrycia od 32 min/);
  assert.match(s.text, /delta -15\.5 VMPX/); assert.match(s.text, /lockbox 1 000/); assert.match(s.text, /w obiegu na X1 1 012\.5/);
  assert.match(s.text, /ETH→X1 3, X1→ETH 0/); assert.match(s.text, /NIE działa/);
  const r = step(newState(T), { conds: c, now: T });
  assert.equal(r.messages.length, 1); assert.match(r.messages[0], /^🔴 ALARM: Monitor: niedobór pokrycia/);
  // without the token amounts (no balance result in this tick) the text is still sent
  const bare = bal(T, { vmpx_bridge_balance_alarm: 1 }).find((x) => x.key === "shortfall");
  assert.match(bare.text, /niedobór pokrycia \(lockbox/); assert.doesNotMatch(bare.text, /delta/);
});

test("F-01: shortfall during UNKNOWN (and with no evidence metrics) still fires", () => {
  const c = bal(T, { ...SHORT, vmpx_bridge_severity: 3, vmpx_bridge_unknown_seconds: 700 });
  assert.deepEqual(keys(c), ["shortfall", "unknown"]);
  const m = ok({ ...SHORT, vmpx_bridge_severity: 3, vmpx_bridge_evidence_unknown_seconds: 60 });
  delete m.vmpx_bridge_evidence_critical; delete m.vmpx_bridge_evidence_sources_diverged;
  assert.deepEqual(keys(conditions({ metrics: m, now: T })), ["shortfall"]);
});

test("F-01: stale balance holds an active shortfall alarm and raises 'saldo pokrycia nieaktualne' after the debounce", () => {
  let r = step(newState(T), { conds: bal(T, SHORT), now: T });
  assert.equal(r.messages.length, 1);
  // the monitor exports alarm=0 while stale: that is not "back to normal"
  const c = bal(T + 60, STALE);
  assert.ok(c.some((x) => x.key === "shortfall" && x.hold));
  const st = c.find((x) => x.key === "balstale");
  assert.equal(st.forSec, DEFAULTS.balanceStaleForSec); assert.match(st.text, /saldo pokrycia nieaktualne \(ostatnia udana obserwacja 7 min temu\)/);
  r = step(drain(r.state), { conds: c, now: T + 60 });
  assert.deepEqual(r.messages, []);
  assert.ok(r.state.active.shortfall.alarmed);
  for (const t of [T + 300, T + 600]) {
    r = step(drain(r.state), { conds: bal(t, STALE), now: t });
    assert.deepEqual(r.messages, []);
  }
  r = step(drain(r.state), { conds: bal(T + 661, STALE), now: T + 661 });
  assert.equal(r.messages.length, 1); assert.match(r.messages[0], /🔴 ALARM: Monitor: saldo pokrycia nieaktualne/);
  assert.ok(r.state.active.shortfall.alarmed);
  // age too old although stale == 0 (e.g. clock / exporter mismatch), and age unknown (-1): not fresh either
  for (const o of [{ vmpx_bridge_balance_observed_age_seconds: 121 }, { vmpx_bridge_balance_observed_age_seconds: -1 }]) {
    const k = bal(T, o);
    assert.ok(k.some((x) => x.key === "shortfall" && x.hold), JSON.stringify(o));
    assert.deepEqual(keys(k), ["balstale"]);
  }
  assert.match(bal(T, { vmpx_bridge_balance_observed_age_seconds: -1 }).find((x) => x.key === "balstale").text, /brak udanej obserwacji od startu/);
  // a short gap below the debounce clears silently
  let q = step(newState(T), { conds: bal(T, STALE), now: T });
  q = step(drain(q.state), { conds: bal(T + 120), now: T + 120 });
  assert.deepEqual(q.messages, []); assert.deepEqual(q.state.active, {});
});

test("F-01: the shortfall alarm clears only on a fresh observation; the stale alarm clears with it", () => {
  let r = step(newState(T), { conds: bal(T, SHORT), now: T });
  for (const t of [T + 60, T + 700]) r = step(drain(r.state), { conds: bal(t, STALE), now: t });
  assert.ok(r.state.active.shortfall.alarmed && r.state.active.balstale.alarmed);
  // fresh, still short: the stale alarm ends, the shortfall alarm stays
  r = step(drain(r.state), { conds: bal(T + 760, SHORT), now: T + 760 });
  assert.equal(r.messages.length, 1); assert.match(r.messages[0], /Wróciło do normy: saldo pokrycia nieaktualne/);
  assert.ok(r.state.active.shortfall.alarmed);
  // fresh, no shortfall: back to normal
  r = step(drain(r.state), { conds: bal(T + 820, { vmpx_bridge_balance_observed_age_seconds: 5 }), now: T + 820 });
  assert.equal(r.messages.length, 1); assert.match(r.messages[0], /Wróciło do normy: niedobór pokrycia \(trwało 14 min\)/);
  assert.deepEqual(r.state.active, {});
});

test("F-01: missing balance metrics (monitor without a balance result / older monitor) hold, unreadable ones are a bad document", () => {
  let r = step(newState(T), { conds: bal(T, SHORT), now: T });
  const m = ok({ vmpx_bridge_last_result_timestamp: T + 290 });
  for (const k of ["vmpx_bridge_balance_alarm", "vmpx_bridge_balance_stale", "vmpx_bridge_balance_observed_age_seconds"]) {
    const x = { ...m }; delete x[k];
    assert.deepEqual(checkMetrics(x), []);
    const c = conditions({ metrics: x, now: T + 300 });
    assert.ok(c.some((y) => y.key === "shortfall" && y.hold) && c.some((y) => y.key === "balstale" && y.hold), k);
    assert.deepEqual(keys(c), []);
    r = step(drain(r.state), { conds: c, now: T + 300 });
    assert.deepEqual(r.messages, []); assert.ok(r.state.active.shortfall.alarmed);
  }
  // metrics unreachable / unreadable: held as well
  for (const c of [conditions({ metrics: null, now: T + 400 }), conditions({ metrics: ok({ vmpx_bridge_balance_alarm: NaN }), now: T + 400 })]) {
    assert.ok(c.some((y) => y.key === "shortfall" && y.hold));
    r = step(drain(r.state), { conds: c, now: T + 400 });
    assert.ok(!r.messages.some((s) => /Wróciło do normy: niedobór/.test(s)));
  }
  assert.ok(checkMetrics(ok({ vmpx_bridge_balance_stale: NaN })).length > 0);
});
