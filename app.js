/* PAC Money Tracker - plain JavaScript, no external libraries, no tracking. */
(function () {
  "use strict";
  const PD = window.PD, SITE = window.SITE || {};
  const cycles = PD.meta.cycles, groups = PD.meta.groups, K = PD.committees, POLS = PD.politicians;
  const CH_LABEL = ["Given to campaigns & committees", "Ads supporting candidates", "Ads opposing candidates"];
  const CH_SHORT = ["Contributions", "Ads for", "Ads against"];
  const CH_KEY = ["k-contrib", "k-support", "k-oppose"];
  const CH_COLOR = ["var(--s-contrib)", "var(--s-support)", "var(--s-oppose)"];
  const PARTY = { D: "Democrat", R: "Republican", I: "Independent", O: "Other / unknown" };
  const OFFICE = { H: "House", S: "Senate", P: "President" };
  const $ = (s, el) => (el || document).querySelector(s);
  const main = $("#main"), tip = $("#tooltip");
  const state = { view: "overview", id: null, cycle: null, group: null,
                  q: "", party: "", office: "", st: "", sort: "total", dir: -1, limit: 50,
                  ksort: "total", kdir: -1 };

  /* ---------- formatting ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function money(v, full) {
    const neg = v < 0, a = Math.abs(v);
    let s;
    if (full) s = "$" + Math.round(a).toLocaleString("en-US");
    else if (a >= 1e9) s = "$" + (a / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B";
    else if (a >= 1e6) s = "$" + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + "M";
    else if (a >= 1e3) s = "$" + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "K";
    else s = "$" + Math.round(a).toLocaleString("en-US");
    return (neg ? "−" : "") + s;
  }
  const sum3 = (t) => t[0] + t[1] + t[2];
  const cycleLabel = (c) => `${c - 1}–${String(c).slice(2)}`;

  /* ---------- filters & routing ---------- */
  function inFilter(ci, ki) {
    return (state.cycle === null || ci === state.cycle) && (state.group === null || K[ki].g === state.group);
  }
  function polTotals(p, ignoreCycle) {
    const t = [0, 0, 0];
    for (const [ci, ki, ch, amt] of p.t) {
      if ((ignoreCycle || state.cycle === null || ci === state.cycle) && (state.group === null || K[ki].g === state.group)) t[ch] += amt;
    }
    return t;
  }
  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    const [path, query] = h.split("?");
    const parts = (path || "").split("/").filter(Boolean);
    const q = new URLSearchParams(query || "");
    state.view = parts[0] === "p" ? "politician" : parts[0] === "pac" ? "pac" : (parts[0] || "overview");
    state.id = parts[1] || null;
    const cy = parseInt(q.get("cycle"), 10);
    state.cycle = cycles.includes(cy) ? cycles.indexOf(cy) : null;
    const g = q.get("group");
    state.group = g && groups.includes(g) ? groups.indexOf(g) : null;
    const pk = K.findIndex((k) => k.id === q.get("pac"));
    state.pac = pk >= 0 ? pk : null;
  }
  function hashFor(view, id) {
    const q = new URLSearchParams();
    if (state.cycle !== null) q.set("cycle", cycles[state.cycle]);
    if (state.group !== null) q.set("group", groups[state.group]);
    const base = view === "politician" ? `#/p/${id}` : view === "pac" ? `#/pac/${id}` : view === "overview" ? "#/" : `#/${view}`;
    const qs = q.toString();
    return base + (qs ? "?" + qs : "");
  }
  function go(view, id) { location.hash = hashFor(view, id); }
  function filterNote() {
    const bits = [];
    bits.push(state.cycle === null ? `All cycles ${cycles[0] - 1}–${cycles[cycles.length - 1]}` : `${cycleLabel(cycles[state.cycle])} cycle`);
    bits.push(state.group === null ? "all pro-Israel PACs" : groups[state.group]);
    return bits.join(" · ");
  }

  /* ---------- tooltip ---------- */
  function showTip(evt, html) {
    tip.innerHTML = html; tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  function tipRows(title, vals, extra) {
    let h = `<div class="t-title">${esc(title)}</div>`;
    vals.forEach((v, i) => { if (v) h += `<div class="t-row"><span><i class="key ${CH_KEY[i]}"></i>${CH_SHORT[i]}</span><b>${money(v, true)}</b></div>`; });
    h += `<div class="t-row"><span>Total</span><b>${money(sum3(vals), true)}</b></div>`;
    return h + (extra || "");
  }

  /* ---------- chart helpers (SVG) ---------- */
  const NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function roundedTop(x, y, w, h, r) {     // rect with rounded top corners only (data end), square at baseline
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function roundedRight(x, y, w, h, r) {
    r = Math.min(r, h / 2, w);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }
  function legend(series) {
    return `<div class="legend">${series.map((i) => `<span><i class="key ${CH_KEY[i]}"></i>${CH_LABEL[i]}</span>`).join("")}</div>`;
  }

  // Stacked columns: bands = [{label, sub, v:[c,s,o], id}]
  function columns(box, bands, opts) {
    opts = opts || {};
    box.innerHTML = "";
    const W = Math.max(320, box.clientWidth || 600), H = opts.height || 260;
    const m = { t: 10, r: 8, b: 26, l: 48 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const tops = bands.map((b) => Math.max(0, b.v[0]) + Math.max(0, b.v[1]) + Math.max(0, b.v[2]));
    const ymax = niceMax(Math.max(1, ...tops));
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.aria || "Column chart" }, box);
    const grid = el("g", { class: "grid" }, svg);
    for (let i = 0; i <= 4; i++) {
      const v = ymax * i / 4, y = m.t + ih - ih * i / 4;
      el("line", { x1: m.l, x2: W - m.r, y1: y, y2: y }, grid);
      const t = el("text", { x: m.l - 8, y: y + 4, "text-anchor": "end" }, svg); t.textContent = money(v);
    }
    const bw = iw / bands.length, cw = Math.min(24, bw * 0.7);
    const every = Math.ceil(bands.length / Math.floor(iw / 44));
    bands.forEach((b, i) => {
      const g = el("g", { class: "band" }, svg);
      const x0 = m.l + i * bw;
      el("rect", { class: "bg", x: x0, y: m.t, width: bw, height: ih, fill: "transparent" }, g);
      let y = m.t + ih;
      const segs = [0, 1, 2].filter((k) => b.v[k] > 0);
      segs.forEach((k, j) => {
        const h = ih * b.v[k] / ymax;
        const gap = j > 0 ? 2 : 0;                    // 2px surface gap between stacked segments
        const top = y - h, hh = Math.max(0, h - gap);
        if (hh > 0) {
          if (j === segs.length - 1) el("path", { d: roundedTop(x0 + (bw - cw) / 2, top, cw, hh, 4), fill: CH_COLOR[k] }, g);
          else el("rect", { x: x0 + (bw - cw) / 2, y: top, width: cw, height: hh, fill: CH_COLOR[k] }, g);
        }
        y = top;
      });
      if (i % every === 0) {
        const t = el("text", { x: x0 + bw / 2, y: H - 8, "text-anchor": "middle" }, svg); t.textContent = b.label;
      }
      const hit = el("rect", { class: "hit", x: x0, y: m.t, width: bw, height: ih }, svg);
      hit.addEventListener("mousemove", (e) => showTip(e, tipRows(b.title || b.label, b.v, b.extra)));
      hit.addEventListener("mouseleave", hideTip);
      if (opts.onClick) hit.addEventListener("click", () => { hideTip(); opts.onClick(b); });
    });
    if (opts.highlight != null) {
      const i = opts.highlight;
      el("rect", { x: m.l + i * bw + 1, y: m.t, width: bw - 2, height: ih, fill: "none", stroke: "var(--accent)", "stroke-width": 1, rx: 4 }, svg);
    }
  }

  // Horizontal bars. rows = [{label, sub, v:[c,s,o]} ] (stacked) or {label, value} (single)
  function hbars(box, rows, opts) {
    opts = opts || {};
    box.innerHTML = "";
    const W = Math.max(320, box.clientWidth || 600), rowH = 30;
    const labelW = Math.min(opts.labelW || 210, W * 0.42), valW = 70;
    const H = rows.length * rowH + 4;
    const stacked = !!opts.stacked;
    const tot = (r) => stacked ? Math.max(0, r.v[0]) + Math.max(0, r.v[1]) + Math.max(0, r.v[2]) : Math.max(0, r.value);
    const xmax = Math.max(1, ...rows.map(tot));
    const iw = W - labelW - valW - 8;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.aria || "Bar chart" }, box);
    rows.forEach((r, i) => {
      const y = i * rowH + 4, g = el("g", { class: "band" }, svg);
      el("rect", { class: "bg", x: 0, y: y - 3, width: W, height: rowH, fill: "transparent", rx: 6 }, g);
      const lab = el("text", { x: labelW - 10, y: y + 15, "text-anchor": "end", class: "lab" }, g);
      lab.textContent = r.label.length > 30 ? r.label.slice(0, 29) + "…" : r.label;
      const bh = Math.min(16, rowH - 10), by = y + (rowH - 6 - bh) / 2;
      let x = labelW;
      if (stacked) {
        const segs = [0, 1, 2].filter((k) => r.v[k] > 0);
        segs.forEach((k, j) => {
          const w = iw * r.v[k] / xmax, gap = j > 0 ? 2 : 0, ww = Math.max(0, w - gap);
          if (ww > 0) {
            if (j === segs.length - 1) el("path", { d: roundedRight(x + gap, by, ww, bh, 4), fill: CH_COLOR[k] }, g);
            else el("rect", { x: x + gap, y: by, width: ww, height: bh, fill: CH_COLOR[k] }, g);
          }
          x += w;
        });
      } else {
        const w = iw * Math.max(0, r.value) / xmax;
        if (w > 0) el("path", { d: roundedRight(x, by, w, bh, 4), fill: r.dim ? "#4a4c52" : "var(--single)" }, g);
        x += w;
      }
      const vt = el("text", { x: x + 8, y: y + 15, class: "val" }, g);
      vt.textContent = money(stacked ? sum3(r.v) : r.value);
      const hit = el("rect", { class: "hit", x: 0, y: y - 3, width: W, height: rowH }, svg);
      hit.addEventListener("mousemove", (e) => showTip(e, stacked ? tipRows(r.title || r.label, r.v, r.extra)
        : `<div class="t-title">${esc(r.title || r.label)}</div><div class="t-row"><span>Total</span><b>${money(r.value, true)}</b></div>${r.extra || ""}`));
      hit.addEventListener("mouseleave", hideTip);
      if (r.onClick) hit.addEventListener("click", () => { hideTip(); r.onClick(); });
    });
  }

  // "Show table" toggle under a chart
  function tableToggle(panel, headers, rows) {
    const btn = document.createElement("button");
    btn.className = "linkish"; btn.type = "button"; btn.textContent = "Show as table";
    const div = document.createElement("div"); div.className = "tableview"; div.hidden = true;
    div.innerHTML = `<table><thead><tr>${headers.map((h, i) => `<th class="${i ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${
      rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? "num" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    btn.addEventListener("click", () => { div.hidden = !div.hidden; btn.textContent = div.hidden ? "Show as table" : "Hide table"; });
    panel.appendChild(btn); panel.appendChild(div);
  }

  /* ---------- shared pieces ---------- */
  function tiles(t, count, hint) {
    const total = sum3(t);
    return `<div class="tiles">
      <div class="tile"><div class="label">Total</div><div class="value">${money(total)}</div><div class="hint">${hint || ""}</div></div>
      ${[0, 1, 2].map((i) => `<div class="tile"><div class="label"><i class="key ${CH_KEY[i]}"></i>${CH_LABEL[i]}</div><div class="value">${money(t[i])}</div></div>`).join("")}
      <div class="tile"><div class="label">${count[0]}</div><div class="value">${count[1].toLocaleString("en-US")}</div><div class="hint">${count[2] || ""}</div></div>
    </div>`;
  }
  function cycleBands(getV) {
    return cycles.map((c, ci) => ({ label: String(c), title: `${cycleLabel(c)} election cycle`, v: getV(ci), ci }));
  }
  const fecCand = (id) => `https://www.fec.gov/data/candidate/${id}/`;
  const fecCmte = (id) => `https://www.fec.gov/data/committee/${id}/`;

  /* ---------- transactions & FEC sources (loaded on demand) ---------- */
  const TX_TYPE = ["Contribution", "Earmarked contribution", "Refund from campaign", "Void / correction"];
  const loaded = {};
  function loadScript(src, cb) {
    if (loaded[src] === true) return cb(true);
    if (loaded[src]) return loaded[src].push(cb);
    loaded[src] = [cb];
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => { const q = loaded[src]; loaded[src] = true; q.forEach((f) => f(true)); };
    s.onerror = () => { const q = loaded[src]; delete loaded[src]; q.forEach((f) => f(false)); };
    document.body.appendChild(s);
  }
  function txBucket(key) {                       // same function as build_data.py
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % PD.meta.txBuckets;
    return String(h).padStart(2, "0");
  }
  function loadTx(key, cb) {
    loadScript("data/recipients.js", (ok1) => {
      if (!ok1) return cb(null);
      loadScript(`data/tx/${txBucket(key)}.js`, (ok2) => cb(ok2 ? ((PD.tx && PD.tx[key]) || []) : null));
    });
  }
  function fecRecord(kid, cycle, d, ch, flag) {         // FEC itemized-record search for one PAC and day
    const day = d && d.length === 8 ? `${d.slice(4, 6)}/${d.slice(6)}/${d.slice(0, 4)}` : "";
    const dd = day ? `&min_date=${day}&max_date=${day}` : "";
    if (ch !== 0) return `https://www.fec.gov/data/independent-expenditures/?committee_id=${kid}&cycle=${cycle}${dd}`;
    return `https://www.fec.gov/data/${flag === 2 ? "receipts" : "disbursements"}/?committee_id=${kid}&two_year_transaction_period=${cycle}${dd}`;
  }
  function srcLink(src, kid, cycle, r) {
    if (!src) return "";
    const url = src === "c" ? fecRecord(kid, cycle, r[3], r[2], r[6])
      : src[0] === "f" ? `https://docquery.fec.gov/cgi-bin/forms/${kid}/${src.slice(1)}/`
      : src.startsWith("http") ? src : `https://docquery.fec.gov/cgi-bin/fecimg/?${src}`;
    const label = src === "c" ? "FEC record" : src[0] === "f" ? "Filing" : "Report page";
    return `<a href="${esc(url)}" target="_blank" rel="noopener"><span class="hide-sm">${label}</span><span class="show-sm">View</span> ↗</a>`;
  }
  const fmtDate = (d) => d && d.length === 8 ? `${d.slice(4, 6)}/${d.slice(6)}/${d.slice(0, 4)}` : "—";
  function txType(ch, flag, amt) {
    if (ch === 0) return TX_TYPE[flag];
    return (ch === 1 ? "Ad supporting" : "Ad opposing") + (amt < 0 ? " (correction)" : "");
  }
  // A list of the filed lines behind a number; sums to the number shown above it
  function txPanel(box, key, opts) {
    const view = state.view, vid = state.id;
    box.innerHTML = `<p class="muted small">Loading the filed transactions…</p>`;
    loadTx(key, (rows) => {
      if (state.view !== view || state.id !== vid) return;
      if (rows === null) { box.innerHTML = `<p class="muted small">Couldn't load the transaction list. The downloads on the Data &amp; methods page have every line.</p>`; return; }
      const R = PD.recipients;
      const base = rows.filter((r) => inFilter(r[0], r[1]));
      const kset = [...new Set(base.map((r) => r[1]))].sort((a, b) => a - b);
      let pac = opts.pac != null && kset.includes(opts.pac) ? opts.pac : null, shown = 100;
      const draw = () => {
        const list = pac === null ? base : base.filter((r) => r[1] === pac);
        const total = list.reduce((s, r) => s + r[4], 0);
        const sel = opts.showPac && kset.length > 1 ? `<label class="small muted">PAC <select id="tx-pac"><option value="">All PACs (${kset.length})</option>${
          kset.map((ki) => `<option value="${ki}" ${ki === pac ? "selected" : ""}>${esc(K[ki].n)}</option>`).join("")}</select></label>` : "";
        box.innerHTML = `<div class="tx-head">${sel}<span class="small muted">${list.length.toLocaleString("en-US")} line${list.length === 1 ? "" : "s"} · sum ${money(total, true)}${
          pac === null && opts.expect != null ? (Math.abs(total - opts.expect) < 1 ? ` · matches ${opts.expectLabel || "the total above"}` : ` · differs from ${opts.expectLabel || "the total above"} by ${money(total - opts.expect, true)}`) : ""}</span></div>
          ${list.length ? `<div class="tx-scroll"><table class="tx"><thead><tr><th>Date</th>${opts.showPac ? "<th>PAC</th>" : ""}<th class="hide-sm">To</th><th class="hide-sm">Type</th><th class="num">Amount</th><th>Source</th></tr></thead><tbody>${
          list.slice(0, shown).map((r) => `<tr><td class="nowrap">${fmtDate(r[3])}${opts.showPac ? "" : `<div class="small muted show-sm">${txType(r[2], r[6], r[4])}</div>`}</td>${opts.showPac ? `<td>${esc(K[r[1]].n)}<div class="small muted show-sm">${txType(r[2], r[6], r[4])}</div></td>` : ""}<td class="hide-sm small">${r[7] >= 0 ? esc(R[r[7]][1]) : "—"}</td><td class="hide-sm small">${txType(r[2], r[6], r[4])}</td><td class="num nowrap">${money(r[4], true)}</td><td class="small nowrap">${srcLink(r[5], K[r[1]].id, cycles[r[0]], r)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted small">No lines for these filters.</p>`}
          ${list.length > shown ? `<button class="linkish" type="button" id="tx-more">${list.length - shown <= 250 ? `Show the other ${(list.length - shown).toLocaleString("en-US")}` : `Show 250 more (${(list.length - shown).toLocaleString("en-US")} not shown yet)`}</button>` : ""}`;
        const ps = box.querySelector("#tx-pac");
        if (ps) ps.addEventListener("change", () => { pac = ps.value === "" ? null : parseInt(ps.value, 10); shown = 100; draw(); });
        const more = box.querySelector("#tx-more");
        if (more) more.addEventListener("click", () => { shown += 250; draw(); });
      };
      draw();
    });
  }

  /* ---------- views ---------- */
  function viewOverview() {
    // money totals: every counted dollar, including money not tied to one politician
    const t = [0, 0, 0]; let notTied = 0;
    for (const [ci, ki, ch, hc, amt] of PD.overall) if (inFilter(ci, ki)) { t[ch] += amt; if (!hc) notTied += amt; }
    const polT = POLS.map((p) => ({ p, v: polTotals(p) })).filter((x) => Math.abs(sum3(x.v)) >= 1);
    main.innerHTML = `
      <h1>${esc(SITE.name || "PAC Money Tracker")}</h1>
      <p class="sub">${esc(SITE.tagline || "")}</p>
      ${tiles(t, ["Politicians", polT.length, "got money, or had ads run for or against them"],
              notTied ? `Includes ${money(notTied)} given to parties and other committees, not tied to one politician` : "")}
      <section class="panel" id="p-cycle"><div class="panel-head"><div><h2 id="cyc-title"></h2><p id="cyc-sub"></p></div></div>
        ${legend([0, 1, 2])}<div class="chart" id="c-cycle"></div></section>
      <div class="grid2">
        <section class="panel" id="p-group"><div class="panel-head"><div><h2>By PAC group</h2><p>Click a group to filter the whole site</p></div></div><div class="chart" id="c-group"></div></section>
        <section class="panel" id="p-top"><div class="panel-head"><div><h2>Top politicians</h2><p>Money to, for or against them. Click for details</p></div></div>${legend([0, 1, 2])}<div class="chart" id="c-top"></div></section>
      </div>
      <div class="grid2">
        <section class="panel" id="p-party"><div class="panel-head"><div><h2>By politician's party</h2><p>Money to, for or against politicians of each party</p></div></div><div class="chart" id="c-party"></div></section>
        <section class="panel" id="p-state"><div class="panel-head"><div><h2>Top states</h2><p>House and Senate races only</p></div></div><div class="chart" id="c-state"></div></section>
      </div>`;

    // 1) by cycle, or by month inside one cycle
    const cy = state.cycle;
    let bands;
    if (cy === null) {
      const acc = cycles.map(() => [0, 0, 0]);
      for (const [ci, ki, ch, , amt] of PD.overall) if (inFilter(ci, ki)) acc[ci][ch] += amt;
      bands = cycleBands((ci) => acc[ci]);
      $("#cyc-title").textContent = "Money by election cycle";
      $("#cyc-sub").textContent = "Each cycle covers two years (the 2026 cycle runs 2025–26). Click a column to see that cycle by month";
      columns($("#c-cycle"), bands, { aria: "Money by election cycle", onClick: (b) => { state.cycle = b.ci; go(state.view === "overview" ? "overview" : state.view); } });
    } else {
      const c = cycles[cy], months = [];
      for (const y of [c - 1, c]) for (let mth = 1; mth <= 12; mth++) months.push(`${y}-${String(mth).padStart(2, "0")}`);
      const acc = Object.fromEntries(months.map((m) => [m, [0, 0, 0]]));
      for (const [ym, ki, ch, amt] of PD.monthly) if (acc[ym] && (state.group === null || K[ki].g === state.group)) acc[ym][ch] += amt;
      bands = months.map((m) => ({ label: new Date(m + "-15").toLocaleString("en-US", { month: "short" }) + (m.endsWith("-01") ? " ’" + m.slice(2, 4) : ""),
                                   title: new Date(m + "-15").toLocaleString("en-US", { month: "long", year: "numeric" }), v: acc[m] }));
      $("#cyc-title").textContent = `Money by month, ${cycleLabel(c)} cycle`;
      $("#cyc-sub").textContent = "By the date on each filing line";
      columns($("#c-cycle"), bands, { aria: "Money by month" });
    }
    tableToggle($("#p-cycle"), ["Period", ...CH_SHORT, "Total"], bands.filter((b) => sum3(b.v)).map((b) => [b.title || b.label, ...b.v.map((v) => money(v, true)), money(sum3(b.v), true)]));

    // 2) by group
    const gt = groups.map(() => 0);
    for (const [ci, ki, , , amt] of PD.overall) if (state.cycle === null || ci === state.cycle) gt[K[ki].g] += amt;
    const grows = groups.map((g, gi) => ({ label: g, value: gt[gi], dim: state.group !== null && state.group !== gi,
      onClick: () => { state.group = state.group === gi ? null : gi; go("overview"); } })).filter((r) => r.value).sort((a, b) => b.value - a.value);
    hbars($("#c-group"), grows, { aria: "Money by PAC group", labelW: 170 });
    tableToggle($("#p-group"), ["Group", "Total"], grows.map((r) => [r.label, money(r.value, true)]));

    // 3) top politicians
    const top = polT.slice().sort((a, b) => sum3(b.v) - sum3(a.v)).slice(0, 15);
    const dup = new Set(top.map((x) => x.p.n).filter((n, i, arr) => arr.indexOf(n) !== i));
    hbars($("#c-top"), top.map((x) => ({ label: dup.has(x.p.n) ? `${x.p.n} (${x.p.o === "S" ? "Senate" : x.p.o === "P" ? "Pres." : x.p.seat})` : x.p.n, title: `${x.p.n} (${x.p.p}, ${x.p.seat || OFFICE[x.p.o] || ""})`, v: x.v, onClick: () => go("politician", x.p.id) })),
          { stacked: true, aria: "Top politicians", labelW: 170 });
    tableToggle($("#p-top"), ["Politician", ...CH_SHORT, "Total"], top.map((x) => [x.p.n, ...x.v.map((v) => money(v, true)), money(sum3(x.v), true)]));

    // 4) by party, 5) by state
    const pt = { D: 0, R: 0, I: 0, O: 0 }, st = {};
    for (const x of polT) {
      pt[x.p.p] += sum3(x.v);
      if (x.p.s && x.p.o !== "P") st[x.p.s] = (st[x.p.s] || 0) + sum3(x.v);
    }
    const prow = Object.keys(pt).filter((k) => pt[k]).map((k) => ({ label: PARTY[k] + "s".repeat(k === "O" ? 0 : 1), value: pt[k] })).sort((a, b) => b.value - a.value);
    hbars($("#c-party"), prow, { aria: "Money by party", labelW: 140 });
    tableToggle($("#p-party"), ["Party", "Total"], prow.map((r) => [r.label, money(r.value, true)]));
    const srow = Object.entries(st).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s, v]) => ({ label: s, value: v,
      onClick: () => { state.st = s; go("politicians"); } }));
    hbars($("#c-state"), srow, { aria: "Top states", labelW: 60 });
    tableToggle($("#p-state"), ["State", "Total"], srow.map((r) => [r.label, money(r.value, true)]));
  }

  function viewPoliticians() {
    const states = [...new Set(POLS.map((p) => p.s).filter(Boolean))].sort();
    main.innerHTML = `
      <h1>Politicians</h1>
      <p class="sub">Every federal candidate who got money from these PACs, or had ads run for or against them. ${esc(filterNote())}.</p>
      <div class="toolbar">
        <label>Search<input type="search" id="q" placeholder="Name" value="${esc(state.q)}"></label>
        <label>Party<select id="fp"><option value="">All parties</option>${Object.entries(PARTY).map(([k, v]) => `<option value="${k}" ${state.party === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Office<select id="fo"><option value="">All offices</option>${Object.entries(OFFICE).map(([k, v]) => `<option value="${k}" ${state.office === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>State<select id="fs"><option value="">All states</option>${states.map((s) => `<option ${state.st === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        <span class="muted small" id="count"></span>
      </div>
      <div class="panel" style="padding:0;overflow:auto"><table id="ptable"></table></div>
      <button class="more" id="more" type="button">Show more</button>`;
    const draw = () => {
      const q = state.q.trim().toLowerCase();
      let rows = POLS.filter((p) => (!q || p.n.toLowerCase().includes(q)) && (!state.party || p.p === state.party)
        && (!state.office || p.o === state.office) && (!state.st || p.s === state.st))
        .map((p) => ({ p, v: polTotals(p) })).filter((x) => Math.abs(sum3(x.v)) >= 1);
      const key = { total: (x) => sum3(x.v), c: (x) => x.v[0], s: (x) => x.v[1], o: (x) => x.v[2], name: (x) => x.p.n };
      rows.sort((a, b) => { const A = key[state.sort](a), B = key[state.sort](b); return (A < B ? -1 : A > B ? 1 : 0) * state.dir; });
      $("#count").textContent = `${rows.length.toLocaleString("en-US")} politicians`;
      const head = [["name", "Politician"], [null, "Party"], ["c", "Contributions"], ["s", "Ads for"], ["o", "Ads against"], ["total", "Total"]];
      $("#ptable").innerHTML = `<thead><tr>${head.map(([k, l], i) => `<th class="${k ? "sortable" : ""} ${i >= 2 ? "num" : ""}" data-k="${k || ""}">${l}${state.sort === k ? ` <span class="arrow">${state.dir < 0 ? "▼" : "▲"}</span>` : ""}</th>`).join("")}</tr></thead>
        <tbody>${rows.slice(0, state.limit).map((x) => `<tr class="clickable" data-id="${esc(x.p.id)}">
          <td><a href="${hashFor("politician", x.p.id)}">${esc(x.p.n)}</a><div class="muted small">${esc(x.p.seat || OFFICE[x.p.o] || "")}${x.p.inc ? " · " + esc(x.p.inc) : ""}${x.p.u ? ' · <span class="pill">no FEC candidate match</span>' : ""}</div></td>
          <td><span class="party" title="${esc(PARTY[x.p.p])}">${x.p.p}</span></td>
          ${x.v.map((v) => `<td class="num">${v ? money(v, true) : "—"}</td>`).join("")}
          <td class="num"><b>${money(sum3(x.v), true)}</b></td></tr>`).join("")}</tbody>`;
      $("#more").hidden = rows.length <= state.limit;
      $("#ptable").querySelectorAll("th.sortable").forEach((th) => th.addEventListener("click", () => {
        const k = th.dataset.k; if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = k === "name" ? 1 : -1; } draw();
      }));
      $("#ptable").querySelectorAll("tr.clickable").forEach((tr) => tr.addEventListener("click", (e) => { if (e.target.tagName !== "A") go("politician", tr.dataset.id); }));
    };
    $("#q").addEventListener("input", (e) => { state.q = e.target.value; state.limit = 50; draw(); });
    $("#fp").addEventListener("change", (e) => { state.party = e.target.value; state.limit = 50; draw(); });
    $("#fo").addEventListener("change", (e) => { state.office = e.target.value; state.limit = 50; draw(); });
    $("#fs").addEventListener("change", (e) => { state.st = e.target.value; state.limit = 50; draw(); });
    $("#more").addEventListener("click", () => { state.limit += 100; draw(); });
    draw();
  }

  function viewPolitician(id) {
    const p = POLS.find((x) => x.id === id);
    if (!p) { main.innerHTML = `<a class="back" href="${hashFor("politicians")}">← Politicians</a><h1>Not found</h1><p class="sub">No money from these PACs is recorded for this candidate.</p>`; return; }
    const t = polTotals(p);
    let returned = 0;
    for (const [ci, ki, amt] of (p.r || [])) if (inFilter(ci, ki)) returned += amt;
    const byK = {};
    for (const [ci, ki, ch, amt] of p.t) {
      if (!inFilter(ci, ki)) continue;
      (byK[ki] = byK[ki] || { v: [0, 0, 0], cyc: new Set() }).v[ch] += amt; byK[ki].cyc.add(cycles[ci]);
    }
    const krows = Object.entries(byK).map(([ki, o]) => ({ k: K[ki], v: o.v, cyc: [...o.cyc].sort() }))
      .filter((r) => Math.abs(sum3(r.v)) >= 1).sort((a, b) => sum3(b.v) - sum3(a.v));
    const acc = cycles.map(() => [0, 0, 0]);
    for (const [ci, ki, ch, amt] of p.t) if (state.group === null || K[ki].g === state.group) acc[ci][ch] += amt;
    const firstC = acc.findIndex((v) => sum3(v)), lastC = acc.length - 1 - [...acc].reverse().findIndex((v) => sum3(v));
    main.innerHTML = `
      <a class="back" href="${hashFor("politicians")}">← Politicians</a>
      <h1>${esc(p.n)}</h1>
      <div class="facts"><span class="pill">${esc(PARTY[p.p])}${p.pf && p.p === "O" ? " · " + esc(p.pf) : ""}</span><span class="pill">${esc(p.seat || OFFICE[p.o] || "")}</span>${p.inc ? `<span class="pill">${esc(p.inc)}</span>` : ""}
        ${p.u ? '<span class="pill">Filings did not include a valid FEC candidate ID</span>' : `<a class="small" href="${fecCand(p.id)}" target="_blank" rel="noopener">FEC page ↗</a>`}</div>
      ${tiles(t, ["PACs involved", krows.length, ""], returned >= 1 ? `What the campaign kept: ${money(returned, true)} it returned (or that was voided) is already subtracted` : esc(filterNote()))}
      ${p.x && (p.x[0] || p.x[1]) && state.group === null ? `<p class="callout">Context, not counted above: PACs that AIPAC's super PAC (UDP) helped fund also spent ${money(p.x[0], true)} supporting and ${money(p.x[1], true)} opposing this politician (2022 cycle onward).</p>` : ""}
      <section class="panel" id="p-pc"><div class="panel-head"><div><h2>By election cycle</h2><p>All cycles shown${state.group !== null ? ", " + esc(groups[state.group]) + " only" : ""}. The cycle filter applies to the totals and table</p></div></div>
        ${legend([0, 1, 2])}<div class="chart" id="c-pc"></div></section>
      <section class="panel" style="padding:0;overflow:auto"><table>
        <thead><tr><th>PAC</th><th>Group</th><th class="hide-sm">Cycles</th><th class="num">Contributions</th><th class="num">Ads for</th><th class="num">Ads against</th><th class="num">Total</th></tr></thead>
        <tbody>${krows.map((r) => `<tr class="clickable" data-k="${esc(r.k.id)}"><td><a href="${hashFor("pac", r.k.id)}">${esc(r.k.n)}</a></td><td><span class="pill">${esc(groups[r.k.g])}</span></td>
          <td class="hide-sm small muted">${r.cyc.length > 4 ? r.cyc[0] + "–" + r.cyc[r.cyc.length - 1] : r.cyc.join(", ")}</td>
          ${r.v.map((v) => `<td class="num">${v ? money(v, true) : "—"}</td>`).join("")}<td class="num"><b>${money(sum3(r.v), true)}</b></td></tr>`).join("")}</tbody></table></section>
      <p class="muted small">Contributions include earmarked donations that a PAC passed through to the campaign. Money given to a joint fundraising committee appears here only when the filing named this candidate.</p>
      ${PD.meta.tx ? `<section class="panel" id="p-tx"><div class="panel-head"><div><h2>Every transaction behind these numbers</h2><p>Each line links to the page of the PAC's own FEC report where it appears. ${esc(filterNote())}</p></div></div><div id="tx-box"></div></section>` : ""}`;
    const bands = firstC < 0 ? [] : cycleBands((ci) => acc[ci]).slice(firstC, lastC + 1);
    if (bands.length) columns($("#c-pc"), bands, { aria: "By election cycle", highlight: state.cycle !== null ? state.cycle - firstC : null, height: 220 });
    tableToggle($("#p-pc"), ["Cycle", ...CH_SHORT, "Total"], bands.filter((b) => sum3(b.v)).map((b) => [b.title, ...b.v.map((v) => money(v, true)), money(sum3(b.v), true)]));
    main.querySelectorAll("tr.clickable").forEach((tr) => tr.addEventListener("click", (e) => { if (e.target.tagName !== "A") go("pac", tr.dataset.k); }));
    if (PD.meta.tx) txPanel($("#tx-box"), p.id, { showPac: true, pac: state.pac, expect: sum3(t) });
  }

  function pacTotals() {
    const out = K.map(() => ({ v: [0, 0, 0], notTied: 0 }));
    for (const [ci, ki, ch, hc, amt] of PD.overall) if (inFilter(ci, ki)) { out[ki].v[ch] += amt; if (!hc) out[ki].notTied += amt; }
    return out;
  }

  function viewPacs() {
    const tt = pacTotals();
    const draw = () => {
      let rows = K.map((k, ki) => ({ k, ki, v: tt[ki].v, nt: tt[ki].notTied })).filter((r) => Math.abs(sum3(r.v)) >= 1);
      const key = { total: (r) => sum3(r.v), c: (r) => r.v[0], s: (r) => r.v[1], o: (r) => r.v[2], name: (r) => r.k.n };
      rows.sort((a, b) => { const A = key[state.ksort](a), B = key[state.ksort](b); return (A < B ? -1 : A > B ? 1 : 0) * state.kdir; });
      const head = [["name", "PAC"], [null, "Group"], [null, "Active"], ["c", "Contributions"], ["s", "Ads for"], ["o", "Ads against"], ["total", "Total"]];
      $("#ktable").innerHTML = `<thead><tr>${head.map(([k, l], i) => `<th class="${k ? "sortable" : ""} ${i >= 3 ? "num" : ""} ${i === 2 ? "hide-sm" : ""}" data-k="${k || ""}">${l}${state.ksort === k ? ` <span class="arrow">${state.kdir < 0 ? "▼" : "▲"}</span>` : ""}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr class="clickable" data-k="${esc(r.k.id)}"><td><a href="${hashFor("pac", r.k.id)}">${esc(r.k.n)}</a><div class="muted small">${esc(r.k.id)}</div></td>
          <td><span class="pill">${esc(groups[r.k.g])}</span></td><td class="hide-sm small muted">${r.k.first - 1}–${r.k.last}</td>
          ${r.v.map((v) => `<td class="num">${v ? money(v, true) : "—"}</td>`).join("")}<td class="num"><b>${money(sum3(r.v), true)}</b></td></tr>`).join("")}</tbody>`;
      $("#kcount").textContent = `${rows.length} PACs`;
      $("#ktable").querySelectorAll("th.sortable").forEach((th) => th.addEventListener("click", () => {
        const k = th.dataset.k; if (state.ksort === k) state.kdir *= -1; else { state.ksort = k; state.kdir = k === "name" ? 1 : -1; } draw();
      }));
      $("#ktable").querySelectorAll("tr.clickable").forEach((tr) => tr.addEventListener("click", (e) => { if (e.target.tagName !== "A") go("pac", tr.dataset.k); }));
    };
    main.innerHTML = `<h1>PACs</h1>
      <p class="sub">The political action committees counted here, grouped by the organization behind them. ${esc(filterNote())}. <span id="kcount"></span></p>
      <p class="callout">These groups disagree with each other on a lot. J Street, for example, often opposes AIPAC's positions. Use the group filter to look at one at a time.</p>
      <div class="panel" style="padding:0;overflow:auto"><table id="ktable"></table></div>`;
    draw();
  }

  function viewPac(id) {
    const ki = K.findIndex((k) => k.id === id);
    if (ki < 0) { main.innerHTML = `<a class="back" href="${hashFor("pacs")}">← PACs</a><h1>Not found</h1>`; return; }
    const k = K[ki], tt = pacTotals()[ki];
    const recips = [];
    for (const p of POLS) {
      const v = [0, 0, 0];
      for (const [ci, kk, ch, amt] of p.t) if (kk === ki && (state.cycle === null || ci === state.cycle)) v[ch] += amt;
      if (Math.abs(sum3(v)) >= 1) recips.push({ p, v });
    }
    recips.sort((a, b) => sum3(b.v) - sum3(a.v));
    const acc = cycles.map(() => [0, 0, 0]);
    for (const [ci, kk, ch, , amt] of PD.overall) if (kk === ki) acc[ci][ch] += amt;
    const firstC = acc.findIndex((v) => sum3(v)), lastC = acc.length - 1 - [...acc].reverse().findIndex((v) => sum3(v));
    main.innerHTML = `<a class="back" href="${hashFor("pacs")}">← PACs</a>
      <h1>${esc(k.n)}</h1>
      <div class="facts"><span class="pill">${esc(groups[k.g])}</span>${k.type ? `<span class="pill">${esc(k.type)}</span>` : ""}<span class="pill">Active ${k.first - 1}–${k.last}</span>
        ${k.thru ? `<span class="pill">Itemized data through ${esc(k.thru)}</span>` : ""}<a class="small" href="${fecCmte(k.id)}" target="_blank" rel="noopener">FEC page ↗</a></div>
      ${tiles(tt.v, ["Politicians", recips.length, ""], tt.notTied ? `Includes ${money(tt.notTied)} not tied to one politician (parties, other committees)` : esc(filterNote()))}
      <section class="panel" id="p-kc"><div class="panel-head"><div><h2>By election cycle</h2><p>All cycles shown</p></div></div>${legend([0, 1, 2])}<div class="chart" id="c-kc"></div></section>
      <section class="panel" style="padding:0;overflow:auto"><table>
        <thead><tr><th>Politician</th><th>Party</th><th class="num">Contributions</th><th class="num">Ads for</th><th class="num">Ads against</th><th class="num">Total</th></tr></thead>
        <tbody>${recips.slice(0, 200).map((x) => `<tr class="clickable" data-id="${esc(x.p.id)}"><td><a href="${hashFor("politician", x.p.id)}${hashFor("politician", x.p.id).includes("?") ? "&" : "?"}pac=${esc(k.id)}">${esc(x.p.n)}</a><div class="muted small">${esc(x.p.seat || OFFICE[x.p.o] || "")}</div></td>
          <td><span class="party">${x.p.p}</span></td>${x.v.map((v) => `<td class="num">${v ? money(v, true) : "—"}</td>`).join("")}<td class="num"><b>${money(sum3(x.v), true)}</b></td></tr>`).join("")}</tbody></table></section>
      ${recips.length > 200 ? `<p class="muted small">Showing the top 200 of ${recips.length.toLocaleString("en-US")}. The downloads have all of them.</p>` : ""}
      <p class="muted small">Open a politician to see each of this PAC's transactions to them, with a link to the FEC report page for every line.</p>
      ${PD.meta.tx && Math.abs(tt.notTied) >= 1 ? `<section class="panel"><div class="panel-head"><div><h2>Money not tied to one politician</h2><p>Payments to parties, joint fundraising committees and other PACs whose filings didn't name a candidate. The rest of this PAC's money is listed on each politician's page. Each line links to the FEC report page.</p></div></div><div id="tx-box"></div></section>` : ""}`;
    const bands = firstC < 0 ? [] : cycleBands((ci) => acc[ci]).slice(firstC, lastC + 1);
    if (bands.length) columns($("#c-kc"), bands, { aria: "By election cycle", highlight: state.cycle !== null ? state.cycle - firstC : null, height: 220 });
    tableToggle($("#p-kc"), ["Cycle", ...CH_SHORT, "Total"], bands.filter((b) => sum3(b.v)).map((b) => [b.title, ...b.v.map((v) => money(v, true)), money(sum3(b.v), true)]));
    main.querySelectorAll("tr.clickable").forEach((tr) => tr.addEventListener("click", (e) => { if (e.target.tagName !== "A") location.hash = tr.querySelector("a").getAttribute("href"); }));
    if (PD.meta.tx && $("#tx-box")) txPanel($("#tx-box"), "K:" + k.id, { showPac: false, expect: tt.notTied, expectLabel: `the ${money(tt.notTied, true)} not tied to one politician in the Total box` });
  }

  function viewAbout() {
    const A = PD.accuracy, st = A.status;
    const pct = (a, b) => b ? ((a - b) / b * 100) : 0;
    const l = A.l23_1990_2024, diff = pct(l[0], l[1]);
    const n = (k) => st[k] || 0;
    const groupRows = A.byGroup.map(([g, era, ds, fe, cnt]) => `<tr><td>${esc(g)}</td><td>${esc(era)}</td><td class="num">${money(ds, true)}</td><td class="num">${money(fe, true)}</td><td class="num">${pct(ds, fe) >= 0 ? "+" : ""}${pct(ds, fe).toFixed(2)}%</td></tr>`).join("");
    const checks = A.checks.slice().sort((a, b) => Math.abs(b.ds - b.fec) - Math.abs(a.ds - a.fec));
    const links = [];
    if (SITE.substackUrl) links.push(`<a href="${esc(SITE.substackUrl)}" target="_blank" rel="noopener">Newsletter</a>`);
    if (SITE.powerBiUrl) links.push(`<a href="${esc(SITE.powerBiUrl)}" target="_blank" rel="noopener">Power BI model (.pbix)</a>`);
    if (SITE.githubUrl) links.push(`<a href="${esc(SITE.githubUrl)}" target="_blank" rel="noopener">Source and data on GitHub</a>`);
    main.innerHTML = `<div class="prose">
      <h1>Data &amp; methods</h1>
      <p class="sub">Every number on this site comes from reports the committees themselves filed with the Federal Election Commission, and each one can be traced to the filed lines behind it. Nothing is estimated or filled in by hand. Data last pulled ${esc(PD.meta.generated)}.</p>

      <h2>What's counted</h2>
      <ul>
        <li><strong>Contributions:</strong> money a PAC gave to a candidate's campaign, leadership PAC, party or joint fundraising committee. This includes <strong>earmarked donations</strong>: when a donor gives through a PAC like AIPAC PAC or JStreetPAC, the PAC reports passing the money on, and it counts here.</li>
        <li><strong>Ads supporting or opposing candidates</strong> (independent expenditures): TV, digital and mail paid for by a PAC, reported with the candidate it supported or opposed.</li>
        <li><strong>Money given back is subtracted.</strong> When a campaign returns a contribution, or a PAC voids one, the totals drop by that amount, so they show what candidates kept.</li>
        <li><strong>Money moved between PACs is not counted as money to politicians</strong>, so each dollar is counted once, where it was given to or spent on a politician. That includes UDP's payments to other super PACs.</li>
      </ul>

      <h2>Which PACs</h2>
      <p>The PACs follow OpenSecrets' long-standing "Pro-Israel" category: AIPAC's two committees (AIPAC PAC and United Democracy Project), J Street, Democratic Majority for Israel, NORPAC, the Republican Jewish Coalition, Pro-Israel America, and dozens of regional PACs, many of them closed now. They're grouped by the organization behind them. The groups often disagree, so use the group filter rather than reading one combined number as a single point of view.</p>
      <p>Not included: lobbying spending, donors to AIPAC itself (it doesn't disclose them), money individuals give directly to campaigns, and super PACs not on that list (for example, Preserve America, a pro-Trump presidential super PAC funded by Miriam and Sheldon Adelson). Ad spending by PACs that UDP helped fund appears only as context on politician pages, never in the totals.</p>

      <h2>How accurate it is</h2>
      <p>Each run compares the dataset with totals the FEC computes itself from the same reports.</p>
      <ul>
        <li><strong>Contributions, 1990–2024:</strong> ${money(l[0], true)} in this dataset vs. ${money(l[1], true)} on the committees' FEC report summaries (${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%).</li>
        <li><strong>Ad spending per candidate:</strong> ${n("candidate_ie|MATCH")} of ${n("candidate_ie|MATCH") + n("candidate_ie|CHECK") + n("candidate_ie|EXPLAINED")} candidate totals match the FEC's own per-candidate figures exactly; ${n("candidate_ie|EXPLAINED")} more differ for a documented reason.</li>
        ${A.refunds && A.refunds[1] ? `<li><strong>Money given back:</strong> for ${A.refunds[0]} of ${A.refunds[1]} PAC-cycles, the refunds subtracted here equal the refund total on the PAC's FEC report summary exactly. Most of the rest are refunds the PAC had already voided (so they aren't subtracted twice) or early reports the FEC never itemized.</li>` : ""}
        ${n("completeness|MATCH") + n("completeness|CHECK") ? `<li><strong>Completeness:</strong> ${n("completeness|MATCH")} of ${n("completeness|MATCH") + n("completeness|CHECK")} downloads returned exactly as many rows as the FEC says exist.</li>` : ""}
        <li><strong>The current cycle lags.</strong> The FEC itemizes reports days to weeks after they're filed. AIPAC PAC's itemized data runs through ${esc(PD.meta.aipacThru)}, and UDP's through ${esc(PD.meta.udpThru)} (including 24- and 48-hour notices for recent ads).</li>
      </ul>
      <div class="panel" style="padding:0;overflow:auto"><table><thead><tr><th>Group</th><th>Years</th><th class="num">This dataset</th><th class="num">FEC summaries</th><th class="num">Difference</th></tr></thead><tbody>${groupRows}</tbody></table></div>
      <p class="small muted">Contributions compared with each PAC's report summary line for contributions (Form 3X line 23). Rows that include 2026 run lower because the FEC hasn't itemized the newest reports yet. Small regional PACs can differ by a single check, often one dated near the boundary between cycles.</p>
      <details class="panel"><summary>Lines that still differ from the FEC (${checks.length})</summary>
        <div class="tableview" style="max-height:420px"><table><thead><tr><th>PAC</th><th>Cycle</th><th>What</th><th class="num">Dataset</th><th class="num">FEC</th></tr></thead><tbody>
        ${checks.map((c) => `<tr><td>${esc(c.n)}</td><td>${esc(c.y)}</td><td class="small">${c.k === "independent_expenditures" ? "Ad spending" : c.lvl === "candidate_ie" ? "Ads for one candidate" : c.lvl === "pull_failed" ? "Download failed" : "Contributions"}</td><td class="num">${money(c.ds, true)}</td><td class="num">${money(c.fec, true)}</td></tr>`).join("")}
        </tbody></table></div></details>
      ${A.notPulled.length ? `<details class="panel"><summary>Listed PACs not included (${A.notPulled.length})</summary><div class="tableview"><table><thead><tr><th>PAC</th><th>Why</th></tr></thead><tbody>
        ${A.notPulled.map((r) => `<tr><td>${esc(r.name)}</td><td class="small">${esc(r.status)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}

      <h2>Download the data</h2>
      <ul>
        ${PD.meta.tx ? `<li><a href="downloads/all_transactions_with_fec_links.zip">Every counted transaction with a link to its FEC report page</a> (${PD.meta.tx.toLocaleString("en-US")} lines, zipped CSV)</li>` : ""}
        <li><a href="downloads/politician_totals_by_cycle.csv">Politician totals by cycle and PAC</a> (CSV)</li>
        <li><a href="downloads/pac_totals_by_cycle.csv">PAC totals by cycle</a> (CSV)</li>
        <li><a href="downloads/accuracy_checks_vs_fec.csv">Every accuracy check against FEC totals</a> (CSV)</li>
        <li><a href="downloads/pac_list_matching.csv">How each listed PAC was matched to its FEC committee</a> (CSV)</li>
        ${links.map((x) => `<li>${x}</li>`).join("")}
      </ul>
      <p>Individual donors are never named anywhere on this site or in its files. Federal law restricts using donor names from FEC reports, and this project is about money going to politicians.</p>

      <h2>Independence</h2>
      <p>This is an independent project. It isn't affiliated with any campaign, party, PAC or advocacy group, and it takes no position on candidates or on Israel policy. Every number can be checked against the source: each politician and PAC page lists the transactions behind its totals, and every line links to the page of the committee's own FEC report where it was filed. The FEC has no page images online for reports filed before 1993, so for those lines (mostly the 1990 and 1992 cycles) the link opens the FEC's own itemized record of the transaction instead: its database search, filtered to that PAC and date. Recipient names on this site are each committee's official FEC name, which can differ slightly from how a PAC wrote it on its report.${SITE.contactEmail ? ` Spot an error? Email <a href="mailto:${esc(SITE.contactEmail)}">${esc(SITE.contactEmail)}</a>.` : ""}</p>
    </div>`;
  }

  /* ---------- shell ---------- */
  function setupShell() {
    document.title = SITE.name || "PAC Money Tracker";
    $("#brand").textContent = SITE.name || "PAC Money Tracker";
    if (SITE.substackUrl) { const a = $("#support-link"); a.href = SITE.substackUrl; a.hidden = false; a.target = "_blank"; a.rel = "noopener"; }
    const fl = [];
    if (SITE.substackUrl) fl.push(`<a href="${esc(SITE.substackUrl)}" target="_blank" rel="noopener">Newsletter</a>`);
    if (SITE.githubUrl) fl.push(`<a href="${esc(SITE.githubUrl)}" target="_blank" rel="noopener">GitHub</a>`);
    fl.push(`<a href="#/about">Data &amp; methods</a>`);
    $("#foot-links").innerHTML = fl.join(" · ");
    const fc = $("#f-cycle");
    fc.innerHTML = `<option value="">All cycles (${cycles[0] - 1}–${cycles[cycles.length - 1]})</option>` +
      cycles.slice().reverse().map((c) => `<option value="${c}">${cycleLabel(c)}</option>`).join("");
    const fg = $("#f-group");
    fg.innerHTML = `<option value="">All pro-Israel PACs</option>` + groups.map((g) => `<option>${esc(g)}</option>`).join("");
    fc.addEventListener("change", () => { const v = parseInt(fc.value, 10); state.cycle = isNaN(v) ? null : cycles.indexOf(v); go(state.view, state.id); });
    fg.addEventListener("change", () => { state.group = fg.value ? groups.indexOf(fg.value) : null; go(state.view, state.id); });
  }

  function render() {
    parseHash();
    $("#f-cycle").value = state.cycle === null ? "" : String(cycles[state.cycle]);
    $("#f-group").value = state.group === null ? "" : groups[state.group];
    $("#filter-note").textContent = state.cycle !== null && cycles[state.cycle] === cycles[cycles.length - 1] ? "Current cycle: newest reports may not be itemized yet" : "";
    document.querySelectorAll(".tabs a").forEach((a) => {
      const v = a.dataset.view;
      a.classList.toggle("active", v === state.view || (v === "politicians" && state.view === "politician") || (v === "pacs" && state.view === "pac"));
      a.href = hashFor(v);
    });
    hideTip();
    if (state.view === "politicians") viewPoliticians();
    else if (state.view === "politician") viewPolitician(state.id);
    else if (state.view === "pacs") viewPacs();
    else if (state.view === "pac") viewPac(state.id);
    else if (state.view === "about") viewAbout();
    else viewOverview();
  }

  let lastW = window.innerWidth, rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (Math.abs(window.innerWidth - lastW) > 40) { lastW = window.innerWidth; render(); } }, 200);
  });
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  setupShell();
  render();
})();
