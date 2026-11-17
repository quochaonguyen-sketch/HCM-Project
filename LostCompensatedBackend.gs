/**
 * Lost & Compensated Backend — Google Sheets → Google Sheets (with BigQuery fallback)
 * Spreadsheet ID: 1jjQNjOu-kovQ9IYWffhi-76yQZwqgG67YJ2M86jcpvs
 *
 * Sheets populated:
 *   LOST                  — raw lost records from source Google Sheet
 *   % Loss Rate           — % lost per hub per month (from sheet or calculated)
 *   Monthly Lost Volume by Hub — lost count per hub per month (from sheet or pivot)
 *
 * Trigger: time-based, daily ~06:00 ICT — set via installLostBackendTrigger()
 */

const LC_CFG = Object.freeze({
  // Target backend spreadsheet
  SHEET_ID:         '1jjQNjOu-kovQ9IYWffhi-76yQZwqgG67YJ2M86jcpvs',
  // Source Google Sheet for Lost records (replaces BigQuery flm_lost_current query)
  SOURCE_SHEET_ID:  '1_iy3x6dD35DEAxlgYd-JCf0183RIJxHmv_aHyoHnF3g',
  SOURCE_TAB:       'LOST',
  PROJECT:          'root-opus-497613-d8',
  DATASET:          'hubops_pilot',
  LOCATION:         'asia-southeast1',
  // Rolling window: current month + 11 previous months (12 months total)
  MONTHS_BACK:      11,
  MAX_ROWS:         100000,
  TIMEOUT_MS:       55000,
});

// ─── helpers ────────────────────────────────────────────────────────────────

function lcTable_(name) {
  return '`' + LC_CFG.PROJECT + '.' + LC_CFG.DATASET + '.' + name + '`';
}

function lcToday_() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
}

/** Run a read-only BigQuery SQL and return rows as plain objects (JSON column). */
function lcQuery_(sql, params) {
  if (typeof BigQuery === 'undefined') throw Error('BigQuery API not enabled.');
  const request = {
    query: sql,
    useLegacySql: false,
    location: LC_CFG.LOCATION,
    timeoutMs: LC_CFG.TIMEOUT_MS,
    maxResults: LC_CFG.MAX_ROWS,
    maximumBytesBilled: '2147483648',
    useQueryCache: true,
  };
  if (params && params.length) {
    request.parameterMode = 'NAMED';
    request.queryParameters = params;
  }
  let result = BigQuery.Jobs.query(request, LC_CFG.PROJECT);
  const deadline = Date.now() + LC_CFG.TIMEOUT_MS;
  while (!result.jobComplete && Date.now() < deadline) {
    Utilities.sleep(500);
    result = BigQuery.Jobs.getQueryResults(
      LC_CFG.PROJECT, result.jobReference.jobId,
      { location: LC_CFG.LOCATION, timeoutMs: 5000, maxResults: LC_CFG.MAX_ROWS }
    );
  }
  if (!result.jobComplete) throw Error('LC_QUERY_TIMEOUT');
  if (result.errors && result.errors.length) throw Error(result.errors.map(e => e.message).join('; '));

  const rows = [];
  let token, pages = 0;
  do {
    if (++pages > 200) throw Error('LC_TOO_MANY_PAGES');
    (result.rows || []).forEach(r => rows.push(JSON.parse(r.f[0].v)));
    token = result.pageToken;
    if (token) result = BigQuery.Jobs.getQueryResults(
      LC_CFG.PROJECT, result.jobReference.jobId,
      { location: LC_CFG.LOCATION, pageToken: token, maxResults: LC_CFG.MAX_ROWS }
    );
  } while (token);
  return rows;
}

/** Clear sheet and write 2D array starting at A1. Creates sheet if missing. */
function lcWrite_(ss, sheetName, data) {
  return fastWriteSheetValues_(ss, sheetName, data, true);
}

// ─── LOST sheet ─────────────────────────────────────────────────────────────
// Đọc trực tiếp từ Google Sheet nguồn thay vì truy vấn BigQuery flm_lost_current.

function lcBuildLost_() {
  const srcId = (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties().getProperty('LOST_SOURCE_SHEET_ID')) || LC_CFG.SOURCE_SHEET_ID;
  const rows = fastReadSheetValues_(srcId, LC_CFG.SOURCE_TAB || 'LOST');
  if (!rows || !rows.length) throw Error('SOURCE_LOST_DATA_EMPTY');
  return rows;
}

// ─── % Loss Rate ─────────────────────────────────────────────────────────────
// Ưu tiên đọc từ Google Sheet nguồn; nếu không có thì fallback BigQuery hoặc tính toán.

function lcBuildLossRate_(today) {
  try {
    const srcId = (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties().getProperty('LOST_SOURCE_SHEET_ID')) || LC_CFG.SOURCE_SHEET_ID;
    const srcSs = SpreadsheetApp.openById(srcId);
    const sheet = srcSs.getSheetByName('% Loss Rate');
    if (sheet && sheet.getLastRow() > 1) {
      return sheet.getDataRange().getValues();
    }
  } catch (_) {}

  // Fallback BigQuery nếu có API
  if (typeof BigQuery !== 'undefined') {
    const from = Utilities.formatDate(
      new Date(new Date(today).setMonth(new Date(today).getMonth() - LC_CFG.MONTHS_BACK)),
      'Asia/Ho_Chi_Minh', 'yyyy-MM-01'
    );
    const lostSql =
      'SELECT TO_JSON_STRING(t) FROM (' +
      'SELECT station, FORMAT_DATE(\'%Y-%m\', d) AS month, COUNT(*) AS lost_count' +
      ' FROM ' + lcTable_('flm_lost_current') +
      ' WHERE mapped AND d BETWEEN @from AND @today' +
      ' GROUP BY station, month' +
      ') t';
    const volSql =
      'SELECT TO_JSON_STRING(t) FROM (' +
      'SELECT station, FORMAT_DATE(\'%Y-%m\', d) AS month, SUM(lm_fwd_in) AS volume' +
      ' FROM ' + lcTable_('flm_volume_snapshot') +
      ' WHERE d BETWEEN @from AND @today' +
      ' GROUP BY station, month' +
      ') t';
    const params = [
      { name: 'from',  parameterType: { type: 'DATE' }, parameterValue: { value: from } },
      { name: 'today', parameterType: { type: 'DATE' }, parameterValue: { value: today } },
    ];
    const lostRows = lcQuery_(lostSql, params);
    const volRows  = lcQuery_(volSql,  params);
    const volIdx = {};
    volRows.forEach(r => { volIdx[r.station + '|' + r.month] = Number(r.volume) || 0; });
    const monthSet = new Set(), hubSet = new Set(), lostIdx = {};
    lostRows.forEach(r => { monthSet.add(r.month); hubSet.add(r.station); lostIdx[r.station + '|' + r.month] = Number(r.lost_count) || 0; });
    const months = Array.from(monthSet).sort(), hubs = Array.from(hubSet).sort();
    const headerRow = ['Station Name', ...months];
    const dataRows = hubs.map(hub => {
      const cells = months.map(m => {
        const vol = volIdx[hub + '|' + m] || 0, lost = lostIdx[hub + '|' + m] || 0;
        return vol > 0 ? lost / vol : '';
      });
      return [hub, ...cells];
    });
    return [headerRow, ...dataRows];
  }
  throw Error('LOSS_RATE_DATA_UNAVAILABLE');
}

// ─── Monthly Lost Volume by Hub ───────────────────────────────────────────────
// Ưu tiên đọc từ Google Sheet nguồn; nếu không có thì tính từ LOST hoặc fallback BigQuery.

function lcBuildMonthlyVolume_(today) {
  try {
    const srcId = (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties().getProperty('LOST_SOURCE_SHEET_ID')) || LC_CFG.SOURCE_SHEET_ID;
    const srcSs = SpreadsheetApp.openById(srcId);
    const sheet = srcSs.getSheetByName('Monthly Lost Volume by Hub');
    if (sheet && sheet.getLastRow() > 1) {
      return sheet.getDataRange().getValues();
    }
  } catch (_) {}

  // Fallback: tính pivot từ dữ liệu LOST nguồn đã đọc
  try {
    const lostData = lcBuildLost_();
    if (lostData && lostData.length > 1) {
      const headers = lostData[0].map(h => String(h || '').trim().toLowerCase());
      const colDate = headers.findIndex(h => h === 'date' || h === 'd');
      const colStation = headers.findIndex(h => h === 'station' || h === 'fleet_final_station' || h === 'hub');
      if (colDate >= 0 && colStation >= 0) {
        const monthSet = new Set(), hubSet = new Set(), counts = {};
        for (let i = 1; i < lostData.length; i++) {
          const row = lostData[i];
          const rawDate = row[colDate];
          let m = '';
          if (rawDate instanceof Date) {
            m = Utilities.formatDate(rawDate, 'Asia/Ho_Chi_Minh', 'yyyy-MM');
          } else {
            m = String(rawDate || '').slice(0, 7);
          }
          const hub = String(row[colStation] || '').trim();
          if (!/^\d{4}-\d{2}$/.test(m) || !hub) continue;
          monthSet.add(m);
          hubSet.add(hub);
          const k = hub + '|' + m;
          counts[k] = (counts[k] || 0) + 1;
        }
        const months = Array.from(monthSet).sort().reverse();
        const hubs = Array.from(hubSet).sort();
        const headerRow = ['Station Name', ...months.map(() => 'Lost Vol')];
        const dateRow = ['', ...months.map(m => new Date(m + '-01'))];
        const dataRows = hubs.map(hub => [hub, ...months.map(m => counts[hub + '|' + m] || 0)]);
        return [headerRow, dateRow, ...dataRows];
      }
    }
  } catch (_) {}

  // Fallback BigQuery nếu có API
  if (typeof BigQuery !== 'undefined') {
    const from = Utilities.formatDate(
      new Date(new Date(today).setMonth(new Date(today).getMonth() - LC_CFG.MONTHS_BACK)),
      'Asia/Ho_Chi_Minh', 'yyyy-MM-01'
    );
    const sql =
      'SELECT TO_JSON_STRING(t) FROM (' +
      'SELECT station, DATE_TRUNC(d, MONTH) AS month, COUNT(*) AS lost_count' +
      ' FROM ' + lcTable_('flm_lost_current') +
      ' WHERE mapped AND d BETWEEN @from AND @today' +
      ' GROUP BY station, month' +
      ') t';
    const params = [
      { name: 'from',  parameterType: { type: 'DATE' }, parameterValue: { value: from } },
      { name: 'today', parameterType: { type: 'DATE' }, parameterValue: { value: today } },
    ];
    const rows = lcQuery_(sql, params);
    const monthSet = new Set(), hubSet = new Set();
    rows.forEach(r => { monthSet.add(String(r.month)); hubSet.add(r.station); });
    const months = Array.from(monthSet).sort().reverse();
    const hubs   = Array.from(hubSet).sort();
    const lostIdx = {};
    rows.forEach(r => { lostIdx[r.station + '|' + String(r.month)] = Number(r.lost_count) || 0; });
    const headerRow = ['Station Name', ...months.map(() => 'Lost Vol')];
    const dateRow   = ['', ...months.map(m => new Date(m))];
    const dataRows  = hubs.map(hub => [hub, ...months.map(m => lostIdx[hub + '|' + m] || 0)]);
    return [headerRow, dateRow, ...dataRows];
  }
  throw Error('MONTHLY_VOLUME_UNAVAILABLE');
}

// ─── Main refresh entry point ─────────────────────────────────────────────────

function refreshLostBackend() {
  const ss    = SpreadsheetApp.openById(LC_CFG.SHEET_ID);
  const today = lcToday_();
  const errors = [];

  function run(label, fn, sheetName) {
    try {
      const data = fn(today);
      lcWrite_(ss, sheetName, data);
      console.log(label + ': ' + (data.length - 1) + ' rows written to ' + sheetName);
    } catch (err) {
      errors.push(label + ': ' + String(err.message || err));
      console.error(label + ' FAILED — ' + String(err.message || err));
    }
  }

  run('LOST',                lcBuildLost_,          'LOST');
  run('% Loss Rate',         lcBuildLossRate_,       '% Loss Rate');
  run('Monthly Lost Volume', lcBuildMonthlyVolume_,  'Monthly Lost Volume by Hub');

  SpreadsheetApp.flush();
  const result = { ok: !errors.length, today: today, errors: errors, refreshedAt: new Date().toISOString() };
  console.log(JSON.stringify(result));
  return result;
}

// ─── Trigger management ───────────────────────────────────────────────────────

/** Run once to install a daily 06:00 ICT trigger. Safe to re-run (removes old). */
function installLostBackendTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'refreshLostBackend')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('refreshLostBackend')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();
  console.log('Trigger installed: refreshLostBackend daily at 06:00 ICT');
}
