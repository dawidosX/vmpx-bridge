// White Paper view (#/wp). Loaded on demand by app.js; uses its globals ($, t, LANG).
// Content comes from one source per language: wp/en.json and wp/pl.json (same origin, fetched when the route opens,
// cached per language). The DOM is built ONLY with createElement / textContent: no HTML strings from data
// (CSP script-src/style-src 'self', no inline styles; inline emphasis is data: {"b": "..."} -> <strong>, {"g": "..."} -> gold).
//
// JSON schema (schema 1):
//   { schema: 1, lang: "<language of the text>",
//     meta: { eyebrow, title: Text, lead: Text, version, date, site, badge?, labels: { version, date, site }, endNote?, draft? },
//     metrics: [ { v, l } ],
//     sections: [ { num, title, lead, blocks: Block[] } ] }
//   Text  = string | Seg[];  Seg = string | { b: string } | { g: string }
//   Block = { type: "p", text: Text } | { type: "ul", items: Text[] } | { type: "h2", text: string }
//         | { type: "table", head: string[], rows: string[][], num?: number[] }   (num = columns shown as figures)
//         | { type: "callout", tone: "gold" | "info", label: string, text: Text }
//         | { type: "card", title: string, body: Text[] }
(() => {
  "use strict";
  const VER = 2;   // bump when the JSON files change (cache key on the server side)
  const PDF_EN = "wp/VMPX-Bridge-WP-EN.pdf", PDF_PL = "wp/VMPX-Bridge-WP-PL.pdf";
  const W = { cache: new Map(), seq: 0, shown: false };

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  };
  // inline segments -> text nodes, <strong> and gold <span>; anything else is ignored
  function text(parent, v) {
    const segs = Array.isArray(v) ? v : [v];
    for (const s of segs) {
      if (typeof s === "string") parent.appendChild(document.createTextNode(s));
      else if (s && typeof s.b === "string") parent.appendChild(el("strong", null, s.b));
      else if (s && typeof s.g === "string") parent.appendChild(el("span", "wpgold", s.g));
    }
    return parent;
  }
  const isText = (v) => typeof v === "string" || (Array.isArray(v) && v.every((s) => typeof s === "string" || (s && (typeof s.b === "string" || typeof s.g === "string"))));
  function valid(d) {
    return !!(d && d.meta && isText(d.meta.title) && Array.isArray(d.sections) && d.sections.length &&
      d.sections.every((s) => s && typeof s.title === "string" && Array.isArray(s.blocks)));
  }

  function block(b) {
    switch (b && b.type) {
      case "p": return text(el("p"), b.text);
      case "h2": return el("h3", "wph3", b.text);   // h1 = document title, h2 = section titles
      case "ul": {
        const ul = el("ul", "wpul");
        for (const it of b.items || []) ul.appendChild(text(el("li"), it));
        return ul;
      }
      case "table": {
        const wrap = el("div", "wptable"), table = el("table"), thead = el("thead"), tr = el("tr"), tbody = el("tbody");
        wrap.tabIndex = 0;   // scrollable region reachable by keyboard
        const num = new Set(b.num || []);
        for (const h of b.head || []) { const th = el("th", null, h); th.scope = "col"; tr.appendChild(th); }
        thead.appendChild(tr); table.appendChild(thead);
        for (const row of b.rows || []) {
          const r = el("tr");
          row.forEach((c, i) => r.appendChild(el("td", num.has(i) ? "num" : null, c)));
          tbody.appendChild(r);
        }
        table.appendChild(tbody); wrap.appendChild(table);
        return wrap;
      }
      case "callout": {
        const box = el("div", "wpcallout" + (b.tone === "gold" ? " gold" : ""));
        box.setAttribute("role", "note");
        if (b.label) box.appendChild(el("span", "wpk", b.label));
        box.appendChild(text(el("p"), b.text));
        return box;
      }
      case "card": {
        const box = el("div", "card wpcard");
        if (b.title) box.appendChild(el("h3", "wpcardh", b.title));
        for (const p of b.body || []) box.appendChild(text(el("p"), p));
        return box;
      }
      default: return null;
    }
  }

  // the whole document as one <article>; pure DOM building, no network
  function build(d) {
    const m = d.meta || {}, L = m.labels || {};
    const art = el("article", "wp");
    if (typeof d.lang === "string") art.lang = d.lang;

    const head = el("header", "wphead");
    const eye = el("div", "wpeyerow");
    eye.appendChild(el("p", "wpeye", m.eyebrow || "White Paper"));
    if (m.badge) eye.appendChild(el("span", "wpbadge", m.badge));
    if (m.draft === true) { const dr = el("span", "wpdraft", t("wpDraft")); dr.id = "wpDraft"; dr.setAttribute("role", "note"); dr.lang = LANG; eye.appendChild(dr); }
    head.appendChild(eye);
    const h1 = text(el("h1", "wptitle"), m.title); h1.id = "wpH"; h1.tabIndex = -1;
    head.appendChild(h1);
    if (m.lead) head.appendChild(text(el("p", "wplead"), m.lead));
    const meta = el("dl", "wpmeta");
    for (const [k, v] of [[L.version, m.version], [L.date, m.date], [L.site, m.site]]) {
      if (!v) continue;
      meta.appendChild(el("dt", null, k || "")); meta.appendChild(el("dd", null, v));
    }
    head.appendChild(meta);
    const acts = el("div", "wpacts");
    acts.lang = LANG;
    const pdf = el("a", "txbtn wppdf", t("wpPdf")); pdf.setAttribute("href", PDF_EN); pdf.id = "wpPdf";
    const pdfPl = el("a", "txbtn ghost", t("wpPdfPl")); pdfPl.setAttribute("href", PDF_PL); pdfPl.id = "wpPdfPl";
    acts.appendChild(pdf); acts.appendChild(pdfPl);
    head.appendChild(acts);
    if (Array.isArray(d.metrics) && d.metrics.length) {
      const ms = el("div", "wpmetrics");
      for (const x of d.metrics) { const c = el("div", "wpmetric"); c.appendChild(el("span", "v", x.v)); c.appendChild(el("span", "l", x.l)); ms.appendChild(c); }
      head.appendChild(ms);
    }
    art.appendChild(head);

    for (const s of d.sections) {
      const sec = el("section", "wpsec");
      if (s.num) sec.id = "wp-" + String(s.num).replace(/[^0-9a-z-]/gi, "");
      const h2 = el("h2", "wpsech");
      if (s.num) h2.appendChild(el("span", "wpnum", s.num));
      h2.appendChild(document.createTextNode(s.title));
      sec.appendChild(h2);
      if (s.lead) sec.appendChild(text(el("p", "wpsl"), s.lead));
      for (const b of s.blocks) { const n = block(b); if (n) sec.appendChild(n); }
      art.appendChild(sec);
    }

    const end = el("p", "wpend");
    end.appendChild(document.createTextNode(`${L.version ? L.version + " " : ""}${m.version || ""} · ${m.date || ""} · `));
    end.appendChild(el("span", "wpgold", m.site || ""));
    if (m.endNote) end.appendChild(document.createTextNode(" · " + m.endNote));
    art.appendChild(end);
    return art;
  }

  function load(lang) {
    if (!W.cache.has(lang)) {
      const p = fetch(`wp/${lang}.json?v=${VER}`, { headers: { accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => { if (!valid(d)) throw new Error("schema"); return d; });
      p.catch(() => W.cache.delete(lang));   // a failed load is retried next time
      W.cache.set(lang, p);
    }
    return W.cache.get(lang);
  }

  function status(key) {
    const body = $("wpBody");
    body.replaceChildren(el("p", key === "wpErr" ? "hint err" : "muted", t(key)));
  }

  async function render(focus) {
    const seq = ++W.seq, lang = LANG;
    if (!$("wpBody").firstChild) status("txLoading");
    let d;
    try { d = await load(lang); } catch { if (seq === W.seq) status("wpErr"); return; }
    if (seq !== W.seq) return;
    $("wpBody").replaceChildren(build(d));
    if (focus) { const h = $("wpH"); if (h) h.focus({ preventScroll: true }); }
  }

  window.WP = {
    build, valid,
    show(focus) { W.shown = true; return render(focus); },
    hide() { W.shown = false; W.seq++; },
    rerender() { if (W.shown && !$("viewWp").classList.contains("hidden")) render(false); },
  };
})();
