// Operator alerts for the bridge monitor (pure logic, no I/O; the runner is alerts.mjs).
// Two kinds of input:
//   - conditions (state): active/inactive each poll; an alarm is queued after the condition has held for `forSec`,
//     repeated at most every `repeatSec` while it lasts, and a "back to normal" message is queued when it clears;
//   - events (edges): lines of the auto-pause journal, grouped by incident (incident=crit-<unix ts>); each event has a
//     stable ID (incident+kind+tx, or the journal entry for lines without incident) and is queued once.
// Round H (Codex r10, R10-03/R10-04): nothing is "alerted" until its message is in the durable queue (the state file);
// the budgets limit SENDING only (a message over the budget waits, it is never dropped). Two budgets: urgent (pause
// events, state lost) and normal (everything else), so neither class can starve the other. The queue has a cap:
// above it the lowest priority goes first (info, then back to normal, then alarms), never an urgent message, and one
// overflow alarm says how many were dropped.

export const DEFAULTS = {
  staleSec: 300,       // no finished monitor tick for this long (or metrics unreachable)
  unknownSec: 600,     // evidence unknown for this long
  divergedForSec: 120, // two log sources disagree for this long
  unreachableForSec: 120, // metrics endpoint failing / unreadable for this long (a monitor restart is not an alarm)
  repeatSec: 3600,     // repeat an active alarm at most this often
  eventRepeatSec: 1800,// noisy event kinds (would-pause, config error) at most this often
  maxPerWindow: 10,    // normal messages sent per window
  urgentMaxPerWindow: 20, // urgent messages sent per window (own budget)
  windowSec: 600,
  queueMax: 100,       // queued messages above this: drop the lowest priority first (never urgent), overflow alarm
  recoverSinceSec: 21600, // state lost: read the auto-pause journal back this far
  seenTtlSec: 7 * 86400,  // event IDs and incidents remembered this long (dedup)
  delayNoteSec: 120,   // a message sent later than this after it was queued says when it happened
  balanceMaxAgeSec: 120,  // F-01: a balance observation older than this is not fresh (= the monitor's SHORTFALL_MAX_GAP_S)
  balanceStaleForSec: 600, // F-01: stale / missing balance observation for this long -> observability alarm (rules: BalanceObservationsStale 10m)
};

export const PRIO = { URGENT: 0, ALARM: 1, NORMAL: 2, INFO: 3 };

// R10-05: a document without these (or with a non-finite value) is unreadable input, not "no problem"
export const REQUIRED_METRICS = ["vmpx_bridge_severity", "vmpx_bridge_last_result_timestamp", "vmpx_bridge_unknown_seconds",
  "vmpx_bridge_evidence_unknown_seconds"];
// exported by the monitor only while it has an evidence result (a failed evidence tick drops them; evidence_unknown_seconds
// covers that): absent = those two conditions are unknown (held), present but not a finite number = unreadable document
export const EVIDENCE_METRICS = ["vmpx_bridge_evidence_sources_diverged", "vmpx_bridge_evidence_critical"];
// F-01: the balance (collateral) rule. Absent (older monitor) = the shortfall alarm is unknown (held, never "back to
// normal"); present but not a finite number = unreadable document. The token amounts are only text for the message.
export const BALANCE_METRICS = ["vmpx_bridge_balance_alarm", "vmpx_bridge_balance_stale", "vmpx_bridge_balance_observed_age_seconds"];

// Prometheus text -> { name: value } for unlabelled samples (labelled ones are kept as "name{labels}")
export function parseMetrics(text) {
  const m = {};
  for (const line of String(text).split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const i = line.lastIndexOf(" ");
    if (i > 0) m[line.slice(0, i).trim()] = Number(line.slice(i + 1));
  }
  return m;
}

// -> list of problems (empty = usable)
export function checkMetrics(m) {
  if (!m || typeof m !== "object") return ["brak dokumentu"];
  const bad = [];
  for (const k of REQUIRED_METRICS) {
    if (!(k in m)) bad.push(`brak ${k}`);
    else if (typeof m[k] !== "number" || !Number.isFinite(m[k])) bad.push(`${k} nie jest liczbą`);
  }
  for (const k of [...EVIDENCE_METRICS, ...BALANCE_METRICS]) if (k in m && (typeof m[k] !== "number" || !Number.isFinite(m[k]))) bad.push(`${k} nie jest liczbą`);
  return bad;
}

export const fmtDur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
const fmtTime = (t) => new Date(t * 1000).toISOString().slice(11, 19);

// conditions from one poll. metrics = parsed metrics or null (unreachable); balances = [{label, unit, value, min, error}]
// journalError / stateError: the runner could not read the auto-pause journal / write its state file
export function conditions({ metrics, metricsError, balances = [], journalError, stateError, now, cfg = DEFAULTS }) {
  const out = [];
  const bad = metrics ? checkMetrics(metrics) : null;
  if (!metrics || bad.length) {
    // what the metrics would tell is unknown now: keep those alarms as they are (no false "back to normal")
    for (const key of ["unknown", "diverged", "critical", "shortfall", "balstale"]) out.push({ key, hold: true });
    if (!metrics) {
      out.push({ key: "metrics", hold: true });
      out.push({ key: "stale", name: "brak świeżego wyniku monitora", forSec: cfg.unreachableForSec, text: `Monitor: brak metryk (${metricsError || "nieosiągalne"}). Auto-pauza nie ma na czym działać.` });
    } else {
      out.push({ key: "stale", hold: true });
      out.push({ key: "metrics", name: "metryki monitora nieczytelne", forSec: cfg.unreachableForSec,
        text: `Monitor: dokument metryk niekompletny lub nieczytelny (${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "; …" : ""}). Wcześniejsze alarmy trwają, nie wiadomo, czy ustąpiły; auto-pauza też nie ma pełnych danych.` });
    }
  } else {
    const res = metrics.vmpx_bridge_last_result_timestamp;
    const age = res ? now - res : Infinity;
    if (age > cfg.staleSec) out.push({ key: "stale", name: "brak świeżego wyniku monitora", forSec: 0, text: `Monitor: brak świeżego wyniku od ${res ? fmtDur(age) : "startu"}. Auto-pauza nie działa, dopóki wynik nie wróci.` });
    const unk = Math.max(metrics.vmpx_bridge_unknown_seconds, metrics.vmpx_bridge_evidence_unknown_seconds);
    if (unk > cfg.unknownSec) out.push({ key: "unknown", name: "UNKNOWN > 10 min", forSec: 0, text: `Monitor: stan UNKNOWN od ${fmtDur(unk)} (dowody niepełne). Sprawdź log monitora.` });
    // R10-02: both are COUNTS (messages), any positive value is the condition
    const div = metrics.vmpx_bridge_evidence_sources_diverged, crit = metrics.vmpx_bridge_evidence_critical;
    const hasEv = EVIDENCE_METRICS.every((k) => k in metrics);
    if (!hasEv) out.push({ key: "diverged", hold: true });
    if (!hasEv && metrics.vmpx_bridge_severity !== 2) out.push({ key: "critical", hold: true });
    if (div > 0) out.push({ key: "diverged", name: "rozbieżność źródeł", forSec: cfg.divergedForSec, text: `Monitor: dwa źródła logów ETH podają różne zbiory wiadomości (rozbieżnych: ${div}).` });
    if (metrics.vmpx_bridge_severity === 2 || crit > 0) out.push({ key: "critical", name: "CRITICAL", forSec: 0, text: `Monitor: CRITICAL (dowód naruszenia zabezpieczenia${crit > 0 ? `, wiadomości: ${crit}` : ""}). Auto-pauza powinna zadziałać, sprawdź most.` });
    out.push(...balanceConditions(metrics, cfg));
  }
  for (const b of balances) {
    if (b.value === undefined) {
      out.push({ key: `low:${b.label}`, hold: true });
      if (b.error) out.push({ key: `balread:${b.label}`, name: `odczyt salda ${b.label}`, forSec: cfg.unreachableForSec, text: `Nie można odczytać salda ${b.label} (${b.error}); alarm niskiego salda nie działa.` });
    } else if (b.value < b.min) out.push({ key: `low:${b.label}`, name: `niskie saldo ${b.label}`, forSec: 0, text: `Niskie saldo: ${b.label} ma ${b.value} ${b.unit} (próg ${b.min} ${b.unit}).` });
  }
  if (journalError) out.push({ key: "journal", name: "odczyt logu auto-pauzy", forSec: cfg.unreachableForSec, text: `Nie można odczytać logu auto-pauzy (${journalError}). Zdarzenia pauzy czekają w journalu, kursor stoi.` });
  if (stateError) out.push({ key: "statewrite", name: "zapis stanu usługi alarmów", forSec: 0, text: `Nie można zapisać stanu usługi alarmów (${stateError}). Po restarcie możliwe powtórzenia albo utrata wiadomości z kolejki.` });
  return out;
}

// F-01: collateral shortfall (the monitor's WARN, balance_alarm=1 after 30 min on consecutive observations) and the
// freshness of the balance observation. The alarm fires on balance_alarm == 1 whatever the evidence state (UNKNOWN
// included). It clears ONLY on a fresh observation (stale == 0, 0 <= age <= balanceMaxAgeSec, alarm == 0); a stale,
// unknown or missing observation holds it. The monitor itself exports alarm=0 while stale, so that 0 is not "normal".
function balanceConditions(m, cfg) {
  const out = [];
  if (!BALANCE_METRICS.every((k) => k in m)) {
    out.push({ key: "shortfall", hold: true }, { key: "balstale", hold: true });
    return out;
  }
  const age = m.vmpx_bridge_balance_observed_age_seconds;
  const ageUnknown = age < 0, tooOld = age > cfg.balanceMaxAgeSec, stale = m.vmpx_bridge_balance_stale === 1;
  const fresh = !stale && !ageUnknown && !tooOld;
  if (m.vmpx_bridge_balance_alarm === 1) out.push({ key: "shortfall", name: "niedobór pokrycia", forSec: 0, text: shortfallText(m) });
  else if (!fresh) out.push({ key: "shortfall", hold: true });
  if (!fresh) {
    const why = ageUnknown ? "brak udanej obserwacji od startu monitora" : `ostatnia udana obserwacja ${fmtDur(age)} temu`;
    out.push({ key: "balstale", name: "saldo pokrycia nieaktualne", forSec: cfg.balanceStaleForSec,
      text: `Monitor: saldo pokrycia nieaktualne (${why}). Licznik niedoboru jest unieważniony; alarm niedoboru nie zadziała i nie ustąpi, dopóki odczyt sald nie wróci.` });
  }
  return out;
}
const tokFmt = (x) => (Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: 9 }).replace(/,/g, " ") : "?");
function shortfallText(m) {
  const has = (k) => k in m && Number.isFinite(m[k]);
  const sf = has("vmpx_bridge_balance_shortfall_seconds") && m.vmpx_bridge_balance_shortfall_seconds > 0 ? m.vmpx_bridge_balance_shortfall_seconds : null;
  const parts = [];
  if (has("vmpx_bridge_delta_tokens")) parts.push(`delta ${tokFmt(m.vmpx_bridge_delta_tokens)} VMPX`);
  if (has("vmpx_bridge_locked_tokens")) parts.push(`lockbox ${tokFmt(m.vmpx_bridge_locked_tokens)}`);
  if (has("vmpx_bridge_circulating_tokens")) parts.push(`w obiegu na X1 ${tokFmt(m.vmpx_bridge_circulating_tokens)}`);
  if (has("vmpx_bridge_pending_e2x_tokens") || has("vmpx_bridge_pending_x2e_tokens"))
    parts.push(`w drodze ETH→X1 ${tokFmt(m.vmpx_bridge_pending_e2x_tokens)}, X1→ETH ${tokFmt(m.vmpx_bridge_pending_x2e_tokens)}`);
  return `Monitor: niedobór pokrycia${sf !== null ? ` od ${fmtDur(sf)}` : ""} (lockbox poniżej podaży X1 + transferów w drodze na kolejnych odczytach)`
    + `${parts.length ? `: ${parts.join(", ")}` : ""}. Auto-pauza na tej podstawie NIE działa: sprawdź pokrycie ręcznie (docs/16).`;
}

// --- auto-pause journal ---------------------------------------------------------------------------------------
// prio, limit (at most every eventRepeatSec per kind), reason (attach the monitor's CRITICAL reason)
const KINDS = {
  would: { prio: PRIO.ALARM, limit: true, reason: true },
  config: { prio: PRIO.ALARM, limit: true },
  broadcast: { prio: PRIO.URGENT, reason: true },
  mined: { prio: PRIO.URGENT },
  executed: { prio: PRIO.URGENT },
  paused: { prio: PRIO.URGENT },
  unpaused: { prio: PRIO.URGENT },
  failed: { prio: PRIO.URGENT, reason: true },
  unknown: { prio: PRIO.URGENT, reason: true },
  not_confirmed: { prio: PRIO.URGENT, reason: true },
  no_key: { prio: PRIO.URGENT, reason: true },
};
const fields = (s) => {
  const o = {};
  for (const m of s.matchAll(/(?:^|\s)([a-z_]+)=(\S+)/g)) o[m[1]] = m[2].replace(/[:,;)]+$/, "").slice(0, 100);
  return o;
};
const val = (x) => (x === undefined || x === "?" || x === "" ? undefined : String(x).slice(0, 100));

// one line of the auto-pause journal -> event or null. meta: { ref (stable ID of the journal entry), ts (unix) }
export function pauseEvent(line, meta = {}) {
  const s = String(line);
  const tm = s.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\s/);
  const ts = tm ? Math.floor(Date.parse(tm[1]) / 1000) : meta.ts;
  const f = fields(s);
  const incident = f.incident && /^[\w.-]{1,64}$/.test(f.incident) ? f.incident : undefined;
  const cm = incident && incident.match(/^crit-(\d{9,11})$/);
  const detail = () => s.replace(/^\S+Z\s+/, "").replace(/^ALERT\s+/, "").slice(0, 300);
  let m, e;
  if (/ALERT pauseAll result UNKNOWN/.test(s)) e = { kind: "unknown", detail: detail(), cls: unknownClass(s) };
  else if (/ALERT pauseAll FAILED/.test(s)) e = { kind: "failed", detail: detail() };
  else if (/ALERT pause not confirmed/.test(s)) e = { kind: "not_confirmed", detail: detail() };
  else if (/ALERT CRITICAL but no pauser key/.test(s)) e = { kind: "no_key", detail: detail() };
  else if (/ALERT \S+ not set: configuration error/.test(s)) e = { kind: "config", detail: detail() };
  else if (/WOULD pauseAll \(DRY_RUN/.test(s)) e = { kind: "would" };
  else if (/pauseAll broadcast/.test(s)) e = { kind: "broadcast", replaces: val(f.replaces) };
  else if ((m = s.match(/pauseAll tx (\S+) status (\S+) block (\S+)/))) e = { kind: "mined", tx: val(m[1]), status: m[2], block: m[3], blockhash: val(f.blockhash) };
  else if ((m = s.match(/pause executed in block (\S+)/))) e = { kind: "executed", block: m[1] };
  else if (/bridge paused in both directions/.test(s)) e = { kind: "paused" };
  else if (/bridge no longer paused/.test(s)) e = { kind: "unpaused" };
  else return null; // metrics unreachable / no finished tick / unknown / no action: covered by the conditions
  return { ...e, tx: e.tx ?? val(f.tx), nonce: val(f.nonce), incident, crit: cm ? Number(cm[1]) : undefined, ts, ref: meta.ref };
}

// R11 (answer 11): why the result is UNKNOWN. One message per (incident, tx, class): the same class repeated by every
// timer run is one message, a change of class (e.g. timeout -> nonce used by an unknown tx) is a new one.
export function unknownClass(s) {
  if (/nonce used by an unknown transaction/.test(s)) return "foreign";
  if (/bound to another signer|another signer|another chain|another pauser/.test(s)) return "binding";
  if (/pending record unreadable/.test(s)) return "record";
  if (/not reconciled \(DRY_RUN\)/.test(s)) return "dryrun";
  if (/no settled receipt|waited/.test(s)) return "timeout";
  return "other";
}

const UNKNOWN_WHY = { timeout: "brak rozstrzygniętego receipt w limicie czasu", foreign: "nonce zużyty przez nieznaną transakcję",
  binding: "zapis oczekującej transakcji należy do innego podpisującego, łańcucha lub pausera", record: "zapis oczekującej transakcji nieczytelny",
  dryrun: "zapis oczekującej transakcji nierozliczony przy DRY_RUN" };

const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16); };
export function eventId(e, cfg = DEFAULTS) {
  const tx = e.tx ? e.tx.toLowerCase() : "";
  const cls = e.kind === "unknown" ? `:${e.cls || "other"}` : "";
  if (e.incident) return `${e.incident}:${e.kind}${tx ? `:${tx}` : ""}${cls}`;  // same tx reported twice = one message
  if (tx) return `${e.kind}:${tx}${cls}`;
  // no incident, no tx (old format, or "incident=?" repeated by every timer run): the same text once per time bucket
  if (e.ts) return `${e.kind}:${fnv(e.detail || "")}:${Math.floor(e.ts / Math.max(cfg.eventRepeatSec, 60))}`;
  return `${e.kind}:${e.ref}`;
}

export const needsReason = (e) => Boolean(KINDS[e.kind]?.reason || (e.kind === "mined" && !e.incident));
export const reasonKey = (e) => e.incident || null;
// R11-06: exact correlation. The monitor logs every tick as "<iso> <SEVERITY> tick=<T> ...", T = the second its result was
// published (= vmpx_bridge_last_critical_timestamp of a CRITICAL tick); auto-pause names the incident crit-<T>. The
// window only bounds the journal read; the match is the exact tick. Lines without incident or tick: no reason.
export function reasonWindow(e) {
  return e.crit ? { from: e.crit - 60, to: e.crit + 300, tick: e.crit } : null;
}
// monitor journal (-o cat) -> the reasons of the CRITICAL line of exactly this tick; "" = no such line
export function pickReason(text, tick) {
  for (const l of String(text).split("\n")) {
    const m = l.match(/^\S+Z CRITICAL tick=(\d+) (.*)$/);
    if (m && Number(m[1]) === tick) return m[2].replace(/ evidence .*$/, "").slice(0, 600);
  }
  return "";
}

// reason: string = found, "" = no monitor line with this tick, null = the monitor journal could not be read
export function eventText(e, reason) {
  const why = !needsReason(e) ? "" : reason ? `\nPowód (monitor): ${reason}`
    : !e.crit ? "\nPowód nieustalony (linia bez incident=crit-…)."
      : reason === "" ? `\nPowód nieustalony (brak wpisu monitora dla tick=${e.crit}).` : "\nPowód nieustalony (nie udało się odczytać logu monitora).";
  const inc = e.incident ? `\nIncydent: ${e.incident}${e.crit ? ` (CRITICAL ${fmtTime(e.crit)} UTC)` : ""}` : "";
  const tx = e.tx || "?", nonce = e.nonce ? `, nonce ${e.nonce}` : "";
  const hand = "Wstrzymaj most ręcznie TERAZ (docs/08 §3b).";
  switch (e.kind) {
    case "would": return `⚠️ CRITICAL przy DRY_RUN=1: auto-pauza ZAPAUZOWAŁABY most (nic nie wysłano).${inc}${why}`;
    case "broadcast": return `🛑 AUTO-PAUZA: pauseAll rozesłana, tx ${tx}${nonce}${e.replaces ? ` (zastępuje tx ${e.replaces} z tym samym nonce)` : ""}. Czekam na blok.${inc}${why}\nSprawdź obie flagi i przyczynę (docs/08 §3b).`;
    case "mined": {
      const st = String(e.status).toLowerCase();
      if (["0", "0x0", "failed", "reverted"].includes(st)) return `🚨 pauseAll ODRZUCONA w bloku ${e.block} (status ${e.status}), tx ${tx}.${inc}\n${hand}`;
      return `🛑 AUTO-PAUZA: pauseAll w bloku ${e.block}, tx ${tx}, status ${e.status}${e.blockhash ? `, hash bloku ${e.blockhash}` : ""}.${inc}${why}${e.incident ? "" : "\nSprawdź obie flagi i przyczynę (docs/08 §3b)."}`;
    }
    case "executed": return `🛑 Pauza wykonana w bloku ${e.block} (tx ${tx}).${inc}`;
    case "paused": return `🛑 Auto-pauza potwierdzona: oba kierunki wstrzymane${e.tx ? ` (tx ${e.tx})` : ""}. Wznowienie tylko strażnikiem, po wyjaśnieniu przyczyny i rozliczeniu nonce pausera.${inc}`;
    case "unpaused": return `ℹ️ Most NIE jest już wstrzymany (odczyt latest) po auto-pauzie. Sprawdź, kto go wznowił albo czy blok pauzy nie wypadł z łańcucha.${inc}`;
    case "failed": return `🚨 AUTO-PAUZA NIEUDANA: ${e.detail}${inc}${why}\n${hand}`;
    case "unknown": return `⚠️ Wynik pauseAll NIEZNANY (tx ${tx}${nonce}; ${UNKNOWN_WHY[e.cls] || `szczegóły: ${e.detail}`}): transakcja może jeszcze zostać wykopana. Sprawdź flagi ręcznie TERAZ; przed jakimkolwiek wznowieniem rozlicz nonce pausera (docs/08 §3b).${inc}${why}`;
    case "not_confirmed": return `⚠️ Pauza NIEPOTWIERDZONA (mogła zadziałać): ${e.detail}${inc}${why}\nSprawdź obie flagi ręcznie TERAZ (docs/08 §3b).`;
    case "no_key": return `🚨 CRITICAL, a auto-pauza nie ma klucza pausera.${inc}${why}\n${hand}`;
    case "config": return `🚨 Auto-pauza nie działa: ${e.detail}`;
    default: return `Auto-pauza: ${e.kind}`;
  }
}

// --- state and queue ------------------------------------------------------------------------------------------
// v2 state: { v, cursor, startedAt (journal read start while there is no cursor), active, eventLast, seen {id: t},
//   incidents {id: {at, txs, reason}}, queue [{id, prio, text, at, ckey?, ck?, overflow?, dropped?}],
//   budget {urgent: [t], normal: [t]}, balances, daily }
export function newState(now = 0) {
  return { v: 2, cursor: null, startedAt: now, active: {}, eventLast: {}, seen: {}, incidents: {}, queue: [], budget: { urgent: [], normal: [] }, balances: {}, daily: null };
}

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const okMsg = (q) => isObj(q) && typeof q.id === "string" && Number.isInteger(q.prio) && q.prio >= 0 && q.prio <= 3 && typeof q.text === "string" && Number.isFinite(q.at);

// parsed state file -> v2 state; v1 (the first release: outbox of strings) is migrated; throws on anything else
export function loadState(raw, now) {
  if (!isObj(raw)) throw new Error("state is not an object");
  const st = newState(now);
  if (raw.cursor !== undefined && raw.cursor !== null && typeof raw.cursor !== "string") throw new Error("bad cursor");
  if (raw.active !== undefined && !isObj(raw.active)) throw new Error("bad active");
  if (raw.v === 2) {
    if (!Array.isArray(raw.queue) || !raw.queue.every(okMsg) || !isObj(raw.seen) || !isObj(raw.incidents) || !isObj(raw.budget)
      || !Array.isArray(raw.budget.urgent) || !Array.isArray(raw.budget.normal)) throw new Error("bad v2 state");
    return { ...st, ...raw };
  }
  if (raw.v !== undefined) throw new Error(`unknown state version ${raw.v}`);
  // v1
  const outbox = raw.outbox === undefined ? [] : raw.outbox;
  if (!Array.isArray(outbox)) throw new Error("bad outbox");
  st.cursor = raw.cursor ?? null;
  if (Number.isFinite(raw.startedAt)) st.startedAt = raw.startedAt;
  st.active = raw.active || {};
  for (const [k, t] of Object.entries(isObj(raw.eventLast) ? raw.eventLast : {})) st.eventLast[k === "would_pause" ? "would" : k] = t;
  if (isObj(raw.balances)) st.balances = raw.balances;
  if (typeof raw.daily === "string") st.daily = raw.daily;
  outbox.forEach((t, i) => {
    if (typeof t !== "string") return;
    const urgent = /AUTO-PAUZA|Auto-pauza potwierdzona/.test(t);
    st.queue.push({ id: `v1:${now}:${i}`, prio: urgent ? PRIO.URGENT : PRIO.ALARM, text: t, at: now });
  });
  if (raw.dropped > 0) st.queue.push({ id: `v1:${now}:dropped`, prio: PRIO.INFO, text: `ℹ️ Poprzednia wersja usługi pominęła ${raw.dropped} wiadomości (limit).`, at: now });
  return st;
}

const cloneState = (s) => ({ ...newState(s.startedAt), ...s, active: Object.fromEntries(Object.entries(s.active || {}).map(([k, a]) => [k, { ...a }])),
  eventLast: { ...s.eventLast }, seen: { ...s.seen }, incidents: Object.fromEntries(Object.entries(s.incidents || {}).map(([k, i]) => [k, { ...i, txs: [...(i.txs || [])] }])),
  queue: (s.queue || []).map((q) => ({ ...q })), budget: { urgent: [...(s.budget?.urgent || [])], normal: [...(s.budget?.normal || [])] } });

const overflowText = (pre, n, cap) => `${pre}🔴 ALARM: przepełnienie kolejki alarmów (limit ${cap}): usunięto ${n} wiadomości o niższym priorytecie (najpierw informacyjne, potem „wróciło do normy”, potem alarmy). Zdarzenia pauzy nie są usuwane. Telegram był niedostępny?`;

// put one message in the queue (mutates st). Returns false for a duplicate ID or a message dropped at once. Over the
// cap: drop the lowest priority (oldest first), never urgent and never the overflow alarm itself, which is kept at the
// head of the normal class.
// A dropped condition alarm marks its condition "not delivered" again (R11-04): step() queues it again when there is room.
export function enqueue(st, m, cfg = DEFAULTS, pre = "") {
  if (st.queue.some((q) => q.id === m.id)) return false;
  st.queue.push(m);
  let dropped = 0;
  while (st.queue.length > cfg.queueMax) {
    let vi = -1;
    st.queue.forEach((q, i) => { if (q.prio !== PRIO.URGENT && !q.overflow && (vi < 0 || q.prio > st.queue[vi].prio)) vi = i; });
    if (vi < 0) break;
    const [v] = st.queue.splice(vi, 1); dropped++;
    if (v.ck === "alarm" && st.active?.[v.ckey]) st.active[v.ckey].alarmed = false;
  }
  if (dropped) noteDropped(st, dropped, m.at, cfg, pre);
  return st.queue.includes(m);
}
function noteDropped(st, n, at, cfg, pre) {
  const o = st.queue.find((q) => q.overflow);
  if (o) { o.dropped += n; o.text = overflowText(pre, o.dropped, cfg.queueMax); }
  else st.queue.unshift({ id: `overflow:${at}`, prio: PRIO.ALARM, overflow: true, dropped: n, at, text: overflowText(pre, n, cfg.queueMax) });
}
// room for a message of this priority without dropping one of the same or a higher priority
const hasRoom = (st, prio, cfg) => st.queue.length < cfg.queueMax || st.queue.some((q) => q.prio !== PRIO.URGENT && !q.overflow && q.prio > prio);

// returns { state, messages[] } (messages = texts queued by this step). notices: [{id, prio, text}] from the runner.
// cursor: the journal cursor after the batch the events came from; it is stored in the same state as the queue.
export function step(state, { conds = [], events = [], reasons = {}, notices = [], cursor, now, cfg = DEFAULTS, label = "" }) {
  const st = cloneState(state);
  const pre = label ? `[${label}] ` : "";
  const added = [];
  const put = (m) => { const q = { ...m, text: pre + m.text, at: now }; const ok = enqueue(st, q, cfg, pre); if (ok) added.push(q.text); return ok; };
  for (const n of notices) put(n);
  for (const e of events) {
    const k = KINDS[e.kind];
    if (!k) continue;
    const id = eventId(e, cfg);
    if (st.seen[id] || st.queue.some((q) => q.id === id)) continue;
    st.seen[id] = now;
    if (k.limit) {
      if (now - (st.eventLast[e.kind] || 0) < cfg.eventRepeatSec) continue;
      st.eventLast[e.kind] = now;
    }
    let inc, reason;
    if (e.incident) {
      inc = st.incidents[e.incident] ||= { at: now, txs: [] };
      if (e.tx && !inc.txs.includes(e.tx)) inc.txs.push(e.tx);
      reason = inc.reason;
    }
    const rk = reasonKey(e);
    if (reason === undefined && rk && rk in reasons) { reason = reasons[rk]; if (inc && reason) inc.reason = reason; }
    put({ id, prio: k.prio, text: eventText(e, reason === undefined ? null : reason) });
  }
  const seen = new Set();
  for (const c of conds) {
    seen.add(c.key);
    if (c.hold) continue;
    const a = st.active[c.key] ||= { since: now, lastSent: 0, alarmed: false, name: c.name || c.key };
    if (now - a.since < (c.forSec || 0)) continue;
    if (!a.alarmed) {   // R10-03 / R11-04: alarmed = really queued, in the same state that is written to disk
      if (!hasRoom(st, PRIO.ALARM, cfg)) {   // queue full of urgent / alarm messages: wait for room, counted once
        if (!a.blocked) { a.blocked = true; noteDropped(st, 1, now, cfg, pre); }
        continue;
      }
      if (put({ id: `cond:${c.key}:${a.since}:${now}`, ckey: c.key, ck: "alarm", prio: PRIO.ALARM, text: `🔴 ALARM: ${c.text}` })) {
        a.alarmed = true; a.lastSent = now; delete a.blocked;
      }
    } else if (now - a.lastSent >= cfg.repeatSec) {
      a.lastSent = now;
      // a reminder is pointless while the alarm (or the last reminder) still waits in the queue
      if (!st.queue.some((q) => q.ckey === c.key)) put({ id: `cond:${c.key}:${a.since}:${now}`, ckey: c.key, ck: "repeat", prio: PRIO.INFO, text: `🔴 NADAL: ${c.text} (trwa ${fmtDur(now - a.since)})` });
    }
  }
  for (const [k, a] of Object.entries(st.active)) {
    if (seen.has(k)) continue;
    delete st.active[k];
    if (!a.alarmed) continue;
    const dur = fmtDur(now - a.since);
    st.queue = st.queue.filter((q) => !(q.ckey === k && q.ck === "repeat"));
    const queued = st.queue.find((q) => q.ckey === k && q.ck === "alarm");
    if (queued) { queued.text += `\n(już ustąpił, trwał ${dur})`; delete queued.ckey; delete queued.ck; } // one message, not two
    else put({ id: `cond:${k}:${a.since}:ok`, prio: PRIO.NORMAL, text: `✅ Wróciło do normy: ${a.name || k} (trwało ${dur}).` });
  }
  if (cursor !== undefined) st.cursor = cursor;
  for (const [id, t] of Object.entries(st.seen)) if (now - t > cfg.seenTtlSec) delete st.seen[id];
  for (const [id, i] of Object.entries(st.incidents)) if (now - i.at > cfg.seenTtlSec) delete st.incidents[id];
  return { state: st, messages: added };
}

// the next message the budgets allow (urgent first, then normal; queue order inside a class) or null
export function nextToSend(st, now, cfg = DEFAULTS) {
  st.budget.urgent = st.budget.urgent.filter((t) => now - t < cfg.windowSec);
  st.budget.normal = st.budget.normal.filter((t) => now - t < cfg.windowSec);
  const u = st.queue.find((q) => q.prio === PRIO.URGENT);
  if (u && st.budget.urgent.length < cfg.urgentMaxPerWindow) return u;
  const n = st.queue.find((q) => q.prio !== PRIO.URGENT);
  if (n && st.budget.normal.length < cfg.maxPerWindow) return n;
  return null;
}
export function markSent(st, id, now) {
  const i = st.queue.findIndex((q) => q.id === id);
  if (i < 0) return;
  const [q] = st.queue.splice(i, 1);
  (q.prio === PRIO.URGENT ? st.budget.urgent : st.budget.normal).push(now);
}
export const deliveryText = (q, now, cfg = DEFAULTS) =>
  (now - q.at > cfg.delayNoteSec ? `${q.text}\n(z ${fmtTime(q.at)} UTC, wysłane z opóźnieniem ${fmtDur(now - q.at)})` : q.text);

// --- Telegram configuration and errors (R10-07) ----------------------------------------------------------------
export function checkTelegramApi(s) {
  let u;
  try { u = new URL(String(s)); } catch { return { ok: false, why: "is not a URL" }; }
  if (u.username || u.password || u.search || u.hash) return { ok: false, why: "must not carry credentials, query or fragment" };
  if (!(u.protocol === "https:" || (u.protocol === "http:" && u.hostname === "127.0.0.1"))) return { ok: false, why: "must be https:// (http only for 127.0.0.1)" };
  return { ok: true, base: `${u.origin}${u.pathname.replace(/\/+$/, "")}` };
}
export const checkToken = (t) => /^\d{3,20}:[A-Za-z0-9_-]{20,100}$/.test(String(t));
export const checkChat = (c) => /^(-?\d{1,20}|@[A-Za-z0-9_]{4,64})$/.test(String(c));
// a controlled code for any error (never its message: that may hold a URL, and the URL holds the token)
export function errorCode(e) {
  for (const c of [e?.cause?.code, e?.code, e?.cause?.name, e?.name]) {
    if (typeof c === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(c) && c !== "Error" && c !== "TypeError") return c;
  }
  return "unknown";
}
export function redact(text, secrets = []) {
  let s = String(text);
  for (const x of secrets) if (x && x.length >= 8) s = s.split(x).join("<redacted>");
  return s;
}
