/* ============================================================
 * AdForecast Pro — UI Controller
 * All calculation logic lives in js/calc.js (AdCalc).
 * This file only handles DOM, state, charts, storage & exports.
 * ============================================================ */
(function () {
  'use strict';

  /* ================= STATE ================= */
  const LS_KEY = 'adforecast_pro_state_v1';
  const LS_SAVED = 'adforecast_pro_saved_v1';

  const DEFAULTS = {
    platform: 'google',
    objective: 'leads',
    theme: 'light',
    google: { budget: 50000, cpc: 25, ctr: 2, cvr: 5, days: 30, target: 200, aov: 2000 },
    meta:   { budget: 50000, cpm: 150, ctr: 1.5, cvr: 4, days: 30, target: 200, aov: 2000, frequency: null, freqEnabled: false },
    scenarios: JSON.parse(JSON.stringify(AdCalc.DEFAULT_SCENARIOS))
  };

  let state = loadState();
  let charts = {};

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
      const s = JSON.parse(raw);
      // merge with defaults to survive schema changes
      return Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), s, {
        google: Object.assign({}, DEFAULTS.google, s.google || {}),
        meta: Object.assign({}, DEFAULTS.meta, s.meta || {}),
        scenarios: Object.assign(JSON.parse(JSON.stringify(DEFAULTS.scenarios)), s.scenarios || {})
      });
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
  }
  function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }

  /* ================= FORMATTERS (Indian locale) ================= */
  const nf = (dec) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: dec });
  function fmtNum(v, dec) {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    const d = dec !== undefined ? dec : (Math.abs(v) >= 1000 ? 0 : (Math.abs(v) >= 100 ? 1 : 2));
    return nf(d).format(v);
  }
  function fmtINR(v, dec) { const s = fmtNum(v, dec); return s === null ? null : '₹' + s; }
  function fmtPct(v, dec) { const s = fmtNum(v, dec === undefined ? 2 : dec); return s === null ? null : s + '%'; }
  function fmtX(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + '×';
  }
  // HTML cell — renders N/A gracefully
  function cell(v) { return v === null ? '<span class="na">N/A</span>' : v; }

  /* ================= FIELD CONFIG ================= */
  const FIELDS = [
    { key: 'budget', label: 'Total Advertising Budget', unit: '₹ INR', min: 1000, max: 2000000, step: 1000, dec: 0 },
    { key: 'days', label: 'Campaign Duration', unit: 'days', min: 1, max: 365, step: 1, dec: 0 },
    { key: 'target', label: () => state.objective === 'sales' ? 'Target Sales' : 'Target Leads', unit: () => state.objective === 'sales' ? 'sales' : 'leads', min: 1, max: 10000, step: 1, dec: 0 },
    { key: 'cvr', label: 'Expected Conversion Rate', unit: '%', min: 0.1, max: 30, step: 0.1, dec: 1 },
    { key: 'cpc', label: 'Average CPC', unit: '₹ INR', min: 1, max: 500, step: 0.5, dec: 1, platform: 'google' },
    { key: 'cpm', label: 'Average CPM', unit: '₹ / 1000 imp.', min: 10, max: 1500, step: 5, dec: 0, platform: 'meta' },
    { key: 'ctr', label: 'Expected CTR', unit: '%', min: 0.1, max: 20, step: 0.1, dec: 1 },
    { key: 'aov', label: 'Average Order Value', unit: '₹ INR', min: 100, max: 200000, step: 100, dec: 0, objective: 'sales' }
  ];
  const FREQ_FIELD = { key: 'frequency', label: 'Average Frequency', unit: 'impressions / user', min: 1, max: 15, step: 0.1, dec: 1, platform: 'meta' };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ================= INPUT FIELDS RENDER ================= */
  function buildField(f) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.dataset.key = f.key;
    wrap.innerHTML = `
      <div class="field-top">
        <label>${typeof f.label === 'function' ? f.label() : f.label}</label>
        <span class="unit">${typeof f.unit === 'function' ? f.unit() : f.unit}</span>
      </div>
      <div class="ctrl">
        <input type="range" min="${f.min}" max="${f.max}" step="${f.step}">
        <input type="number" min="0" step="${f.step}" inputmode="decimal">
      </div>`;
    const slider = wrap.querySelector('input[type=range]');
    const num = wrap.querySelector('input[type=number]');

    slider.addEventListener('input', () => { updateSliderFill(slider); setFieldValue(f.key, parseFloat(slider.value)); });
    num.addEventListener('input', () => {
      const v = parseFloat(num.value);
      if (Number.isFinite(v) && v >= 0) setFieldValue(f.key, v, true);
    });
    num.addEventListener('blur', () => syncField(f.key));
    return wrap;
  }

  function setFieldValue(key, value, fromNumber) {
    const p = state.platform;
    if (key === 'frequency') state.meta.frequency = value;
    else state[p][key] = value;
    syncField(key);
    persist();
    recalc();
  }

  // Gradient fill for sliders (glow track follows the thumb)
  function updateSliderFill(slider) {
    const min = parseFloat(slider.min), max = parseFloat(slider.max), v = parseFloat(slider.value);
    const pctFill = max > min ? Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) : 0;
    slider.style.setProperty('--fill', pctFill + '%');
  }

  function syncField(key) {
    const p = state.platform;
    const v = key === 'frequency' ? state.meta.frequency : state[p][key];
    const wrap = document.querySelector(`.field[data-key="${key}"]`);
    if (!wrap) return;
    const slider = wrap.querySelector('input[type=range]');
    const num = wrap.querySelector('input[type=number]');
    if (v === null || v === undefined || !Number.isFinite(v)) { num.value = ''; return; }
    num.value = v;
    slider.value = Math.min(parseFloat(slider.max), Math.max(parseFloat(slider.min), v));
    updateSliderFill(slider);
  }

  function renderFields() {
    const c = $('#fieldsContainer');
    c.innerHTML = '';
    FIELDS.forEach(f => {
      if (f.platform && f.platform !== state.platform) return;
      if (f.objective && f.objective !== state.objective) return;
      c.appendChild(buildField(f));
      syncField(f.key);
    });
    // Meta frequency box
    $('#freqBox').hidden = state.platform !== 'meta';
    const fi = $('#freqInner');
    if (state.platform === 'meta' && !fi.dataset.built) {
      fi.appendChild(buildField(FREQ_FIELD));
      fi.dataset.built = '1';
    }
    $('#freqToggle').checked = !!state.meta.freqEnabled;
    if (fi.firstChild) fi.firstChild.style.display = state.meta.freqEnabled ? '' : 'none';
    syncField('frequency');
    $('#inputHint').textContent = state.platform === 'google'
      ? 'Google Ads engine — click-first (CPC) methodology: Clicks = Budget ÷ CPC, Impressions = Clicks ÷ CTR.'
      : 'Meta Ads engine — impression-first (CPM) methodology: Impressions = (Budget ÷ CPM) × 1000, Clicks = Impressions × CTR.';
  }

  /* ================= SCENARIO EDITOR ================= */
  function renderScenarioEditor() {
    const c = $('#scenarioEditor');
    c.innerHTML = '';
    [['conservative', 'Conservative', 'con'], ['optimistic', 'Optimistic', 'opt']].forEach(([k, label, cls]) => {
      const s = state.scenarios[k];
      const row = document.createElement('div');
      row.className = 'scen-row';
      row.innerHTML = `
        <span class="scen-tag ${cls}">${label}</span>
        <span class="scen-input">CVR <input type="number" class="scenario-num" data-k="${k}" data-f="cvrFactor" min="10" max="300" step="5" value="${Math.round(s.cvrFactor * 100)}"> %</span>
        <span class="scen-input">Cost <input type="number" class="scenario-num" data-k="${k}" data-f="costFactor" min="50" max="300" step="5" value="${Math.round(s.costFactor * 100)}"> %</span>`;
      c.appendChild(row);
    });
    c.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        let v = parseFloat(inp.value);
        if (!Number.isFinite(v)) return;
        v = Math.min(parseFloat(inp.max), Math.max(parseFloat(inp.min), v)) / 100;
        state.scenarios[inp.dataset.k][inp.dataset.f] = v;
        persist();
        recalc();
      });
    });
  }

  /* ================= ENGINE CALLS ================= */
  function engineInputs(platform) {
    const p = state[platform];
    const inp = {
      budget: p.budget, days: p.days, target: p.target, cvr: p.cvr,
      ctr: p.ctr, objective: state.objective, aov: p.aov
    };
    if (platform === 'google') inp.cpc = p.cpc;
    else {
      inp.cpm = p.cpm;
      inp.frequency = (p.freqEnabled && Number.isFinite(parseFloat(p.frequency))) ? parseFloat(p.frequency) : null;
    }
    return inp;
  }
  function runEngines() {
    return {
      google: AdCalc.calculate('google', engineInputs('google')),
      meta: AdCalc.calculate('meta', engineInputs('meta')),
    };
  }
  function runScenarios() {
    const p = state.platform, inp = engineInputs(p);
    const out = {};
    Object.keys(state.scenarios).forEach(k => {
      out[k] = AdCalc.scenario(p, inp, state.scenarios[k]);
    });
    return out;
  }

  const convWord = () => state.objective === 'sales' ? 'Sales' : 'Leads';
  const convWordL = () => state.objective === 'sales' ? 'sales' : 'leads';
  const costMetricLabel = () => state.platform === 'meta' ? 'CPM' : 'CPC';

  /* ================= KPI CARDS (with count-up animation) ================= */
  const kpiPrev = {};
  const FMT = {
    inr0: v => fmtINR(v, 0), inr2: v => fmtINR(v, 2),
    num: v => fmtNum(v), num1: v => fmtNum(v, 1)
  };
  function animateKPIs(root) {
    root.querySelectorAll('[data-anim]').forEach(el => {
      const id = el.dataset.anim, to = parseFloat(el.dataset.raw), fmtFn = FMT[el.dataset.fmt] || FMT.num;
      if (!Number.isFinite(to)) return;
      const booting = document.body.classList.contains('booting');
      const from = kpiPrev[id] !== undefined ? kpiPrev[id] : (booting ? 0 : to);
      kpiPrev[id] = to;
      if (from === to || typeof requestAnimationFrame !== 'function') { el.textContent = fmtFn(to); return; }
      if (el._raf) cancelAnimationFrame(el._raf);
      const t0 = performance.now(), dur = 480;
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
        el.textContent = fmtFn(from + (to - from) * e);
        if (p < 1) el._raf = requestAnimationFrame(tick);
      };
      el._raf = requestAnimationFrame(tick);
    });
  }

  function renderKPIs(r) {
    const grid = $('#kpiGrid');
    const isSales = state.objective === 'sales';
    const cards = [
      { id: 'budget', label: '💰 Total Ad Budget', raw: r.budget, fmt: 'inr0', sub: `for <b>${r.days} days</b> · weekly <b>${cell(fmtINR(r.weeklyBudget, 0))}</b>`, color: 'var(--primary)' },
      { id: 'impr', label: '👁️ Est. Impressions', raw: r.impressions, fmt: 'num', sub: `daily <b>${cell(fmtNum(r.dailyImpressions))}</b>${r.reach !== null ? ` · reach <b>${fmtNum(r.reach)}</b>` : ''}`, color: '#8b5cf6' },
      { id: 'clicks', label: '🖱️ Est. Clicks', raw: r.clicks, fmt: 'num', sub: `CTR <b>${cell(fmtPct(r.ctr, 2))}</b> · CPC <b>${cell(fmtINR(state.platform === 'meta' ? r.cpc : r.cpc ?? state.google.cpc, 2))}</b>`, color: '#0ea5e9' },
      { id: 'conv', label: isSales ? '🛒 Est. Sales' : '🎯 Est. Leads', raw: r.conversions, fmt: 'num1', sub: `daily <b>${cell(fmtNum(r.dailyConversions, 1))}</b> · CVR <b>${cell(fmtPct(r.cvr, 2))}</b>`, color: 'var(--accent)' },
      { id: 'cpl', label: isSales ? '🧾 Expected CPA' : '🧾 Expected CPL', raw: r.cplCpa, fmt: 'inr2', sub: r.cplCpa !== null && r.conversions > 0 ? `per ${isSales ? 'purchase' : 'lead'}` : 'needs conversions > 0', color: '#f59e0b' },
      { id: 'daily', label: '📅 Daily Budget', raw: r.dailyBudget, fmt: 'inr2', sub: `monthly run-rate <b>${fmtINR(r.monthlyBudget, 0)}</b>`, color: '#14b8a6' },
      { id: 'addl', label: '➕ Additional Budget Req.', raw: r.additionalBudget, fmt: 'inr0', sub: r.additionalBudget === null ? 'set CVR & target' : (r.additionalBudget > 0 ? `to hit <b>${fmtNum(r.target)}</b> ${convWordL()}` : '✅ target achievable within budget'), color: r.additionalBudget > 0 ? 'var(--danger)' : 'var(--accent)', cls: r.additionalBudget > 0 ? 'bad' : 'good' }
    ];
    if (isSales) {
      cards.push({ id: 'rev', label: '📈 Est. Revenue & ROAS', raw: r.revenue, fmt: 'inr0', sub: `ROAS <b>${cell(fmtX(r.roas))}</b> · AOV <b>${fmtINR(r.aov, 0)}</b>`, color: '#ec4899' });
    }
    grid.innerHTML = cards.map((c, i) => {
      const v = (c.raw === null || c.raw === undefined)
        ? '<span class="na">N/A</span>'
        : `<span data-anim="${c.id}" data-raw="${c.raw}" data-fmt="${c.fmt}">${FMT[c.fmt](c.raw)}</span>`;
      return `
      <div class="kpi ${c.cls || ''}" style="--kpi-color:${c.color};--i:${i}">
        <span class="shine"></span>
        <div class="kpi-label">${c.label}</div>
        <div class="kpi-value">${v}</div>
        <div class="kpi-sub">${c.sub}</div>
      </div>`;
    }).join('');
    animateKPIs(grid);
  }

  /* ================= TARGET STRIP ================= */
  function renderTarget(r) {
    const gapCls = r.gap === null ? '' : (r.gap >= 0 ? 'pos' : 'neg');
    const gapTxt = r.gap === null ? null : (r.gap >= 0 ? '+' + fmtNum(r.gap, 1) : fmtNum(r.gap, 1));
    $('#targetStrip').innerHTML = `
      <div class="t-chip"><span class="t-l">Target ${convWord()}</span><span class="t-v">${fmtNum(r.target)}</span></div>
      <div class="t-chip"><span class="t-l">Forecast ${convWord()}</span><span class="t-v">${cell(fmtNum(r.conversions, 1))}</span></div>
      <div class="t-chip ${gapCls}"><span class="t-l">${convWord()} Gap</span><span class="t-v">${cell(gapTxt)}</span></div>
      <div class="t-chip"><span class="t-l">Required Clicks</span><span class="t-v">${cell(fmtNum(r.requiredClicks))}</span></div>
      <div class="t-chip"><span class="t-l">Required Budget</span><span class="t-v">${cell(fmtINR(r.requiredBudget, 0))}</span></div>
      <div class="t-chip"><span class="t-l">Budget Utilisation*</span><span class="t-v">${cell(fmtPct(r.budgetUtilisation, 1))}</span></div>
      <div class="t-chip" style="flex:2"><span class="t-l">*Utilisation = current budget as % of budget required to hit target (capped at 100%)</span></div>`;
  }

  /* ================= PERFORMANCE MATRIX ================= */
  function kvRow(label, value, tag) {
    return `<tr><td>${label}${tag === 'act' ? '<span class="tag-act">ACTUAL</span>' : '<span class="tag-est">EST</span>'}</td><td>${value === null || value === undefined ? '<span class="na">N/A</span>' : value}</td></tr>`;
  }
  function renderMatrix(r) {
    const isSales = state.objective === 'sales';
    const p = state[state.platform];
    const blocks = [];

    blocks.push(`<div class="matrix-block"><h3>📥 Actual Inputs (${state.platform === 'google' ? 'Google Ads' : 'Meta Ads'})</h3><table class="kv">
      ${kvRow('Total Budget', fmtINR(p.budget, 0), 'act')}
      ${kvRow('Campaign Duration', fmtNum(p.days, 0) + ' days', 'act')}
      ${state.platform === 'google' ? kvRow('Average CPC', fmtINR(p.cpc, 2), 'act') : kvRow('Average CPM', fmtINR(p.cpm, 2), 'act')}
      ${kvRow('Expected CTR', fmtPct(p.ctr, 2), 'act')}
      ${kvRow('Conversion Rate', fmtPct(p.cvr, 2), 'act')}
      ${kvRow(isSales ? 'Target Sales' : 'Target Leads', fmtNum(p.target, 0), 'act')}
      ${isSales ? kvRow('Average Order Value', fmtINR(p.aov, 0), 'act') : ''}
      ${state.platform === 'meta' && r.frequency !== null ? kvRow('Frequency (provided)', fmtNum(r.frequency, 1), 'act') : ''}
    </table></div>`);

    blocks.push(`<div class="matrix-block"><h3>💰 Budget Metrics</h3><table class="kv">
      ${kvRow('Total Budget', fmtINR(r.budget, 0))}
      ${kvRow('Daily Budget', fmtINR(r.dailyBudget, 2))}
      ${kvRow('Weekly Budget', fmtINR(r.weeklyBudget, 2))}
      ${kvRow('Monthly Budget (30-day run-rate)', fmtINR(r.monthlyBudget, 0))}
      ${kvRow('Budget Utilisation (% of required)', fmtPct(r.budgetUtilisation, 1))}
    </table></div>`);

    blocks.push(`<div class="matrix-block"><h3>🚦 Traffic Metrics</h3><table class="kv">
      ${kvRow('Impressions', fmtNum(r.impressions))}
      ${kvRow('Daily Impressions', fmtNum(r.dailyImpressions))}
      ${kvRow('Reach', fmtNum(r.reach))}
      ${kvRow('Frequency', r.frequency !== null ? fmtNum(r.frequency, 1) : null)}
      ${kvRow('Clicks', fmtNum(r.clicks))}
      ${kvRow('Daily Clicks', fmtNum(r.dailyClicks, 1))}
      ${kvRow('CTR', fmtPct(r.ctr, 2))}
      ${kvRow('CPC', fmtINR(state.platform === 'meta' ? r.cpc : r.cpc ?? state.google.cpc, 2))}
      ${kvRow('CPM', fmtINR(state.platform === 'google' ? r.cpm : p.cpm, 2))}
    </table></div>`);

    blocks.push(`<div class="matrix-block"><h3>🎯 Conversion Metrics</h3><table class="kv">
      ${isSales ? kvRow('Sales (Purchases)', fmtNum(r.conversions, 1)) : kvRow('Leads', fmtNum(r.conversions, 1))}
      ${kvRow('Daily ' + convWord(), fmtNum(r.dailyConversions, 1))}
      ${kvRow('Conversion Rate', fmtPct(r.cvr, 2))}
      ${kvRow(isSales ? 'CPA (Cost / Sale)' : 'CPL (Cost / Lead)', fmtINR(r.cplCpa, 2))}
    </table></div>`);

    blocks.push(`<div class="matrix-block"><h3>🏁 Target Metrics</h3><table class="kv">
      ${kvRow(isSales ? 'Target Sales' : 'Target Leads', fmtNum(r.target, 0))}
      ${kvRow(isSales ? 'Forecast Sales' : 'Forecast Leads', fmtNum(r.conversions, 1))}
      ${kvRow(isSales ? 'Sales Gap' : 'Lead Gap', r.gap === null ? null : (r.gap >= 0 ? '+' : '') + fmtNum(r.gap, 1))}
      ${kvRow('Required Clicks', fmtNum(r.requiredClicks))}
      ${state.platform === 'meta' ? kvRow('Required Impressions', fmtNum(r.requiredImpressions)) : ''}
      ${kvRow('Required Budget', fmtINR(r.requiredBudget, 0))}
      ${kvRow('Additional Budget Required', fmtINR(r.additionalBudget, 0))}
    </table></div>`);

    if (isSales) {
      blocks.push(`<div class="matrix-block"><h3>💵 Revenue Metrics</h3><table class="kv">
        ${kvRow('Average Order Value', fmtINR(r.aov, 0))}
        ${kvRow('Estimated Revenue', fmtINR(r.revenue, 0))}
        ${kvRow('ROAS', fmtX(r.roas))}
        ${kvRow('Revenue per Click', fmtINR(r.revenuePerClick, 2))}
      </table></div>`);
    }
    $('#matrixWrap').innerHTML = blocks.join('');
    $('#matrixBadge').textContent = `${state.platform === 'google' ? 'GOOGLE ADS' : 'META ADS'} · ${isSales ? 'SALES' : 'LEADS'} · FORECAST`;
  }

  /* ================= SCENARIO TABLE ================= */
  function renderScenarioTable(sc) {
    const isSales = state.objective === 'sales';
    const keys = [
      ['conservative', 'Conservative 🐢', 'scen-cons'],
      ['expected', 'Expected ⚖️', 'scen-exp'],
      ['optimistic', 'Optimistic 🚀', 'scen-opt']
    ];
    const rows = [
      ['CVR applied', k => fmtPct(sc[k].cvr, 2)],
      [costMetricLabel() + ' applied', k => fmtINR(state.platform === 'meta' ? sc[k].budget > 0 && sc[k].impressions > 0 ? (sc[k].budget / sc[k].impressions) * 1000 : null : sc[k].cpc ?? state.google.cpc * (sc[k].costFactor || 1), 2)],
      ['Effective CPC', k => fmtINR(sc[k].platform === 'meta' ? sc[k].cpc : state.google.cpc * (sc[k].costFactor || 1), 2)],
      ['Estimated Clicks', k => fmtNum(sc[k].clicks)],
      ['Estimated Impressions', k => fmtNum(sc[k].impressions)],
      [isSales ? 'Estimated Sales' : 'Estimated Leads', k => fmtNum(sc[k].conversions, 1)],
      [isSales ? 'CPA' : 'CPL', k => fmtINR(sc[k].cplCpa, 2)],
      ['Required Budget (target)', k => fmtINR(sc[k].requiredBudget, 0)],
      ['Additional Budget', k => fmtINR(sc[k].additionalBudget, 0)],
      [isSales ? 'Est. Revenue' : 'Target coverage', k => isSales ? fmtINR(sc[k].revenue, 0) : fmtPct(sc[k].target > 0 && sc[k].conversions !== null ? (sc[k].conversions / sc[k].target) * 100 : null, 1)]
    ];
    let html = `<thead><tr><th>Metric</th>${keys.map(k => `<th style="color:inherit">${k[1]}</th>`).join('')}</tr></thead><tbody>`;
    rows.forEach(([label, fn]) => {
      html += `<tr><td>${label}</td>${keys.map(k => {
        const v = fn(k[0]);
        return `<td class="num ${k[2]}">${v === null ? '<span class="na">N/A</span>' : v}</td>`;
      }).join('')}</tr>`;
    });
    html += '</tbody>';
    $('#scenarioTable').innerHTML = html;
  }

  /* ================= CHARTS ================= */
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function chartTheme() {
    return { grid: cssVar('--border'), text: cssVar('--text-2'), card: cssVar('--card') };
  }
  function applyChartTheme() {
    const t = chartTheme();
    Chart.defaults.color = t.text;
    Chart.defaults.borderColor = t.grid;
    Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
    Object.values(charts).forEach(c => { if (c) { styleScales(c, t); c.update('none'); } });
  }
  function styleScales(c, t) {
    if (!c.options.scales) return;
    Object.values(c.options.scales).forEach(s => {
      if (s.grid) s.grid.color = t.grid;
      if (s.ticks) s.ticks.color = t.text;
      if (s.border) s.border.color = t.grid;
    });
  }
  function baseOpts(extra) {
    const t = chartTheme();
    return Object.assign({
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 380 },
      plugins: {
        legend: { labels: { boxWidth: 12, boxHeight: 12, borderRadius: 3, useBorderRadius: true, color: t.text, font: { size: 11, weight: '600' } } },
        tooltip: {
          backgroundColor: cssVar('--text') === '#101828' ? 'rgba(16,24,40,.92)' : 'rgba(18,25,49,.92)',
          titleFont: { size: 12, weight: '700' }, bodyFont: { size: 12 }, padding: 10, cornerRadius: 8,
          callbacks: {}
        }
      }
    }, extra || {});
  }
  const C = { blue: '#4353ff', green: '#0ea472', orange: '#f59e0b', purple: '#8b5cf6', pink: '#ec4899', red: '#e5484d', teal: '#14b8a6' };

  function ensureCharts() {
    if (charts.budgetConv) return;
    charts.budgetConv = new Chart($('#chartBudgetConv'), { type: 'bar', data: { labels: [], datasets: [] }, options: baseOpts({ scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } }) });
    charts.cpcConv = new Chart($('#chartCpcConv'), { type: 'line', data: { labels: [], datasets: [] }, options: baseOpts({ scales: { x: { grid: { display: false } }, y: { beginAtZero: true } }, plugins: { legend: { display: false } } }) });
    charts.daily = new Chart($('#chartDaily'), { type: 'line', data: { labels: [], datasets: [] }, options: baseOpts({ interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, position: 'left' }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } } }) });
    charts.dist = new Chart($('#chartDistribution'), { type: 'doughnut', data: { labels: [], datasets: [] }, options: baseOpts({ cutout: '62%', scales: {} }) });
    charts.platform = new Chart($('#chartPlatform'), { type: 'bar', data: { labels: [], datasets: [] }, options: baseOpts({ scales: { x: { grid: { display: false } }, y: { type: 'logarithmic', beginAtZero: false } } }) });
    applyChartTheme();
  }

  function updateCharts(r, gRes, mRes) {
    ensureCharts();
    const conv = convWord();

    /* --- 1. Budget vs Conversions (50%–150% of budget) --- */
    const budgetSteps = [0.5, 0.75, 1, 1.25, 1.5];
    const bLabels = budgetSteps.map(s => fmtINR(r.budget * s, 0));
    const bData = budgetSteps.map(s => {
      const rr = AdCalc.calculate(state.platform, Object.assign(engineInputs(state.platform), { budget: r.budget * s }));
      return rr.conversions !== null ? +rr.conversions.toFixed(1) : null;
    });
    charts.budgetConv.data.labels = bLabels;
    charts.budgetConv.data.datasets = [{
      label: `Forecast ${conv}`, data: bData,
      backgroundColor: budgetSteps.map(s => s === 1 ? C.blue : cssVar('--primary') + '55'),
      borderRadius: 8, maxBarThickness: 56
    }];
    charts.budgetConv.update();

    /* --- 2. CPC (cost driver) vs Conversions --- */
    const costSteps = [0.5, 0.7, 0.85, 1, 1.2, 1.5, 2];
    const cLabels = [], cData = [];
    costSteps.forEach(s => {
      const inp = engineInputs(state.platform);
      if (state.platform === 'google') inp.cpc = AdCalc.safeNum(inp.cpc) * s;
      else inp.cpm = AdCalc.safeNum(inp.cpm) * s;
      const rr = AdCalc.calculate(state.platform, inp);
      const effCpc = state.platform === 'google' ? inp.cpc : rr.cpc;
      cLabels.push(effCpc !== null && Number.isFinite(effCpc) ? '₹' + nf(1).format(effCpc) : '—');
      cData.push(rr.conversions !== null ? +rr.conversions.toFixed(1) : null);
    });
    $('#chart2Title').innerHTML = (state.platform === 'meta' ? 'Effective CPC (via CPM) vs ' : 'CPC vs ') + `<span class="conv-word">${conv}</span>`;
    // vertical gradient fill (guarded — stubs/jsdom have no ctx)
    let lineFill = C.purple + '22';
    try {
      const cx = charts.cpcConv.ctx;
      if (cx && cx.createLinearGradient) {
        const g0 = cx.createLinearGradient(0, 0, 0, 280);
        g0.addColorStop(0, C.purple + '55'); g0.addColorStop(1, C.purple + '00');
        lineFill = g0;
      }
    } catch (e) { /* keep flat color */ }
    charts.cpcConv.data.labels = cLabels;
    charts.cpcConv.data.datasets = [{
      label: `Forecast ${conv}`, data: cData,
      borderColor: C.purple, backgroundColor: lineFill, fill: true,
      tension: .35, pointRadius: 4, pointBackgroundColor: C.purple,
      pointBorderColor: chartTheme().card, pointBorderWidth: 2, pointHoverRadius: 6, borderWidth: 2.5
    }];
    charts.cpcConv.update();

    /* --- 3. Daily Performance Forecast --- */
    const days = r.days;
    const step = Math.max(1, Math.ceil(days / 45));
    const dLabels = [], dConv = [], dClicks = [], dCum = [];
    for (let d = step; d <= days; d += step) {
      dLabels.push('Day ' + d);
      dConv.push(r.dailyConversions !== null ? +(r.dailyConversions).toFixed(1) : null);
      dClicks.push(r.dailyClicks !== null ? +(r.dailyClicks).toFixed(1) : null);
      dCum.push(r.dailyConversions !== null ? +(r.dailyConversions * d).toFixed(1) : null);
    }
    if (dLabels[dLabels.length - 1] !== 'Day ' + days && days > 1) {
      dLabels.push('Day ' + days);
      dConv.push(r.dailyConversions !== null ? +r.dailyConversions.toFixed(1) : null);
      dClicks.push(r.dailyClicks !== null ? +r.dailyClicks.toFixed(1) : null);
      dCum.push(r.conversions !== null ? +r.conversions.toFixed(1) : null);
    }
    charts.daily.data.labels = dLabels;
    charts.daily.data.datasets = [
      { label: `Daily ${conv}`, data: dConv, borderColor: C.green, backgroundColor: C.green, tension: .3, pointRadius: 2.5, borderWidth: 2, yAxisID: 'y' },
      { label: `Cumulative ${conv}`, data: dCum, borderColor: C.blue, backgroundColor: C.blue + '18', fill: true, tension: .3, pointRadius: 2.5, borderWidth: 2.5, yAxisID: 'y' },
      { label: 'Daily Clicks', data: dClicks, borderColor: C.orange, backgroundColor: C.orange, borderDash: [5, 4], tension: .3, pointRadius: 2, borderWidth: 2, yAxisID: 'y1' }
    ];
    charts.daily.options.scales.y.title = { display: true, text: conv, color: chartTheme().text, font: { size: 11, weight: '700' } };
    charts.daily.options.scales.y1.title = { display: true, text: 'Clicks', color: chartTheme().text, font: { size: 11, weight: '700' } };
    charts.daily.update();

    /* --- 4. Budget Distribution doughnut --- */
    const req = r.requiredBudget;
    let dLabels2, dData, dColors;
    if (req === null) {
      dLabels2 = ['Allocated Budget']; dData = [r.budget]; dColors = [C.blue];
    } else {
      const toTarget = Math.min(r.budget, req);
      const additional = r.additionalBudget || 0;
      const surplus = Math.max(0, r.budget - req);
      dLabels2 = [`Spend needed for target`, 'Additional budget required', 'Surplus above target'];
      dData = [+toTarget.toFixed(0), +additional.toFixed(0), +surplus.toFixed(0)];
      dColors = [C.blue, C.red, C.green];
      const keep = dData.map((v, i) => v > 0 || i === 0);
      dLabels2 = dLabels2.filter((_, i) => keep[i]); dData = dData.filter((_, i) => keep[i]); dColors = dColors.filter((_, i) => keep[i]);
    }
    charts.dist.data.labels = dLabels2;
    charts.dist.data.datasets = [{ data: dData, backgroundColor: dColors, borderWidth: 2, borderColor: chartTheme().card, hoverOffset: 8 }];
    charts.dist.options.plugins.tooltip.callbacks = { label: (ctx) => ` ${ctx.label}: ${fmtINR(ctx.parsed, 0)}` };
    charts.dist.update();

    /* --- 5. Google vs Meta comparison --- */
    charts.platform.data.labels = ['Impressions', 'Clicks', conv, (state.objective === 'sales' ? 'CPA' : 'CPL') + ' (₹)', 'CPM (₹)'];
    const gImp = gRes.impressions, mImp = mRes.impressions;
    const gCpm = gRes.cpm, mCpm = mRes.platform === 'meta' ? state.meta.cpm : null;
    charts.platform.data.datasets = [
      {
        label: 'Google Ads', borderRadius: 6, maxBarThickness: 38, backgroundColor: '#4285F4',
        data: [gImp, gRes.clicks, gRes.conversions, gRes.cplCpa, gCpm].map(v => v !== null && v > 0 ? +v.toFixed(1) : null)
      },
      {
        label: 'Meta Ads', borderRadius: 6, maxBarThickness: 38, backgroundColor: '#1877F2',
        data: [mImp, mRes.clicks, mRes.conversions, mRes.cplCpa, mCpm].map(v => v !== null && v > 0 ? +v.toFixed(1) : null)
      }
    ];
    charts.platform.options.plugins.tooltip.callbacks = {
      label: (ctx) => {
        const v = ctx.parsed.y;
        if (v === null) return ` ${ctx.dataset.label}: N/A`;
        const isMoney = ctx.dataIndex >= 3;
        return ` ${ctx.dataset.label}: ${isMoney ? fmtINR(v, 2) : fmtNum(v, 1)}`;
      }
    };
    charts.platform.update();
  }

  /* ================= SAVED SCENARIOS ================= */
  function loadSaved() { try { return JSON.parse(localStorage.getItem(LS_SAVED)) || []; } catch (e) { return []; } }
  function storeSaved(arr) { try { localStorage.setItem(LS_SAVED, JSON.stringify(arr)); } catch (e) {} }

  function snapshot(r) {
    return {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      date: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      platform: state.platform, objective: state.objective,
      inputs: JSON.parse(JSON.stringify(engineInputs(state.platform))),
      outputs: {
        budget: r.budget, impressions: r.impressions, clicks: r.clicks, conversions: r.conversions,
        cplCpa: r.cplCpa, cpc: state.platform === 'meta' ? r.cpc : state.google.cpc,
        ctr: r.ctr, cvr: r.cvr, target: r.target, requiredClicks: r.requiredClicks,
        requiredBudget: r.requiredBudget, additionalBudget: r.additionalBudget,
        revenue: r.revenue, roas: r.roas, days: r.days
      }
    };
  }

  function renderSaved() {
    const arr = loadSaved();
    const list = $('#savedList');
    if (!arr.length) { list.innerHTML = '<div class="empty-note">No saved scenarios yet. Configure inputs and click Save.</div>'; $('#compareWrap').hidden = true; return; }
    list.innerHTML = arr.map(s => `
      <div class="saved-item" data-id="${s.id}">
        <span class="s-name">${escapeHtml(s.name)}</span>
        <span class="s-meta">${s.platform === 'google' ? 'Google' : 'Meta'} · ${s.objective} · ${fmtNum(s.outputs.conversions, 0) ?? 'N/A'} ${s.objective === 'sales' ? 'sales' : 'leads'}</span>
        <button class="btn btn-xs s-load" title="Load inputs">↩</button>
        <button class="btn btn-xs btn-danger s-del" title="Delete">✕</button>
      </div>`).join('');
    list.querySelectorAll('.s-del').forEach(b => b.addEventListener('click', (e) => {
      const id = e.target.closest('.saved-item').dataset.id;
      storeSaved(loadSaved().filter(s => s.id !== id));
      renderSaved(); toast('Scenario deleted');
    }));
    list.querySelectorAll('.s-load').forEach(b => b.addEventListener('click', (e) => {
      const id = e.target.closest('.saved-item').dataset.id;
      const s = loadSaved().find(x => x.id === id);
      if (!s) return;
      state.platform = s.platform; state.objective = s.objective;
      Object.assign(state[s.platform], s.inputs);
      syncSegmented(); renderFields(); updateConvWords(); persist(); recalc();
      toast(`Loaded "${s.name}"`);
    }));
    renderCompare(arr);
  }

  function renderCompare(arr) {
    if (arr.length < 1) { $('#compareWrap').hidden = true; return; }
    $('#compareWrap').hidden = false;
    const isSalesAny = arr.some(s => s.objective === 'sales');
    const rows = [
      ['Platform', s => s.platform === 'google' ? 'Google' : 'Meta'],
      ['Objective', s => s.objective === 'sales' ? 'Sales' : 'Leads'],
      ['Budget', s => fmtINR(s.outputs.budget, 0)],
      ['Days', s => fmtNum(s.outputs.days, 0)],
      ['CPC', s => fmtINR(s.outputs.cpc, 2)],
      ['CTR', s => fmtPct(s.outputs.ctr, 2)],
      ['CVR', s => fmtPct(s.outputs.cvr, 2)],
      ['Clicks', s => fmtNum(s.outputs.clicks)],
      ['Impressions', s => fmtNum(s.outputs.impressions)],
      ['Leads / Sales', s => fmtNum(s.outputs.conversions, 1)],
      ['CPL / CPA', s => fmtINR(s.outputs.cplCpa, 2)],
      ['Target', s => fmtNum(s.outputs.target, 0)],
      ['Required Budget', s => fmtINR(s.outputs.requiredBudget, 0)],
      ['Additional Budget', s => fmtINR(s.outputs.additionalBudget, 0)],
      ['Revenue', s => s.objective === 'sales' ? fmtINR(s.outputs.revenue, 0) : '—'],
      ['ROAS', s => s.objective === 'sales' ? fmtX(s.outputs.roas) : '—'],
      ['Saved', s => s.date]
    ];
    let html = `<thead><tr><th>Metric</th>${arr.map(s => `<th>${escapeHtml(s.name)}</th>`).join('')}</tr></thead><tbody>`;
    rows.forEach(([label, fn]) => {
      html += `<tr><td>${label}</td>${arr.map(s => `<td class="num">${fn(s) ?? '<span class="na">N/A</span>'}</td>`).join('')}</tr>`;
    });
    html += '</tbody>';
    $('#compareTable').innerHTML = html;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ================= MASTER RECALC ================= */
  function recalc() {
    const { google: gRes, meta: mRes } = runEngines();
    const r = state.platform === 'google' ? gRes : mRes;
    const sc = runScenarios();
    renderKPIs(r);
    renderTarget(r);
    renderMatrix(r);
    renderScenarioTable(sc);
    updateCharts(r, gRes, mRes);
    lastResults = { r, gRes, mRes, sc };
  }
  let lastResults = null;

  function updateConvWords() {
    $$('.conv-word').forEach(el => el.textContent = convWord());
    $('#objectiveNote').textContent = state.objective === 'sales'
      ? 'Sales mode: purchases, CPA, AOV, revenue & ROAS are calculated. Lead metrics are not mixed in.'
      : 'Leads mode: leads, CPL & conversion metrics are calculated. Revenue/ROAS metrics are not mixed in.';
  }

  function syncSegmented() {
    $$('#objectiveSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.value === state.objective));
    $$('#platformSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.value === state.platform));
    $$('.segmented').forEach(movePill);
  }

  /* ================= PREMIUM EFFECTS ================= */
  // Sliding pill indicator inside segmented controls
  function ensurePills() {
    $$('.segmented').forEach(seg => {
      if (!seg.querySelector('.seg-pill')) {
        const p = document.createElement('span');
        p.className = 'seg-pill';
        seg.insertBefore(p, seg.firstChild);
      }
      movePill(seg);
    });
  }
  function movePill(seg) {
    const active = seg.querySelector('.seg-btn.active');
    const pill = seg.querySelector('.seg-pill');
    if (!active || !pill) return;
    pill.style.width = active.offsetWidth + 'px';
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  // Ripple effect on all buttons
  function wireRipple() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('.btn, .seg-btn, .icon-btn');
      if (!b) return;
      const rect = b.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      const rp = document.createElement('span');
      rp.className = 'ripple';
      rp.style.width = rp.style.height = size + 'px';
      rp.style.left = (e.clientX - rect.left - size / 2) + 'px';
      rp.style.top = (e.clientY - rect.top - size / 2) + 'px';
      b.appendChild(rp);
      setTimeout(() => rp.remove(), 650);
    });
  }

  // Scroll-reveal for cards (staggered)
  function wireReveal() {
    const els = $$('.layout .card, .kpi-grid, .target-strip, .seg-group');
    els.forEach((el, i) => { el.classList.add('reveal'); el.style.setProperty('--d', ((i % 9) * 55) + 'ms'); });
    if (!('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: .05, rootMargin: '0px 0px -20px 0px' });
    els.forEach(el => io.observe(el));
  }

  // Boot animation flag (drives one-time KPI pop-in & count-up from zero)
  function startBootSequence() {
    document.body.classList.add('booting');
    setTimeout(() => document.body.classList.remove('booting'), 1500);
  }

  /* ================= EXPORT DATA ================= */
  function exportRows() {
    const { r, sc } = lastResults;
    const isSales = state.objective === 'sales';
    const plat = state.platform === 'google' ? 'Google Ads' : 'Meta Ads';
    const rows = [];
    rows.push(['AdForecast Pro — Performance Report']);
    rows.push([`Platform: ${plat}`, `Objective: ${isSales ? 'Sales' : 'Leads'}`, `Generated: ${new Date().toLocaleString('en-IN')}`]);
    rows.push([]);
    rows.push(['SECTION', 'METRIC', 'VALUE']);
    const add = (sec, m, v) => rows.push([sec, m, v === null || v === undefined ? 'N/A' : v]);
    add('Actual Input', 'Total Budget (INR)', r.budget);
    add('Actual Input', 'Campaign Duration (days)', r.days);
    add('Actual Input', state.platform === 'google' ? 'Average CPC (INR)' : 'Average CPM (INR)', state.platform === 'google' ? state.google.cpc : state.meta.cpm);
    add('Actual Input', 'Expected CTR (%)', r.ctr);
    add('Actual Input', 'Conversion Rate (%)', r.cvr);
    add('Actual Input', isSales ? 'Target Sales' : 'Target Leads', r.target);
    if (isSales) add('Actual Input', 'Average Order Value (INR)', r.aov);
    if (r.frequency !== null) add('Actual Input', 'Frequency (provided)', r.frequency);
    add('Budget', 'Daily Budget (INR)', round(r.dailyBudget));
    add('Budget', 'Weekly Budget (INR)', round(r.weeklyBudget));
    add('Budget', 'Monthly Budget (INR)', round(r.monthlyBudget));
    add('Budget', 'Budget Utilisation (%)', round(r.budgetUtilisation));
    add('Traffic', 'Impressions', round(r.impressions));
    add('Traffic', 'Reach', round(r.reach));
    add('Traffic', 'Frequency', r.frequency);
    add('Traffic', 'Clicks', round(r.clicks));
    add('Traffic', 'CTR (%)', r.ctr);
    add('Traffic', 'CPC (INR)', round(state.platform === 'meta' ? r.cpc : state.google.cpc));
    add('Traffic', 'CPM (INR)', round(state.platform === 'google' ? r.cpm : state.meta.cpm));
    add('Conversion', isSales ? 'Sales' : 'Leads', round(r.conversions));
    add('Conversion', isSales ? 'CPA (INR)' : 'CPL (INR)', round(r.cplCpa));
    add('Target', 'Forecast ' + convWord(), round(r.conversions));
    add('Target', convWord() + ' Gap', round(r.gap));
    add('Target', 'Required Clicks', round(r.requiredClicks));
    add('Target', 'Required Budget (INR)', round(r.requiredBudget));
    add('Target', 'Additional Budget Required (INR)', round(r.additionalBudget));
    if (isSales) {
      add('Revenue', 'Estimated Revenue (INR)', round(r.revenue));
      add('Revenue', 'ROAS', round(r.roas));
      add('Revenue', 'Revenue per Click (INR)', round(r.revenuePerClick));
    }
    rows.push([]);
    rows.push(['SCENARIO', 'CVR %', 'Clicks', 'Impressions', isSales ? 'Sales' : 'Leads', isSales ? 'CPA (INR)' : 'CPL (INR)', 'Required Budget (INR)', 'Additional Budget (INR)']);
    Object.keys(sc).forEach(k => {
      const s = sc[k];
      rows.push([state.scenarios[k] ? state.scenarios[k].label : k, round(s.cvr), round(s.clicks), round(s.impressions), round(s.conversions), round(s.cplCpa), round(s.requiredBudget), round(s.additionalBudget)]);
    });
    return rows;
  }
  function round(v, d) { return v === null || v === undefined || !Number.isFinite(v) ? null : +v.toFixed(d === undefined ? 2 : d); }

  /* ================= EXPORTS ================= */
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportCSV() {
    const csv = exportRows().map(row => row.map(c => {
      const s = c === null || c === undefined ? 'N/A' : String(c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'adforecast-report.csv');
    toast('CSV exported');
  }
  function exportExcel() {
    const rows = exportRows();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 16 }, { wch: 34 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Performance Report');
    // Scenarios sheet
    const { sc } = lastResults;
    const srows = [['Scenario', 'CVR Applied %', 'Cost Factor %', 'Clicks', 'Impressions', convWord(), 'CPL/CPA (INR)', 'Required Budget (INR)', 'Additional Budget (INR)']];
    Object.keys(sc).forEach(k => {
      const s = sc[k];
      srows.push([state.scenarios[k].label, round(s.cvr), Math.round(s.costFactor * 100), round(s.clicks), round(s.impressions), round(s.conversions), round(s.cplCpa), round(s.requiredBudget), round(s.additionalBudget)]);
    });
    const ws2 = XLSX.utils.aoa_to_sheet(srows);
    ws2['!cols'] = srows[0].map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws2, 'Forecast Scenarios');
    // Saved scenarios sheet
    const saved = loadSaved();
    if (saved.length) {
      const srows2 = [['Name', 'Platform', 'Objective', 'Date', 'Budget', 'Clicks', 'Conversions', 'CPL/CPA', 'Required Budget', 'Additional Budget']];
      saved.forEach(s => srows2.push([s.name, s.platform, s.objective, s.date, round(s.outputs.budget), round(s.outputs.clicks), round(s.outputs.conversions), round(s.outputs.cplCpa), round(s.outputs.requiredBudget), round(s.outputs.additionalBudget)]));
      const ws3 = XLSX.utils.aoa_to_sheet(srows2);
      ws3['!cols'] = srows2[0].map(() => ({ wch: 18 }));
      XLSX.utils.book_append_sheet(wb, ws3, 'Saved Scenarios');
    }
    XLSX.writeFile(wb, 'adforecast-report.xlsx');
    toast('Excel exported');
  }
  function exportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const rows = exportRows();
    const W = doc.internal.pageSize.getWidth();
    // Header band
    doc.setFillColor(67, 83, 255);
    doc.rect(0, 0, W, 74, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('AdForecast Pro — Performance Report', 40, 32);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(rows[1].join('   |   '), 40, 54);
    doc.setTextColor(30, 30, 30);
    // Main table
    const body = rows.slice(3).filter(r0 => r0.length === 3 || r0[0] === 'SCENARIO');
    const main = [], scen = [];
    let inScen = false;
    rows.slice(4).forEach(r0 => {
      if (r0[0] === 'SCENARIO') { inScen = true; scen.push(r0); return; }
      if (!r0.length) return;
      (inScen ? scen : main).push(r0);
    });
    doc.autoTable({
      startY: 94,
      head: [main[0]], body: main.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [67, 83, 255], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      styles: { cellPadding: 4 },
      margin: { left: 40, right: 40 }
    });
    if (scen.length) {
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 22,
        head: [scen[0]], body: scen.slice(1),
        theme: 'striped',
        headStyles: { fillColor: [14, 164, 114], fontSize: 9 },
        bodyStyles: { fontSize: 9 },
        styles: { cellPadding: 4 },
        margin: { left: 40, right: 40 }
      });
    }
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(140);
      doc.text(`Generated by AdForecast Pro · ${new Date().toLocaleString('en-IN')} · Page ${i} of ${pages}`, 40, doc.internal.pageSize.getHeight() - 20);
    }
    doc.save('adforecast-report.pdf');
    toast('PDF exported');
  }

  /* ================= TOAST ================= */
  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  /* ================= EVENT WIRING ================= */
  function wire() {
    // Objective
    $$('#objectiveSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
      state.objective = b.dataset.value;
      syncSegmented(); updateConvWords(); renderFields(); persist(); recalc();
    }));
    // Platform
    $$('#platformSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
      state.platform = b.dataset.value;
      syncSegmented(); renderFields(); persist(); recalc();
    }));
    // Theme
    $('#btnTheme').addEventListener('click', () => {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = state.theme;
      persist(); applyChartTheme();
    });
    // Frequency toggle
    $('#freqToggle').addEventListener('change', (e) => {
      state.meta.freqEnabled = e.target.checked;
      if (e.target.checked && !Number.isFinite(parseFloat(state.meta.frequency))) state.meta.frequency = 2;
      $('#freqInner').firstChild.style.display = e.target.checked ? '' : 'none';
      syncField('frequency'); persist(); recalc();
    });
    // Reset
    $('#btnReset').addEventListener('click', () => {
      state = JSON.parse(JSON.stringify(DEFAULTS));
      document.documentElement.dataset.theme = state.theme;
      syncSegmented(); renderFields(); renderScenarioEditor(); updateConvWords(); persist(); recalc(); applyChartTheme();
      toast('Reset to defaults');
    });
    // Save scenario
    $('#btnSave').addEventListener('click', () => {
      const name = $('#saveName').value.trim() || `Scenario ${loadSaved().length + 1}`;
      const arr = loadSaved();
      arr.push(Object.assign({ name }, snapshot(lastResults.r)));
      storeSaved(arr);
      $('#saveName').value = '';
      renderSaved();
      toast(`Saved "${name}"`);
    });
    // Exports
    $('#btnPdf').addEventListener('click', exportPDF);
    $('#btnExcel').addEventListener('click', exportExcel);
    $('#btnCsv').addEventListener('click', exportCSV);
    // Keep segmented pills aligned on resize
    window.addEventListener('resize', () => $$('.segmented').forEach(movePill));
  }

  /* ================= INIT ================= */
  function init() {
    document.documentElement.dataset.theme = state.theme || 'light';
    startBootSequence();
    syncSegmented();
    updateConvWords();
    renderFields();
    renderScenarioEditor();
    renderSaved();
    wire();
    wireRipple();
    recalc();
    ensurePills();
    wireReveal();
    // Re-position pills after fonts/layout settle
    setTimeout(() => $$('.segmented').forEach(movePill), 120);
    setTimeout(() => $$('.segmented').forEach(movePill), 600);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
