const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRuntime } = require('./apps-script-runtime.cjs');

console.log('Testing Forecast Supabase Integration & FC T11...');

const runtime = createRuntime();
const ctx = runtime.context;

// 1. Verify dtcFcSheetSortKey_
assert.equal(ctx.dtcFcSheetSortKey_('FC T1026'), 202610, 'FC T1026 should be sorted as 202610');
assert.equal(ctx.dtcFcSheetSortKey_('FC T1126'), 202611, 'FC T1126 should be sorted as 202611');
assert.equal(ctx.dtcFcSheetSortKey_('FC T10/26'), 202610, 'FC T10/26 should be sorted as 202610');
assert.equal(ctx.dtcFcSheetSortKey_('FC T11/26'), 202611, 'FC T11/26 should be sorted as 202611');
assert.equal(ctx.dtcFcSheetSortKey_('FC'), 0, 'Unversioned FC sheet key is 0');
console.log('PASS: dtcFcSheetSortKey_ correctly identifies both unseparated and separated month/year patterns.');

// 2. Verify FC T1126 parsed data integrity
const jsonPath = path.join(__dirname, 'forecast-t11-data.private.json');
assert.ok(fs.existsSync(jsonPath), 'forecast-t11-data.private.json must exist');
const records = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
assert.equal(records.length, 3900, 'Expected exactly 3,900 records (130 hubs * 30 days)');

const dates = new Set(records.map(r => r.plan_date));
assert.equal(dates.size, 30, 'Expected 30 unique dates for November');
assert.ok(dates.has('2026-11-01') && dates.has('2026-11-30') && dates.has('2026-11-19'), 'November dates range 1..30 must be present');

const hubs = new Set(records.map(r => r.hub_code));
assert.equal(hubs.size, 130, 'Expected 130 canonical hubs');
assert.ok(!records.some(r => !r.hub_code || !r.hub_name), 'Every record must have hub_code and hub_name');
assert.ok(!records.some(r => isNaN(r.fm_forecast) || isNaN(r.lm_forecast)), 'Forecast numbers must be valid');
console.log('PASS: FC T11 data has 3,900 valid records with 100% canonical hub mapping.');

// 3. Verify Supabase reader fallback and matrix conversion
const props = ctx.PropertiesService.getScriptProperties();
const supaRes = ctx.dtcAlertReadFcFromSupabase_(props, true);
assert.equal(supaRes, null, 'Without configured remote or when offline, returns null for graceful fallback');

// Test matrix conversion with synthetic response
const syntheticRows = [
  { plan_date: '2026-11-19', hub_code: 'HUB01', hub_name: 'Test Hub 1', fm_forecast: 100, lm_forecast: 200 },
  { plan_date: '2026-11-18', hub_code: 'HUB01', hub_name: 'Test Hub 1', fm_forecast: 150, lm_forecast: 250 }
];
const originalFetch = ctx.UrlFetchApp.fetch;
ctx.UrlFetchApp.fetch = () => ({
  getResponseCode: () => 200,
  getContentText: () => JSON.stringify(syntheticRows)
});

props.setProperty('SUPABASE_URL', 'https://mock.supabase.co');
props.setProperty('SUPABASE_KEY', 'sb_secret_mock');
const mockRes = ctx.dtcAlertReadFcFromSupabase_(props, true);
assert.ok(mockRes && mockRes.values && mockRes.values.length === 3, 'Matrix must have 2 header rows + 1 hub row');
assert.equal(mockRes.values[0][0], 'Hub Name');
assert.equal(mockRes.values[0][1], '2026-11-19');
assert.equal(mockRes.values[1][1], '#FM Forecast');
assert.equal(mockRes.values[1][2], '#LM Forecast');
assert.equal(mockRes.values[2][0], 'Test Hub 1');
assert.equal(mockRes.values[2][1], 100);
assert.equal(mockRes.values[2][2], 200);
console.log('PASS: dtcAlertReadFcFromSupabase_ converts Supabase rows to standard 2-row matrix format.');

// Restore fetch & props
ctx.UrlFetchApp.fetch = originalFetch;
props.deleteProperty('SUPABASE_URL');
props.deleteProperty('SUPABASE_KEY');

// 4. Verify buildForecastModel_ incorporates dates
const model = ctx.buildForecastModel_();
assert.ok(model.dates.length > 0, 'Model must include dates');
assert.ok(model.rows.length > 0, 'Model rows must be populated');
console.log(`PASS: buildForecastModel_ serves forecast (${model.dates.length} dates, ${model.rows.length} rows).`);

// 5. Verify SQL migration files exist and are valid
const migDir = path.join(__dirname, '..', 'supabase', 'migrations');
const schemaFile = path.join(migDir, '20261119010000_forecast_daily.sql');
const seedFile = path.join(migDir, '20261119010001_seed_forecast_daily_t11.sql');
assert.ok(fs.existsSync(schemaFile), 'Schema migration file must exist');
assert.ok(fs.existsSync(seedFile), 'Seed migration file must exist');

const schemaSql = fs.readFileSync(schemaFile, 'utf8');
assert.ok(schemaSql.includes('create table if not exists public.forecast_daily'), 'Must create forecast_daily table');
assert.ok(schemaSql.includes('create or replace view public.forecast_daily_summary'), 'Must create forecast_daily_summary view');
assert.ok(schemaSql.includes('create or replace view public.overview_hub_gap'), 'Must create overview_hub_gap view');
assert.ok(schemaSql.includes('create or replace view public.d0_operations_summary'), 'Must create d0_operations_summary view');
console.log('PASS: Supabase optimization migration defines forecast_daily, forecast_daily_summary, overview_hub_gap, and d0_operations_summary.');

console.log('\nALL FORECAST SUPABASE TESTS PASSED!');
