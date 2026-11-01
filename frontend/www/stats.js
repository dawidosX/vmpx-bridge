// Statistics tab (#/stats?bot=all|human|bot). Loaded on demand by app.js; uses its globals ($, t, I18N, LANG, esc, fmt, NET, short).
// Data: /api/stats/daily (30 UTC days + 24 hourly buckets) and /api/stats/limits (on-chain values the indexer reads every minute).
// Charts are inline SVG, no libraries (CSP script-src 'self'). Colors: inflow #36A99C, outflow #C47F24 (validated on the dark
// surface), neutral #8DA0BA for net/TVL. One y-axis per chart; values of different units get their own small chart.
(() => {
  "use strict";
  const C_IN = "#36A99C", C_OUT = "#C47F24", C_NEUTRAL = "#8DA0BA";
  Object.assign(I18N.en, {
    stNote: "Values in VMPX (test tokens, no value). USD values only on mainnet. Updated every minute from on-chain data.",
    stTvl: "Locked on Ethereum (TVL)", stIn: "Inflow 24 h (Ethereum → X1)", stOut: "Outflow 24 h (X1 → Ethereum)", stNet: "Net flow 24 h",
    stN: (n) => `${n} ${n === 1 ? "transfer" : "transfers"}`, stSee: "See transfers →",
    stLimH: "Limits", stTank: (c) => `Works like a tank: at most ${c} VMPX at once, refilled by ${c} VMPX per 24 h, so up to almost twice that can leave within one day.`, stLimX2E: "X1 → Ethereum (unlocks on Ethereum)", stLimE2X: "Ethereum → X1: no limit.",
    stAvail: "Available now", stOut24: "Actual X1 → Ethereum withdrawals (24 h)", stRefilling: "Still refilling", stCap: "Capacity",
    stRefillNote: (h) => `after the limit was raised on 30 Oct; full in ${h}`,
    trH: "LP treasury", trSim: "Testnet: simulation, test tokens without value.", trX1: "X1 treasury (XNT)", trBal: "Balance",
    trClaim: "Bridge fees not yet claimed (in the X1 mailbox)", trFee: (f, m) => `Bridge fee X1 → Ethereum: ${f} XNT per transfer (ceiling ${m} XNT)`,
    trVmpx: "VMPX / VMPXe", trVmpxNote: "after router v2 is deployed (3% fee in VMPX)", trVmpxe: "VMPXe on X1", trVmpxEth: "VMPX on Ethereum",
    trCostH: "Cost coverage (not for LP)", trCostP: "Refunds the relayer's gas; this money does not go to the LP.",
    trHook: "Ethereum fee hook (ETH)", trHookNote: "testnet: old model, 3% in ETH until router v2", trIgp: "X1 IGP (XNT), not yet claimed", trAddr: "Address",
    trRev: "Fees collected for LP", trRevAll: "Total", trRev24: "Last 24 hours",
    plH: "VMPX/XNT pool on X1", plSim: "Testnet: simulation. Test tokens in the XDEX testnet pool, priced with the real XNT/USD (X1 mainnet) and compared with VMPX on Ethereum mainnet.",
    plPrice: "Price", plUsd: "Price in USD", plEth: "VMPX on Ethereum", plDiff: "Difference vs Ethereum", plRes: "Reserves",
    plStart: "Starting price", plPool: "Pool", plXnt: "XNT price",
    plSrc: "Sources (on-chain): XDEX WXNT/USDC.X on X1 mainnet; Uniswap v3 VMPX/WETH and v2 USDC/WETH on Ethereum mainnet.",
    stRefill: (d, h) => `Refills continuously (${d} VMPX per day), full in ${h}.`, stFull: "Refills continuously; full now.",
    stEthCard: "Ethereum (Sepolia)", stX1Card: "X1 testnet", stLocked: "Locked VMPX", stIssued: "Issued VMPXe", stToken: "Token", stMint: "Mint",
    stFee: "Fee", stMin: "Minimum", stMax: "Maximum",
    stFeeEth: (b, mn, mx) => `${b}% of value at the reference price, min ${mn} ETH, max ${mx} ETH`,
    stFeeV2: (b) => `${b}% in VMPX, deducted from the amount (to the LP treasury)`, stGas: "Relayer gas fee", stGasFixed: (f) => `${f} ETH per transfer`,
    stFeeX1: (d) => `delivery ≈ ${d} XNT (IGP) + network ≈ 0.0025 XNT`, stMaxE2X: "no bridge limit (your balance)",
    stMaxX2E: (a) => `up to the available limit (${a} VMPX now)`,
    stFlowsH: "Daily flows, last 30 days", stTvlH: "Locked on Ethereum (TVL), end of day",
    stCountH: "Transfers per day", stMedH: "Median delivery time", stFeeEthH: "LP revenue per day: bridge fee (XNT)", stFeeX1H: "Cost coverage per day: delivery, IGP (XNT)",
    stInL: "Inflow (ETH → X1)", stOutL: "Outflow (X1 → ETH)", stNetL: "Net", stE2XL: "ETH → X1", stX2EL: "X1 → ETH",
    stTable: "Data table", stDay: "Day (UTC)", stCount: "Transfers", stLoading: "Loading statistics…",
    stAge: (s) => `On-chain values read ${s} s ago.`, stExp: "explorer",
  });
  Object.assign(I18N.pl, {
    stNote: "Wartości w VMPX (tokeny testowe, bez wartości). Wartości w USD tylko na mainnecie. Aktualizowane co minutę z danych on-chain.",
    stTvl: "Zablokowane na Ethereum (TVL)", stIn: "Napływ 24 h (Ethereum → X1)", stOut: "Odpływ 24 h (X1 → Ethereum)", stNet: "Przepływ netto 24 h",
    stN: (n) => `transferów: ${n}`, stSee: "Zobacz transfery →",
    stLimH: "Limity", stTank: (c) => `Działa jak zbiornik: naraz najwyżej ${c} VMPX, uzupełniany o ${c} VMPX na 24 h, więc w ciągu doby może wyjść prawie dwa razy tyle.`, stLimX2E: "X1 → Ethereum (odblokowania na Ethereum)", stLimE2X: "Ethereum → X1: bez limitu.",
    stAvail: "Dostępne teraz", stOut24: "Faktyczne wypłaty X1 → Ethereum (24 h)", stRefilling: "Jeszcze się uzupełnia", stCap: "Pojemność",
    stRefillNote: (h) => `po podniesieniu limitu 30 paź; pełny za ${h}`,
    trH: "Skarbiec LP", trSim: "Testnet: symulacja, tokeny testowe bez wartości.", trX1: "Skarbiec X1 (XNT)", trBal: "Saldo",
    trClaim: "Opłaty za most jeszcze nieodebrane (w skrzynce X1)", trFee: (f, m) => `Opłata za most X1 → Ethereum: ${f} XNT za transfer (sufit ${m} XNT)`,
    trVmpx: "VMPX / VMPXe", trVmpxNote: "po wdrożeniu routera v2 (opłata 3% w VMPX)", trVmpxe: "VMPXe na X1", trVmpxEth: "VMPX na Ethereum",
    trCostH: "Pokrycie kosztów (nie idzie na LP)", trCostP: "Zwrot gazu relayera; te środki nie trafiają do LP.",
    trHook: "Hook opłat na Ethereum (ETH)", trHookNote: "testnet: stary model 3% w ETH do czasu routera v2", trIgp: "IGP na X1 (XNT), jeszcze nieodebrane", trAddr: "Adres",
    trRev: "Zebrane opłaty na LP", trRevAll: "Łącznie", trRev24: "Ostatnie 24 h",
    plH: "Pula VMPX/XNT na X1", plSim: "Testnet: symulacja. Tokeny testowe w puli XDEX na testnecie, wycenione prawdziwym kursem XNT/USD (X1 mainnet) i porównane z VMPX na Ethereum mainnet.",
    plPrice: "Cena", plUsd: "Cena w USD", plEth: "VMPX na Ethereum", plDiff: "Różnica względem Ethereum", plRes: "Rezerwy",
    plStart: "Cena startowa", plPool: "Pula", plXnt: "Kurs XNT",
    plSrc: "Źródła (on-chain): XDEX WXNT/USDC.X na X1 mainnet; Uniswap v3 VMPX/WETH i v2 USDC/WETH na Ethereum mainnet.",
    stRefill: (d, h) => `Uzupełnia się na bieżąco (${d} VMPX na dobę), pełny za ${h}.`, stFull: "Uzupełnia się na bieżąco; teraz pełny.",
    stEthCard: "Ethereum (Sepolia)", stX1Card: "X1 testnet", stLocked: "Zablokowane VMPX", stIssued: "Wydane VMPXe", stToken: "Token", stMint: "Mint",
    stFee: "Opłata", stMin: "Minimum", stMax: "Maksimum",
    stFeeEth: (b, mn, mx) => `${b}% wartości wg ceny referencyjnej, min ${mn} ETH, max ${mx} ETH`,
    stFeeV2: (b) => `${b}% w VMPX, potrącane z kwoty (do skarbca LP)`, stGas: "Opłata za gaz relayera", stGasFixed: (f) => `${f} ETH za transfer`,
    stFeeX1: (d) => `dostarczenie ≈ ${d} XNT (IGP) + sieć ≈ 0,0025 XNT`, stMaxE2X: "bez limitu mostu (do salda)",
    stMaxX2E: (a) => `do dostępnego limitu (teraz ${a} VMPX)`,
    stFlowsH: "Przepływy dzienne, ostatnie 30 dni", stTvlH: "Zablokowane na Ethereum (TVL), koniec dnia",
    stCountH: "Transfery na dzień", stMedH: "Mediana czasu dostarczenia", stFeeEthH: "Przychód na LP dziennie: opłata za most (XNT)", stFeeX1H: "Pokrycie kosztów dziennie: dostarczenie, IGP (XNT)",
    stInL: "Napływ (ETH → X1)", stOutL: "Odpływ (X1 → ETH)", stNetL: "Netto", stE2XL: "ETH → X1", stX2EL: "X1 → ETH",
    stTable: "Tabela danych", stDay: "Dzień (UTC)", stCount: "Transfery", stLoading: "Wczytuję statystyki…",
    stAge: (s) => `Dane on-chain odczytane ${s} s temu.`, stExp: "eksplorator",
  });

  const ST = { route: null, daily: null, limits: null, err: null, seq: 0, timer: null };
  const big = (v) => { try { return BigInt(v); } catch { return 0n; } };
  const num18 = (v) => Number(big(v) / 10n ** 12n) / 1e6;           // VMPX as a float, for geometry only
  const compact = (v18) => {
    const v = big(v18), neg = v < 0n, a = neg ? -v : v;
    const s = a >= 10n ** 24n ? new Intl.NumberFormat(t("locale"), { notation: "compact", maximumFractionDigits: 2 }).format(Number(a / 10n ** 14n) / 10000) : fmt(a, 18, 2);
    return (neg ? "−" : "") + s;
  };
  const full = (v18) => { const v = big(v18); return (v < 0n ? "−" : "") + fmt(v < 0n ? -v : v, 18, 9) + " VMPX"; };
  const hours = (s) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${(s / 3600).toLocaleString(t("locale"), { maximumFractionDigits: 1 })} h`);
  const dayLabel = (d) => { const [, m, dd] = d.split("-"); return `${+dd}.${m}`; };
  const svgEl = (tag, attrs) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  async function load() {
    const seq = ++ST.seq;
    try {
      const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
      const [d, l, all] = await Promise.all([get(`/api/stats/daily?days=30&bot=${ST.route.bot}`), get("/api/stats/limits"),
        ST.route.bot === "all" ? null : get("/api/stats/daily?days=1&bot=all")]);   // the limit counts every withdrawal, whatever the filter
      if (seq !== ST.seq) return;
      // v47: an answer of an unexpected shape is an error, never half-assigned state that makes render() throw
      const okDaily = (x) => !!(x && typeof x === "object" && x.last24h && typeof x.last24h === "object" && Array.isArray(x.days));
      if (!okDaily(d) || (all && !okDaily(all)) || !l || typeof l !== "object") throw "txErr";
      ST.daily = d; ST.limits = l; ST.out24all = (all || d).last24h.out; ST.err = null;
    } catch (e) { if (seq === ST.seq) ST.err = e === 429 ? "txBusy" : "txErr"; }
    render();
    clearTimeout(ST.timer); ST.timer = setTimeout(() => { if (!$("viewStats").classList.contains("hidden")) load(); }, 60000);
  }

  // ---------- small building blocks ----------
  function filterRow() {
    const b = ST.route.bot;
    const btn = (v, k) => `<button type="button" data-v="${v}" aria-pressed="${b === v}">${esc(t(k))}</button>`;
    return `<div class="txfilters"><div class="net" role="group" id="stBot" aria-label="${esc(t("fBotAria"))}">${btn("all", "fAnyone")}${btn("human", "fHuman")}${btn("bot", "fBot")}</div></div>`;
  }
  function tile(id, label, value, title, sub, link, accent) {
    return `<div class="stat sttile${accent ? " big" : ""}"><strong class="num" title="${esc(title)}">${esc(value)}</strong><small>${esc(label)}</small>` +
      `${sub ? `<small class="muted">${esc(sub)}</small>` : ""}<div class="spark" id="${id}"></div>${link ? `<a class="stlink" href="${link}">${esc(t("stSee"))}</a>` : ""}</div>`;
  }
  function copyRow(label, value, href) {
    return `<div class="strow"><span class="muted">${esc(label)}</span><span><code>${esc(short(value))}</code><button type="button" class="copy" data-copy="${esc(value)}">${esc(t("copy"))}</button>` +
      `<a class="copy" href="${esc(href)}" target="_blank" rel="noopener">${esc(t("stExp"))}</a></span></div>`;
  }
  const kv = (k, v) => `<div class="strow"><span class="muted">${esc(k)}</span><span class="num">${esc(v)}</span></div>`;

  // ---------- render ----------
  function render() {
    if (!ST.route) return;
    const body = $("stBody");
    if (!ST.daily || !ST.limits) { body.innerHTML = `<p class="muted">${esc(ST.err ? t(ST.err) : t("stLoading"))}</p>`; return; }
    const D = ST.daily, L = ST.limits, b = ST.route.bot, bq = b === "all" ? "" : `&bot=${b}`;
    const h24 = D.last24h;
    // limit = available now + actual withdrawals in the last 24 h + still refilling (after the raise on 30 Oct)
    const cap = big(L.rl_capacity), lvl = big(L.rl_level), out24 = big(ST.out24all);
    const used = cap > lvl ? cap - lvl : 0n, outPart = out24 < used ? out24 : used, refilling = used - outPart;
    const share = (v) => (cap > 0n ? Number((v * 10000n) / cap) / 100 : 0);
    const pct = share(lvl), pOut = share(outPart), pRef = share(refilling);
    const perDay = L.rl_refill_per_s ? big(L.rl_refill_per_s) * 86400n : 0n;
    const fp = L.fee_params || {};
    body.innerHTML = filterRow() +
      `<p class="statnote">${esc(t("stNote"))}${L.age_s != null ? " " + esc(t("stAge", L.age_s)) : ""}</p>` +
      `<div class="stats st4">` +
        tile("spTvl", t("stTvl"), compact(L.lockbox), full(L.lockbox), "", "#/tx", true) +
        tile("spIn", t("stIn"), compact(h24.in), full(h24.in), t("stN", h24.count_e2x), `#/tx?dir=e2x${bq}`) +
        tile("spOut", t("stOut"), compact(h24.out), full(h24.out), t("stN", h24.count_x2e), `#/tx?dir=x2e${bq}`) +
        tile("spNet", t("stNet"), (big(h24.net) > 0n ? "+" : "") + compact(h24.net), full(h24.net), t("stN", h24.count), `#/tx${bq ? "?" + bq.slice(1) : ""}`) +
      `</div>` +
      `<section class="card stcard"><h3>${esc(t("stLimH"))}</h3>` +
        `<p><b>${esc(t("stLimX2E"))}</b></p>` +
        `<div class="stbar" role="img" aria-label="${esc(`${t("stAvail")} ${pct}%, ${t("stOut24")} ${pOut}%, ${t("stRefilling")} ${pRef}%`)}">` +
          `<i data-w="${pct}"></i><i class="out" data-w="${pOut}"></i><i class="ref" data-w="${pRef}"></i></div>` +
        `<div class="legend">${legend([["#36A99C", "stAvail", "rect"], ["#1F6B63", "stOut24", "rect"], ["#3A4A63", "stRefilling", "rect"]])}</div>` +
        kv(t("stOut24"), `${compact(out24.toString())} VMPX`) +
        kv(t("stAvail"), `${compact(L.rl_level)} VMPX (${pct.toLocaleString(t("locale"))} %)`) +
        kv(t("stRefilling"), refilling > 0n ? `${compact(refilling.toString())} VMPX` : "0") +
        (refilling > 0n && L.rl_full_in_s ? `<p class="muted small u-rtight">${esc(t("stRefillNote", hours(L.rl_full_in_s)))}</p>` : "") +
        kv(t("stCap"), `${compact(L.rl_capacity)} VMPX`) +
        `<p class="muted small">${esc(L.rl_full_in_s ? t("stRefill", compact(perDay.toString()), hours(L.rl_full_in_s)) : t("stFull"))}</p>` +
        `<p class="muted small">${esc(t("stTank", compact(L.rl_capacity)))}</p>` +
        `<p class="muted small">${esc(t("stLimE2X"))}</p></section>` +
      treasuryCard(L) + poolCard(L.lp_pool) +
      `<div class="stcards">` +
        `<section class="card stcard eth"><h3>${esc(t("stEthCard"))}</h3>` + kv(t("stLocked"), `${compact(L.lockbox)} VMPX`) +
          copyRow(t("stToken"), "0xCC0c84755384b041470C021D338639EDa8831E09", "https://sepolia.etherscan.io/token/0xCC0c84755384b041470C021D338639EDa8831E09") +
          (L.bridge_fee_bps != null ? kv(t("stFee"), t("stFeeV2", L.bridge_fee_bps / 100)) : "") +
          kv(L.bridge_fee_bps != null ? t("stGas") : t("stFee"), fp.fee_bps == null ? "—" : fp.fee_bps === 0 && fp.min_fee_wei === fp.max_fee_wei
            ? t("stGasFixed", fmt(big(fp.min_fee_wei), 18, 6)) : t("stFeeEth", fp.fee_bps / 100, fmt(big(fp.min_fee_wei), 18, 6), fmt(big(fp.max_fee_wei), 18, 6))) +
          kv(t("stMin"), "0.000000001 VMPX".replace(".", LANG === "pl" ? "," : ".")) + kv(t("stMax"), t("stMaxE2X")) + `</section>` +
        `<section class="card stcard x1"><h3>${esc(t("stX1Card"))}</h3>` + kv(t("stIssued"), `${compact((big(L.x1_supply) * 10n ** 9n).toString())} VMPXe`) +
          copyRow(t("stMint"), NET.x1Mint, `${NET.x1.explorer}/address/${NET.x1Mint}`) +
          kv(t("stFee"), L.last_igp_lamports != null ? t("stFeeX1", fmt(big(L.last_igp_lamports), 9, 4)) : "—") +
          kv(t("stMin"), "0.000000001 VMPXe".replace(".", LANG === "pl" ? "," : ".")) + kv(t("stMax"), t("stMaxX2E", compact(L.rl_level))) + `</section>` +
      `</div>` +
      `<section class="card stcard"><h3>${esc(t("stFlowsH"))}</h3><div class="legend">${legend([[C_IN, "stInL", "rect"], [C_OUT, "stOutL", "rect"], [C_NEUTRAL, "stNetL", "line"]])}</div><div class="chart" id="chFlows"></div></section>` +
      `<section class="card stcard"><h3>${esc(t("stTvlH"))}</h3><div class="chart" id="chTvl"></div></section>` +
      `<div class="stcards">` +
        `<section class="card stcard"><h3>${esc(t("stCountH"))}</h3><div class="legend">${legend([[C_IN, "stE2XL", "rect"], [C_OUT, "stX2EL", "rect"]])}</div><div class="chart sm" id="chCount"></div></section>` +
        `<section class="card stcard"><h3>${esc(t("stMedH"))}</h3><div class="legend">${legend([[C_IN, "stE2XL", "line"], [C_OUT, "stX2EL", "line"]])}</div><div class="chart sm" id="chMed"></div></section>` +
        `<section class="card stcard"><h3>${esc(t("stFeeEthH"))}</h3><div class="chart sm" id="chFeeEth"></div></section>` +
        `<section class="card stcard"><h3>${esc(t("stFeeX1H"))}</h3><div class="chart sm" id="chFeeX1"></div></section>` +
      `</div>` + table(D.days);
    // bar widths via CSSOM: style="" attributes in innerHTML are blocked by CSP style-src 'self'
    body.querySelectorAll("[data-w]").forEach((e) => { e.style.width = e.dataset.w + "%"; });
    document.querySelectorAll("#stBot button").forEach((x) => x.onclick = () => { location.hash = x.dataset.v === "all" ? "#/stats" : `#/stats?bot=${x.dataset.v}`; });
    drawAll();
  }
  function treasuryCard(L) {
    if (!L.treasury_x1) return "";
    const x = (v) => fmt(big(v), 9, 4) + " XNT", addr = (pk, href) => copyRow(t("trAddr"), pk, href);
    return `<section class="card stcard"><h3>${esc(t("trH"))}</h3><p class="muted small">${esc(t("trSim"))}</p>` +
      revenue() +
      `<p><b>${esc(t("trX1"))}</b></p>` +
      kv(t("trBal"), x(L.treasury_x1_xnt_lamports)) + kv(t("trClaim"), x(L.protocol_claimable_lamports)) +
      addr(L.treasury_x1, `${NET.x1.explorer}/address/${L.treasury_x1}`) +
      `<p class="muted small">${esc(t("trFee", fmt(big(L.protocol_fee_lamports), 9, 4), fmt(big(L.protocol_max_fee_lamports), 9, 4)))}</p>` +
      `<p><b>${esc(t("trVmpx"))}</b></p>` +
      kv(t("trVmpxe"), `${fmt(big(L.treasury_x1_vmpxe || 0), 9, 2)} VMPXe`) +
      kv(t("trVmpxEth"), L.treasury_eth ? `${compact(L.treasury_eth_vmpx)} VMPX` : "0 VMPX") +
      (L.treasury_eth ? addr(L.treasury_eth, `${NET.eth.explorer}/address/${L.treasury_eth}`) : `<p class="muted small">${esc(t("trVmpxNote"))}</p>`) +
      `<h3 class="u-mt16">${esc(t("trCostH"))}</h3><p class="muted small">${esc(t("trCostP"))}</p>` +
      kv(t("trHook"), fmt(big(L.hook_eth_wei), 18, 6) + " ETH") + `<p class="muted small u-rtight">${esc(t("trHookNote"))}</p>` +
      kv(t("trIgp"), x(L.igp_claimable_lamports)) + `</section>`;
  }
  function poolCard(P) {
    if (!P || !P.pool) return "";
    const n = (v, d) => v == null ? "—" : Number(v).toLocaleString(t("locale"), { maximumSignificantDigits: d });
    const usd = (v) => v == null ? "—" : "$" + n(v, 4);
    const pct = (v) => v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString(t("locale"), { maximumFractionDigits: 1 }) + " %";
    return `<section class="card stcard"><h3>${esc(t("plH"))}</h3><p class="muted small">${esc(t("plSim"))}</p>` +
      kv(t("plPrice"), `${n(P.price_xnt, 5)} XNT / VMPXe`) + kv(t("plUsd"), usd(P.price_usd)) +
      kv(t("plEth"), usd(P.vmpx_usd_eth)) + kv(t("plDiff"), pct(P.diff_pct)) +
      kv(t("plRes"), `${fmt(big(P.reserve_xnt_lamports), 9, 4)} XNT + ${fmt(big(P.reserve_vmpxe), 9, 2)} VMPXe`) +
      kv(t("plStart"), `${n(P.start_price_xnt, 5)} XNT (${pct(P.start_diff_pct)})`) + kv(t("plXnt"), usd(P.xnt_usd)) +
      copyRow(t("plPool"), P.pool, `${NET.x1.explorer}/address/${P.pool}`) +
      `<p class="muted small">${esc(t("plSrc"))}</p></section>`;
  }
  function revenue() {   // the same LP-only revenue as the home tile (activity.json stats.fees)
    const F = S.act && S.act.stats && S.act.stats.fees; if (!F || F.lp_xnt_lamports == null) return "";
    const v = (a, b) => `${fmt(big(a), 18, 2)} VMPX + ${fmt(big(b), 9, 4)} XNT`;
    return `<p><b>${esc(t("trRev"))}</b></p>` + kv(t("trRevAll"), v(F.lp_vmpx, F.lp_xnt_lamports)) + kv(t("trRev24"), v(F.lp_vmpx_24h, F.lp_xnt_lamports_24h));
  }
  function legend(items) {
    return items.map(([c, k, kind]) => `<span><svg width="14" height="10" aria-hidden="true">${kind === "rect" ? `<rect x="1" y="1" width="12" height="8" rx="2" fill="${c}"/>` : `<line x1="1" y1="5" x2="13" y2="5" stroke="${c}" stroke-width="2"/>`}</svg>${esc(t(k))}</span>`).join("");
  }
  function table(days) {
    const r = days.slice().reverse().map((d) => `<tr><td>${d.day}</td><td>${esc(compact(d.in))}</td><td>${esc(compact(d.out))}</td><td>${esc(compact(d.net))}</td><td>${d.count}</td>` +
      `<td>${d.median_e2x_s != null ? d.median_e2x_s + " s" : "—"}</td><td>${d.median_x2e_s != null ? d.median_x2e_s + " s" : "—"}</td>` +
      `<td>${esc(fmt(big(d.fee_wei), 18, 4))}</td><td>${esc(fmt(big(d.igp_lamports), 9, 3))}</td><td>${esc(compact(d.tvl))}</td></tr>`).join("");
    return `<details class="card stcard sttable"><summary>${esc(t("stTable"))}</summary><div class="tblwrap"><table><thead><tr><th>${esc(t("stDay"))}</th>` +
      `<th>${esc(t("stInL"))}</th><th>${esc(t("stOutL"))}</th><th>${esc(t("stNetL"))}</th><th>${esc(t("stCount"))}</th><th>${esc(t("stMedH"))} ${esc(t("stE2XL"))}</th>` +
      `<th>${esc(t("stMedH"))} ${esc(t("stX2EL"))}</th><th>ETH</th><th>XNT</th><th>TVL</th></tr></thead><tbody>${r}</tbody></table></div></details>`;
  }

  // ---------- charts ----------
  // generic: columns (one per x), each with bars and/or line points; one y-scale; hover tooltip per column
  function chart(el, opt) {
    if (!el) return;
    el.textContent = "";
    const W = Math.max(240, el.clientWidth), H = opt.h || 200, pl = 58, pr = 8, pt = 8, pb = 22;
    const n = opt.x.length, cw = (W - pl - pr) / n;
    let lo = Math.min(0, ...opt.series.flatMap((s) => s.v.filter((x) => x != null).map((x) => (s.neg ? -x : x))));
    let hi = Math.max(0, ...opt.series.flatMap((s) => s.v.filter((x) => x != null).map((x) => (s.neg ? -x : x))));
    if (hi === lo) hi = lo + 1;
    const y = (v) => pt + (hi - v) / (hi - lo) * (H - pt - pb);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": opt.label });
    for (let i = 0; i <= 2; i++) {   // recessive grid + y labels
      const v = lo + (hi - lo) * i / 2, yy = y(v);
      svg.appendChild(svgEl("line", { x1: pl, x2: W - pr, y1: yy, y2: yy, stroke: "#1F3150", "stroke-width": 1 }));
      const tx = svgEl("text", { x: pl - 6, y: yy + 4, "text-anchor": "end", fill: "#8DA0BA", "font-size": 11 }); tx.textContent = opt.fmtY(v); svg.appendChild(tx);
    }
    if (lo < 0) svg.appendChild(svgEl("line", { x1: pl, x2: W - pr, y1: y(0), y2: y(0), stroke: "#8DA0BA", "stroke-width": 1 }));
    const step = Math.ceil(n / Math.max(2, Math.floor((W - pl) / 52)));
    opt.x.forEach((lab, i) => { if (i % step === (n - 1) % step) { const last = i === n - 1, tx = svgEl("text", { x: last ? W - pr : pl + cw * i + cw / 2, y: H - 6, "text-anchor": last ? "end" : "middle", fill: "#8DA0BA", "font-size": 11 }); tx.textContent = lab; svg.appendChild(tx); } });
    const bars = opt.series.filter((s) => s.kind === "bar"), lines = opt.series.filter((s) => s.kind === "line");
    const stacked = opt.stack;
    opt.x.forEach((_, i) => {
      const bw = Math.max(2, cw - 4), x0 = pl + cw * i + (cw - bw) / 2;
      let acc = 0;
      bars.forEach((s, j) => {
        const v = s.v[i] || 0; if (!v) return;
        const sv = s.neg ? -v : v;
        let ya, yb;
        if (stacked) { ya = y(acc + v); yb = y(acc); acc += v; } else { ya = y(Math.max(0, sv)); yb = y(Math.min(0, sv)); }
        const w = stacked ? bw : bw / (bars.length === 2 && !s.neg && !bars.some((q) => q.neg) ? 2 : 1);
        const xx = stacked || bars.some((q) => q.neg) ? x0 : x0 + j * w;
        const hgt = Math.max(1, yb - ya - (stacked && j < bars.length - 1 ? 0 : 0));
        svg.appendChild(svgEl("rect", { x: xx, y: ya + (stacked && j > 0 ? 1 : 0), width: Math.max(1, w - (bars.length > 1 && !stacked && !bars.some((q) => q.neg) ? 1 : 0)), height: Math.max(1, hgt - (stacked && j > 0 ? 1 : 0)), rx: Math.min(4, w / 2), fill: s.c }));
      });
    });
    lines.forEach((s) => {
      const pts = s.v.map((v, i) => (v == null ? null : [pl + cw * i + cw / 2, y(v)]));
      let d = ""; pts.forEach((p, i) => { if (!p) return; d += (d && pts[i - 1] ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); });
      svg.appendChild(svgEl("path", { d, fill: "none", stroke: s.c, "stroke-width": 2, "stroke-linejoin": "round" }));
      pts.forEach((p) => p && svg.appendChild(svgEl("circle", { cx: p[0], cy: p[1], r: 2.5, fill: s.c, stroke: "#0D1A2E", "stroke-width": 1 })));
    });
    const hair = svgEl("line", { x1: 0, x2: 0, y1: pt, y2: H - pb, stroke: "#E6EDF6", "stroke-width": 1, opacity: 0 }); svg.appendChild(hair);
    const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true;
    opt.x.forEach((lab, i) => {
      const r = svgEl("rect", { x: pl + cw * i, y: pt, width: cw, height: H - pt - pb, fill: "transparent", tabindex: 0 });
      const show = () => {
        hair.setAttribute("x1", pl + cw * i + cw / 2); hair.setAttribute("x2", pl + cw * i + cw / 2); hair.setAttribute("opacity", 0.35);
        tip.textContent = ""; const h = document.createElement("b"); h.textContent = opt.tipTitle ? opt.tipTitle(i) : lab; tip.appendChild(h);
        opt.series.forEach((s) => {
          const row = document.createElement("div"); const k = document.createElement("i"); k.style.background = s.c; row.appendChild(k);
          const v = document.createElement("strong"); v.textContent = s.fmt(i); row.appendChild(v);
          const l = document.createElement("span"); l.textContent = " " + s.name; row.appendChild(l); tip.appendChild(row);
        });
        tip.hidden = false;
        const left = Math.min(W - 170, Math.max(0, pl + cw * i + cw / 2 + 10 - (i > n / 2 ? 190 : 0)));
        tip.style.left = left + "px"; tip.style.top = "4px";
      };
      r.addEventListener("pointermove", show); r.addEventListener("focus", show);
      r.addEventListener("pointerleave", () => { tip.hidden = true; hair.setAttribute("opacity", 0); }); r.addEventListener("blur", () => { tip.hidden = true; hair.setAttribute("opacity", 0); });
      svg.appendChild(r);
    });
    el.appendChild(svg); el.appendChild(tip);
  }
  function spark(el, vals, opt) {   // tiny bars (or a line), no axes; the tile's number is the readout
    if (!el) return;
    el.textContent = "";
    const W = Math.max(80, el.clientWidth), H = 28, n = vals.length, cw = W / n;
    const mx = Math.max(1e-9, ...vals.map(Math.abs)), mn = Math.min(0, ...vals);
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true" });
    if (opt.line) {
      const lo = Math.min(...vals), hi = Math.max(...vals) === lo ? lo + 1 : Math.max(...vals);
      const d = vals.map((v, i) => `${i ? "L" : "M"}${(cw * i + cw / 2).toFixed(1)} ${(2 + (hi - v) / (hi - lo) * (H - 4)).toFixed(1)}`).join("");
      svg.appendChild(svgEl("path", { d, fill: "none", stroke: opt.c, "stroke-width": 2 }));
    } else {
      const z = mn < 0 ? H / 2 : H - 1, sc = mn < 0 ? (H / 2 - 1) / mx : (H - 2) / mx;
      vals.forEach((v, i) => { if (!v) return; const h = Math.max(1, Math.abs(v) * sc); svg.appendChild(svgEl("rect", { x: cw * i + 1, y: v > 0 ? z - h : z, width: Math.max(1, cw - 2), height: h, rx: 1.5, fill: v > 0 ? opt.c : (opt.cNeg || opt.c) })); });
    }
    el.appendChild(svg);
  }
  function drawAll() {
    const D = ST.daily; if (!D) return;
    const days = D.days, x = days.map((d) => dayLabel(d.day)), hr = D.hourly;
    const vin = days.map((d) => num18(d.in)), vout = days.map((d) => num18(d.out)), vtvl = days.map((d) => num18(d.tvl));
    const vnet = days.map((d) => (d.count ? num18(d.net) : null));   // no transfers that day: no net point
    const fy = (v) => (v < 0 ? "−" : "") + new Intl.NumberFormat(t("locale"), { notation: "compact", maximumFractionDigits: 1 }).format(Math.abs(v));
    spark($("spTvl"), vtvl, { c: C_NEUTRAL, line: true });
    spark($("spIn"), hr.map((h) => num18(h.in)), { c: C_IN });
    spark($("spOut"), hr.map((h) => num18(h.out)), { c: C_OUT });
    spark($("spNet"), hr.map((h) => num18(h.in) - num18(h.out)), { c: C_IN, cNeg: C_OUT });
    chart($("chFlows"), { label: t("stFlowsH"), x, h: 220, fmtY: fy, tipTitle: (i) => days[i].day, series: [
      { kind: "bar", v: vin, c: C_IN, name: t("stInL"), fmt: (i) => compact(days[i].in) },
      { kind: "bar", v: vout, neg: true, c: C_OUT, name: t("stOutL"), fmt: (i) => compact(days[i].out) },
      { kind: "line", v: vnet, c: C_NEUTRAL, name: t("stNetL"), fmt: (i) => compact(days[i].net) } ] });
    chart($("chTvl"), { label: t("stTvlH"), x, h: 160, fmtY: fy, tipTitle: (i) => days[i].day, series: [
      { kind: "line", v: vtvl, c: C_NEUTRAL, name: "TVL", fmt: (i) => compact(days[i].tvl) } ] });
    chart($("chCount"), { label: t("stCountH"), x, h: 150, stack: true, fmtY: (v) => Math.round(v).toString(), tipTitle: (i) => days[i].day, series: [
      { kind: "bar", v: days.map((d) => d.count_e2x), c: C_IN, name: t("stE2XL"), fmt: (i) => String(days[i].count_e2x) },
      { kind: "bar", v: days.map((d) => d.count_x2e), c: C_OUT, name: t("stX2EL"), fmt: (i) => String(days[i].count_x2e) } ] });
    chart($("chMed"), { label: t("stMedH"), x, h: 150, fmtY: (v) => `${Math.round(v)} s`, tipTitle: (i) => days[i].day, series: [
      { kind: "line", v: days.map((d) => d.median_e2x_s), c: C_IN, name: t("stE2XL"), fmt: (i) => (days[i].median_e2x_s != null ? days[i].median_e2x_s + " s" : "—") },
      { kind: "line", v: days.map((d) => d.median_x2e_s), c: C_OUT, name: t("stX2EL"), fmt: (i) => (days[i].median_x2e_s != null ? days[i].median_x2e_s + " s" : "—") } ] });
    chart($("chFeeEth"), { label: t("stFeeEthH"), x, h: 150, fmtY: (v) => v.toLocaleString(t("locale"), { maximumFractionDigits: 2 }), tipTitle: (i) => days[i].day, series: [
      { kind: "bar", v: days.map((d) => (d.protocol_lamports || 0) / 1e9), c: C_IN, name: "XNT", fmt: (i) => fmt(big(days[i].protocol_lamports || 0), 9, 4) } ] });
    chart($("chFeeX1"), { label: t("stFeeX1H"), x, h: 150, fmtY: (v) => v.toLocaleString(t("locale"), { maximumFractionDigits: 2 }), tipTitle: (i) => days[i].day, series: [
      { kind: "bar", v: days.map((d) => d.igp_lamports / 1e9), c: C_NEUTRAL, name: "XNT (IGP)", fmt: (i) => fmt(big(days[i].igp_lamports), 9, 4) } ] });
  }
  let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (!$("viewStats").classList.contains("hidden")) drawAll(); }, 150); });

  window.STATS = {
    show(route, focus) {
      const changed = !ST.route || ST.route.bot !== route.bot;
      ST.route = route;
      if (changed) { ST.daily = null; }
      render(); load();
      if (focus) $("stH").focus({ preventScroll: true });
    },
    rerender() { if (ST.route && !$("viewStats").classList.contains("hidden")) render(); },
  };
})();
