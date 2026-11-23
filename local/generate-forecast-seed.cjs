const fs = require('fs');
const path = require('path');
const { createRuntime } = require('./apps-script-runtime.cjs');

const runtime = createRuntime();
const permission = runtime.context.getPermissionModel_(false);

const catalogMap = new Map();
permission.stations.forEach(s => {
  const norm = s.hubName.toLowerCase().trim().replace(/(?:\s+hub)+$/i, '');
  catalogMap.set(norm, { hubCode: s.hubCode, hubName: s.hubName });
  catalogMap.set(s.hubCode.toLowerCase().trim(), { hubCode: s.hubCode, hubName: s.hubName });
  catalogMap.set(s.hubName.toLowerCase().trim(), { hubCode: s.hubCode, hubName: s.hubName });
});

function resolveHub(rawName) {
  const clean = String(rawName || '').trim();
  const norm = clean.toLowerCase().replace(/(?:\s+hub)+$/i, '');
  if (catalogMap.has(norm)) return catalogMap.get(norm);
  if (catalogMap.has(clean.toLowerCase())) return catalogMap.get(clean.toLowerCase());
  return { hubCode: clean, hubName: clean };
}

const wb = JSON.parse(fs.readFileSync(path.join(__dirname, 'workbooks.private.json'), 'utf8'));
const fcRows = wb.backend.sheets['FC T1126'];

function parseDateCell(v) {
  if (!v) return '';
  if (typeof v === 'object' && v && v['$date']) return String(v['$date']).slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

const row0 = fcRows[0];
const row1 = fcRows[1];
const colInfo = [];

for (let c = 1; c < row0.length; c++) {
  const d = parseDateCell(row0[c]);
  if (d) {
    const nextH = String(row1[c] || '').toLowerCase().replace(/[\s#_]/g, '');
    const isFm = nextH === 'fmforecast';
    const isLm = nextH === 'lmforecast';
    colInfo.push({ col: c, date: d, isFm, isLm });
  } else {
    const prevDate = colInfo.length ? colInfo[colInfo.length - 1].date : '';
    const h = String(row1[c] || '').toLowerCase().replace(/[\s#_]/g, '');
    const isFm = h === 'fmforecast';
    const isLm = h === 'lmforecast';
    if (prevDate && (isFm || isLm)) {
      colInfo.push({ col: c, date: prevDate, isFm, isLm });
    }
  }
}

const datesMap = new Map();
colInfo.forEach(ci => {
  if (!datesMap.has(ci.date)) datesMap.set(ci.date, {});
  const entry = datesMap.get(ci.date);
  if (ci.isFm) entry.fmCol = ci.col;
  if (ci.isLm) entry.lmCol = ci.col;
});

const sortedDates = Array.from(datesMap.keys()).sort();
const records = [];

for (let r = 2; r < fcRows.length; r++) {
  const rawHub = String(fcRows[r][0] || '').trim();
  if (!rawHub) continue;
  const hub = resolveHub(rawHub);
  sortedDates.forEach(date => {
    const cols = datesMap.get(date);
    const fm = Number(fcRows[r][cols.fmCol]) || 0;
    const lm = Number(fcRows[r][cols.lmCol]) || 0;
    records.push({
      plan_date: date,
      hub_code: hub.hubCode,
      hub_name: hub.hubName,
      fm_forecast: fm,
      lm_forecast: lm,
      source: 'FC_T1126'
    });
  });
}

console.log(`Extracted ${records.length} records across ${sortedDates.length} dates and ${fcRows.length - 2} hubs.`);

// Generate SQL Seed File
const sqlDir = path.join(__dirname, '..', 'supabase', 'migrations');
if (!fs.existsSync(sqlDir)) fs.mkdirSync(sqlDir, { recursive: true });

const seedSqlPath = path.join(sqlDir, '20261119010001_seed_forecast_daily_t11.sql');
const sqlLines = [];
sqlLines.push('-- Seed FC T1126 data into public.forecast_daily (3,900 records)');
sqlLines.push('begin;');
sqlLines.push('');

const batchSize = 100;
for (let i = 0; i < records.length; i += batchSize) {
  const batch = records.slice(i, i + batchSize);
  const valuesStr = batch.map(r => {
    const escName = r.hub_name.replace(/'/g, "''");
    const escCode = r.hub_code.replace(/'/g, "''");
    return `('${r.plan_date}', '${escCode}', '${escName}', ${r.fm_forecast}, ${r.lm_forecast}, 'FC_T1126')`;
  }).join(',\n  ');

  sqlLines.push(`insert into public.forecast_daily (plan_date, hub_code, hub_name, fm_forecast, lm_forecast, source) values\n  ${valuesStr}`);
  sqlLines.push('on conflict (plan_date, hub_code) do update set');
  sqlLines.push('  hub_name = excluded.hub_name,');
  sqlLines.push('  fm_forecast = excluded.fm_forecast,');
  sqlLines.push('  lm_forecast = excluded.lm_forecast,');
  sqlLines.push('  source = excluded.source;');
  sqlLines.push('');
}

sqlLines.push('commit;');
fs.writeFileSync(seedSqlPath, sqlLines.join('\n'), 'utf8');
console.log(`Wrote SQL seed file to ${seedSqlPath} (${(fs.statSync(seedSqlPath).size / 1024).toFixed(1)} KB)`);

// Export parsed JSON for the uploader script
const jsonExportPath = path.join(__dirname, 'forecast-t11-data.private.json');
fs.writeFileSync(jsonExportPath, JSON.stringify(records), 'utf8');
console.log(`Wrote JSON export to ${jsonExportPath} (${(fs.statSync(jsonExportPath).size / 1024).toFixed(1)} KB)`);
