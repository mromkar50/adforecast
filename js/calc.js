/* ============================================================
 * AdForecast Calculation Engine (pure logic — no UI, no DOM)
 * Works in browser (window.AdCalc) and Node (module.exports)
 * All formulas use full precision; rounding is done at display.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Validation helpers ---------- */
  // Safe number: finite, non-negative; anything else -> 0
  function safeNum(v) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  // Safe division — never divides by zero, returns null (=> N/A) instead
  function div(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
    return a / b;
  }
  // Percentage stored as 0–100; convert to fraction safely
  function pct(p) { return safeNum(p) / 100; }

  /* ---------- GOOGLE ADS ENGINE ----------
   * Inputs: budget(INR), cpc(INR), ctr(%), cvr(%), days, target,
   *         objective('leads'|'sales'), aov(INR, sales only)
   */
  function googleEngine(inp) {
    const budget = safeNum(inp.budget);
    const cpc = safeNum(inp.cpc);
    const ctr = pct(inp.ctr);
    const cvr = pct(inp.cvr);
    const days = Math.max(1, safeNum(inp.days) || 1);
    const target = safeNum(inp.target);
    const aov = safeNum(inp.aov);
    const objective = inp.objective === 'sales' ? 'sales' : 'leads';

    // Core funnel
    const clicks = div(budget, cpc);                          // Budget / CPC
    const impressions = clicks !== null && ctr > 0 ? clicks / ctr : null; // Clicks / CTR
    const conversions = clicks !== null ? clicks * cvr : null; // Clicks × CVR
    const cplCpa = (conversions !== null && conversions > 0) ? div(budget, conversions) : null;
    const cpm = (impressions !== null && impressions > 0) ? (budget / impressions) * 1000 : null;

    // Time distribution
    const dailyBudget = budget / days;
    const dailyClicks = clicks !== null ? clicks / days : null;
    const dailyImpressions = impressions !== null ? impressions / days : null;
    const dailyConversions = conversions !== null ? conversions / days : null;

    // Target-based (reverse) calculation
    const requiredClicks = cvr > 0 ? target / cvr : null;      // Target / CVR
    const requiredBudget = requiredClicks !== null ? requiredClicks * cpc : null;
    const additionalBudget = requiredBudget !== null ? Math.max(0, requiredBudget - budget) : null;
    const gap = conversions !== null ? conversions - target : null; // forecast - target (negative = shortfall)

    // Revenue (sales objective only — never mixed with leads)
    let revenue = null, roas = null, revenuePerClick = null;
    if (objective === 'sales') {
      revenue = conversions !== null ? conversions * aov : null;
      roas = (revenue !== null && budget > 0) ? revenue / budget : null;
      revenuePerClick = (revenue !== null && clicks !== null && clicks > 0) ? revenue / clicks : null;
    }

    // Reach/Frequency: not available for Google without extra inputs -> N/A
    const reach = null, frequency = null;

    const budgetUtilisation = requiredBudget !== null && requiredBudget > 0
      ? Math.min(100, (budget / requiredBudget) * 100) : null; // % of required budget covered

    return {
      platform: 'google', objective,
      budget, cpc, ctr: ctr * 100, cvr: cvr * 100, days, target, aov,
      clicks, impressions, conversions, cplCpa, cpm,
      dailyBudget, dailyClicks, dailyImpressions, dailyConversions,
      weeklyBudget: dailyBudget * 7, monthlyBudget: dailyBudget * 30,
      requiredClicks, requiredBudget, additionalBudget, gap, budgetUtilisation,
      revenue, roas, revenuePerClick, reach, frequency
    };
  }

  /* ---------- META ADS ENGINE ----------
   * Inputs: budget(INR), cpm(INR), ctr(%), cvr(%), days, target,
   *         objective, aov, frequency (optional, user-provided only)
   */
  function metaEngine(inp) {
    const budget = safeNum(inp.budget);
    const cpm = safeNum(inp.cpm);
    const ctr = pct(inp.ctr);
    const cvr = pct(inp.cvr);
    const days = Math.max(1, safeNum(inp.days) || 1);
    const target = safeNum(inp.target);
    const aov = safeNum(inp.aov);
    const freqIn = Number.isFinite(parseFloat(inp.frequency)) ? parseFloat(inp.frequency) : null;
    const objective = inp.objective === 'sales' ? 'sales' : 'leads';

    // Core funnel — Meta is impression-first (CPM bidding)
    const impressions = cpm > 0 ? (budget / cpm) * 1000 : null; // (Budget / CPM) × 1000
    const clicks = (impressions !== null) ? impressions * ctr : null; // Impressions × CTR
    const cpc = (clicks !== null && clicks > 0) ? div(budget, clicks) : null; // Budget / Clicks
    const conversions = clicks !== null ? clicks * cvr : null;
    const cplCpa = (conversions !== null && conversions > 0) ? div(budget, conversions) : null;

    // Reach & Frequency — ONLY when user provides frequency (never invented)
    const frequency = (freqIn !== null && freqIn >= 1) ? freqIn : null;
    const reach = (impressions !== null && frequency !== null) ? impressions / frequency : null;

    // Time distribution
    const dailyBudget = budget / days;
    const dailyImpressions = impressions !== null ? impressions / days : null;
    const dailyClicks = clicks !== null ? clicks / days : null;
    const dailyConversions = conversions !== null ? conversions / days : null;

    // Target-based (reverse) calculation
    const requiredConversions = target;
    const requiredClicks = cvr > 0 ? target / cvr : null;
    const requiredImpressions = (requiredClicks !== null && ctr > 0) ? requiredClicks / ctr : null;
    const requiredBudget = (requiredImpressions !== null && cpm > 0)
      ? (requiredImpressions / 1000) * cpm : null;
    const additionalBudget = requiredBudget !== null ? Math.max(0, requiredBudget - budget) : null;
    const gap = conversions !== null ? conversions - target : null;

    // Revenue (sales objective only)
    let revenue = null, roas = null, revenuePerClick = null;
    if (objective === 'sales') {
      revenue = conversions !== null ? conversions * aov : null;
      roas = (revenue !== null && budget > 0) ? revenue / budget : null;
      revenuePerClick = (revenue !== null && clicks !== null && clicks > 0) ? revenue / clicks : null;
    }

    const budgetUtilisation = requiredBudget !== null && requiredBudget > 0
      ? Math.min(100, (budget / requiredBudget) * 100) : null;

    return {
      platform: 'meta', objective,
      budget, cpm, ctr: ctr * 100, cvr: cvr * 100, days, target, aov,
      clicks, impressions, conversions, cplCpa, cpc,
      dailyBudget, dailyClicks, dailyImpressions, dailyConversions,
      weeklyBudget: dailyBudget * 7, monthlyBudget: dailyBudget * 30,
      requiredConversions, requiredClicks, requiredImpressions,
      requiredBudget, additionalBudget, gap, budgetUtilisation,
      revenue, roas, revenuePerClick, reach, frequency
    };
  }

  /* ---------- Router ---------- */
  function calculate(platform, inp) {
    return platform === 'meta' ? metaEngine(inp) : googleEngine(inp);
  }

  /* ---------- SCENARIO ENGINE ----------
   * Multipliers are user-customizable.
   *   cvrFactor: conversion-rate performance multiplier (e.g. 0.8 = conservative)
   *   costFactor: cost multiplier (e.g. 1.15 = CPC/CPM 15% higher)
   * Applied to the platform's live inputs; target math uses adjusted CVR/cost.
   */
  const DEFAULT_SCENARIOS = {
    conservative: { cvrFactor: 0.80, costFactor: 1.15, label: 'Conservative' },
    expected:     { cvrFactor: 1.00, costFactor: 1.00, label: 'Expected' },
    optimistic:   { cvrFactor: 1.25, costFactor: 0.90, label: 'Optimistic' }
  };

  function scenario(platform, inp, factors) {
    const f = Object.assign({ cvrFactor: 1, costFactor: 1 }, factors || {});
    const adj = Object.assign({}, inp, {
      cvr: safeNum(inp.cvr) * safeNum(f.cvrFactor || 1)
    });
    if (platform === 'meta') adj.cpm = safeNum(inp.cpm) * safeNum(f.costFactor || 1);
    else adj.cpc = safeNum(inp.cpc) * safeNum(f.costFactor || 1);
    const r = calculate(platform, adj);
    // Derived scenario CPC for Meta engine result
    const effCpc = platform === 'meta'
      ? r.cpc
      : safeNum(inp.cpc) * safeNum(f.costFactor || 1);
    return Object.assign({}, r, {
      effectiveCpc: effCpc,
      cvrFactor: f.cvrFactor, costFactor: f.costFactor
    });
  }

  return {
    safeNum, div, pct,
    googleEngine, metaEngine, calculate,
    scenario, DEFAULT_SCENARIOS
  };
});
