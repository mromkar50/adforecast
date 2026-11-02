# 📈 AdForecast Pro — Google Ads & Meta Ads Budget and Performance Forecasting Calculator

A fully client-side (no backend, no login) advertising forecasting SaaS-style app.
Built with **HTML + CSS + JavaScript + Chart.js + localStorage**. All vendor libraries are bundled locally in `/vendor` so the app works fully offline.

## Run
Any static server works:
```bash
cd ads-calculator
python3 -m http.server 8080
# open http://localhost:8080
```

## Features
| # | Feature | Implementation |
|---|---------|----------------|
| 1 | Objective selection (Leads / Sales) | Segmented toggle; engines never mix lead & sales metrics; Sales adds AOV, Revenue, ROAS, Revenue/Click |
| 2 | Platform selection (Google / Meta) | Separate engines: Google is click-first (Budget÷CPC), Meta is impression-first ((Budget÷CPM)×1000) |
| 3 | Inputs | Sliders + numeric fields, two-way synced; each platform keeps its own input set |
| 4–5 | Calculation engines | `js/calc.js` — pure functions, full precision, division-by-zero safe |
| 6 | Performance matrix | Budget / Traffic / Conversion / Target / Revenue blocks with ACTUAL vs EST tags |
| 7 | Target-based calculator | Required Clicks, Required Budget, Additional Budget, Gap — all dynamic |
| 8 | Forecast scenarios | Conservative / Expected / Optimistic with user-editable CVR & cost multipliers |
| 9 | Dashboard | 7–8 KPI cards + 5 auto-updating Chart.js charts (incl. Google vs Meta comparison) |
| 10 | Validation | No div-by-zero, negatives clamped, % bounds, N/A everywhere, en-IN formatting (₹1,00,000) |
| 11 | Export | PDF (jsPDF + autoTable), Excel (SheetJS, 3 sheets), CSV, save/compare scenarios (localStorage) |
| 12 | Design | Light/dark themes, responsive desktop→mobile, premium SaaS styling |
| 13 | Architecture | Calculation logic fully separated from UI (`calc.js` vs `app.js`) |
| 14 | Testing | `node tests/test.js` (44 engine tests) and `node tests/dom_test.js` (41 UI tests via jsdom) |

## Reach & Frequency policy
Reach/Frequency are **never invented**. They appear only for Meta, only when the user ticks
"I have reach / frequency data" and provides a real frequency (≥ 1). Otherwise the matrix shows **N/A**.

## Verified spec example (Google, Leads)
Budget ₹50,000 · CPC ₹25 · CTR 2% · CVR 5% · Target 200 →
Clicks **2,000** · Impressions **1,00,000** · Leads **100** · CPL **₹500** ·
Required Clicks **4,000** · Required Budget **₹1,00,000** · Additional Budget **₹50,000** ✅

## Files
```
index.html          App shell
css/styles.css      Themes + responsive layout
js/calc.js          Calculation engines (pure, testable in Node)
js/app.js           UI controller, charts, exports, storage
vendor/             Chart.js, jsPDF, jspdf-autotable, SheetJS (local copies)
tests/test.js       Engine test suite (44 assertions)
tests/dom_test.js   jsdom UI smoke-test suite (41 assertions)
```
