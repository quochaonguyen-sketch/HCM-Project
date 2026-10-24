/**
 * SPX PERFORMANCE — KPI DAILY DIRECT SOURCE V0.17.17
 * ============================================================
 * Purpose:
 * - Read sheet "kpis daily archive" directly; legacy KPI Daily is fallback only.
 * - Do NOT merge six KPI source sheets.
 * - Do NOT calculate Grade / Final Point / KPI values.
 * - Do NOT cap Rider / Sorter again.
 * - Send only the requested scope/period/day back to the Web App.
 *
 * Fast path:
 *   KPI Daily -> one getValues() -> compact ScriptCache -> server filter -> UI
 */

const KPI_DAILY_DIRECT_CFG = Object.freeze({
  SHEET_NAME: 'kpis daily archive',
  LEGACY_SHEET_NAME: 'KPI Daily',
  CACHE_KEY: 'spx:v01777:kpi-daily-direct:model',
  HUB_CACHE_KEY: 'spx:v01777:kpi-daily-direct:hubs',
  CACHE_TTL_SEC: 21600,
  READ_MODE: 'KPI_DAILY_DIRECT'
});

// Permission/organization data remains in getDb_(); daily KPI can live in the
// archive workbook independently. All APIs retain their authorized HUB filter.
function kpiDailyDirectDatabase_() {
  const id = PropertiesService.getScriptProperties().getProperty('KPI_DAILY_DB_SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : getDb_();
}

// Run once in the Web App's Apps Script editor after installing this version.
function configureKpiDailyArchiveSource() {
  requireAdmin_();
  const id = '1VXYAZL6YfTbok7Ip-7q-hWRyXOatHd0TUINE2OmZ1QI';
  const db = SpreadsheetApp.openById(id);
  if (!db.getSheetByName(KPI_DAILY_DIRECT_CFG.SHEET_NAME)) throw Error('Thiếu tab kpis daily archive trong file archive.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('KPI_DAILY_DB_SHEET_ID', id);
  clearKpiDailyDirectCache_();
  props.setProperty(DATA_REFRESH_CFG.VERSION_PROP, 'daily-archive-' + Date.now());
  return checkKpiDailyWebSource();
}

// Editor diagnostic bypasses cached data and identifies the exact file/tab read.
function checkKpiDailyWebSource() {
  requireAdmin_();
  const db = kpiDailyDirectDatabase_(), model = buildKpiDailyDirectModel_();
  const result = {
    spreadsheetId:db.getId(), sheetName:model.sheetName,
    latestDate:(model.dates || []).slice().sort().pop() || '',
    rows:(model.rows || []).length, sourceMeta:model.sourceMeta
  };
  console.log(JSON.stringify(result));
  return result;
}

// Editor action after source data or monthly calculations have changed.
function resetKpiWebCache() {
  requireAdmin_();
  clearKpiDailyDirectCache_();
  [CACHE_CFG.KPI_MODEL_KEY,CACHE_CFG.KPI_CONFIG_MODEL_KEY,CACHE_CFG.TARGET_PROD_MODEL_KEY].forEach(function(key){removeChunkedCacheJson_(key)});
  const props=PropertiesService.getScriptProperties(),now=new Date();
  props.setProperty(DATA_REFRESH_CFG.VERSION_PROP,'kpi-reset-'+now.getTime());
  props.setProperty(DATA_REFRESH_CFG.AT_PROP,now.toISOString());
  const result={ok:true,message:'Đã xóa cache KPI Daily/Monthly. Tải lại web và bấm Refresh.',refreshedAt:now.toISOString()};
  console.log(JSON.stringify(result));return result;
}

// Small compatibility object for old System Monitor / helper code.
// It does NOT represent a merge pipeline.
const MERGED_DAILY_KPI_CFG = Object.freeze({
  SHEET_NAME: KPI_DAILY_DIRECT_CFG.SHEET_NAME,
  CACHE_PREFIX: KPI_DAILY_DIRECT_CFG.CACHE_KEY,
  HUB_CACHE_KEY: KPI_DAILY_DIRECT_CFG.HUB_CACHE_KEY,
  META_PERSIST_KEY: 'SPX_KPI_DAILY_DIRECT_META_V01716',
  STATE_PIPELINE: 'KPI_DAILY_DIRECT',
  READ_MODE: KPI_DAILY_DIRECT_CFG.READ_MODE
});


function kpiDailyDirectHeaders_() {
  return [
    'KPI Month',
    'Hub Type',
    'Region',
    'Station Name',
    'Grade',
    'Final Point',
    '%FM Ontime',
    '%LM Ontime',
    '%Deli Success',
    '%Sorter Productivity',
    '%Rider Productivity',
    '%Correct SOP - PU'
  ];
}


// Compatibility only.
function mergedDailyKpiHeaders_() {
  return kpiDailyDirectHeaders_();
}


function kpiDailyDirectHeaderNorm_(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/_/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');
}


function kpiDailyDirectHeaderMap_(headers) {
  const out = {};

  (headers || []).forEach(function(header, index) {
    const key = kpiDailyDirectHeaderNorm_(header);

    // Keep first duplicate header. This matters when sheets contain
    // duplicate "Hub Code" columns.
    if (key && out[key] === undefined) {
      out[key] = index;
    }
  });

  return out;
}


function kpiDailyDirectFindHeader_(map, aliases) {
  for (let i = 0; i < (aliases || []).length; i++) {
    const key = kpiDailyDirectHeaderNorm_(aliases[i]);
    if (map[key] !== undefined) return map[key];
  }

  return -1;
}


function kpiDailyDirectSchema_(headers) {
  const map = kpiDailyDirectHeaderMap_(headers);

  return {
    date: kpiDailyDirectFindHeader_(map, [
      'KPI Date',
      'Date',
      'KPI Month'
    ]),

    hubCode: kpiDailyDirectFindHeader_(map, [
      'Hub Code',
      'Station Code'
    ]),

    hubName: kpiDailyDirectFindHeader_(map, [
      'Station Name',
      'Hub Name',
      'Hub',
      'Station'
    ]),

    hubType: kpiDailyDirectFindHeader_(map, [
      'Hub Type',
      'Station Type'
    ]),

    region: kpiDailyDirectFindHeader_(map, [
      'Region',
      'Area',
      'Zone'
    ]),

    grade: kpiDailyDirectFindHeader_(map, [
      'Grade'
    ]),

    finalPointPct: kpiDailyDirectFindHeader_(map, [
      'Final Point',
      'Final Point %'
    ]),

    fmOntime: kpiDailyDirectFindHeader_(map, [
      '%FM Ontime',
      'FM Ontime'
    ]),

    lmOntime: kpiDailyDirectFindHeader_(map, [
      '%LM Ontime',
      'LM Ontime'
    ]),

    deliSuccess: kpiDailyDirectFindHeader_(map, [
      '%Deli Success',
      'Deli Success'
    ]),

    sorterProductivityPct: kpiDailyDirectFindHeader_(map, [
      '%Sorter Productivity',
      'Sorter Productivity'
    ]),

    riderProductivityPct: kpiDailyDirectFindHeader_(map, [
      '%Rider Productivity',
      'Rider Productivity'
    ]),

    correctSopPu: kpiDailyDirectFindHeader_(map, [
      '%Correct SOP - PU',
      '%Correct SOP-PU',
      '%Correct SOP PU'
    ]),

    totalVolume: kpiDailyDirectFindHeader_(map, [
      'Total Volume',
      'Volume',
      'KPI Volume',
      'Order Volume',
      'Shipment Volume'
    ])
  };
}


function kpiDailyDirectNumber_(value) {
  if (typeof value === 'number' && isFinite(value)) {
    return value;
  }

  let text = String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, '')
    .replace(/%/g, '');

  if (!text || text === '-' || text === '—') return null;

  const hasComma = text.indexOf(',') !== -1;
  const hasDot = text.indexOf('.') !== -1;

  if (hasComma && hasDot) {
    if (text.lastIndexOf('.') > text.lastIndexOf(',')) {
      text = text.replace(/,/g, '');
    } else {
      text = text.replace(/\./g, '').replace(/,/g, '.');
    }
  } else if (hasComma) {
    const parts = text.split(',');
    const tail = parts[parts.length - 1] || '';

    if (parts.length === 2 && tail.length !== 3) {
      text = text.replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;

  const n = Number(text);
  return isFinite(n) ? n : null;
}


function kpiDailyDirectPercent_(value) {
  if (value == null || value === '' || value === '-' || value === '—') {
    return null;
  }

  if (typeof value === 'number' && isFinite(value)) {
    // Google Sheets percentage cells are normally stored as decimals.
    return Math.abs(value) <= 2.5
      ? value * 100
      : value;
  }

  const text = String(value).trim();
  const n = kpiDailyDirectNumber_(text);

  if (n == null) return null;

  if (text.indexOf('%') !== -1) return n;

  return Math.abs(n) <= 2.5
    ? n * 100
    : n;
}


function kpiDailyDirectDateKey_(value) {
  if (typeof sourceDateKey_ === 'function') {
    const key = sourceDateKey_(value);
    if (key) return key;
  }
  return factDateKey_(value) || '';
}


function kpiDailyDirectStationMatcher_(permissionStations) {
  const exact = {};
  const canonical = {};
  const collision = {};

  function add(alias, station) {
    alias = String(alias || '').trim();
    if (!alias || !station) return;

    const exactKey = normalizeStationName_(alias);

    if (exactKey && exact[exactKey] === undefined) {
      exact[exactKey] = station;
    }

    const canonicalKey = forecastCanonicalHubKey_(alias);

    if (!canonicalKey) return;

    if (
      canonical[canonicalKey] &&
      normalizeCompare_(canonical[canonicalKey].hubCode) !==
        normalizeCompare_(station.hubCode)
    ) {
      collision[canonicalKey] = true;
      delete canonical[canonicalKey];
      return;
    }

    if (!collision[canonicalKey]) {
      canonical[canonicalKey] = station;
    }
  }

  (permissionStations || []).forEach(function(station) {
    add(station.hubCode, station);
    add(station.hubName, station);
    add(station.profileStation, station);
  });

  return {
    resolve: function(sourceName, sourceCode) {
      const candidates = [sourceCode, sourceName].filter(Boolean);

      for (let i = 0; i < candidates.length; i++) {
        const exactKey = normalizeStationName_(candidates[i]);
        if (exact[exactKey]) return exact[exactKey];
      }

      for (let i = 0; i < candidates.length; i++) {
        const canonicalKey = forecastCanonicalHubKey_(candidates[i]);
        if (canonical[canonicalKey]) return canonical[canonicalKey];
      }

      return null;
    }
  };
}


/**
 * Compact cached row schema:
 *  0 period
 *  1 dateKey
 *  2 hubCode
 *  3 hubName
 *  4 hubType
 *  5 region
 *  6 grade
 *  7 finalPointPct
 *  8 fmOntime
 *  9 lmOntime
 * 10 deliSuccess
 * 11 sorterProductivityPct
 * 12 riderProductivityPct
 * 13 correctSopPu
 * 14 totalVolume
 * 15 complete
 */
function kpiDailyDirectRowToObject_(row) {
  return {
    period: row[0],
    dateKey: row[1],
    dateLabel: factDateLabel_(row[1]),

    hubCode: row[2],
    hubName: row[3],
    hubType: row[4],
    region: row[5],

    grade: row[6] || '',
    finalPointPct: row[7],

    fmOntime: row[8],
    lmOntime: row[9],
    deliSuccess: row[10],
    sorterProductivityPct: row[11],
    riderProductivityPct: row[12],
    correctSopPu: row[13],
    totalVolume: row[14],

    complete: row[15] === true,

    // Keep old UI fields present but null.
    sorterActual: null,
    sorterTarget: null,
    riderActual: null,
    riderTarget: null,

    sourceMissing: false
  };
}


function buildKpiDailyDirectModel_() {
  const db = kpiDailyDirectDatabase_();
  const sh = db.getSheetByName(KPI_DAILY_DIRECT_CFG.SHEET_NAME) || db.getSheetByName(KPI_DAILY_DIRECT_CFG.LEGACY_SHEET_NAME);

  if (!sh) {
    return {
      sheetFound:false,
      sheetName:KPI_DAILY_DIRECT_CFG.SHEET_NAME,
      generatedAt:new Date().toISOString(),
      periods:[], dates:[], hubs:[], rows:[],
      sourceMeta:{ directDaily:{ found:false, sheetName:KPI_DAILY_DIRECT_CFG.SHEET_NAME, readMode:KPI_DAILY_DIRECT_CFG.READ_MODE, physicalRows:0 } }
    };
  }

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return {
      sheetFound:true, sheetName:sh.getName(), generatedAt:new Date().toISOString(),
      periods:[], dates:[], hubs:[], rows:[],
      sourceMeta:{ directDaily:{ found:true, sheetName:sh.getName(), readMode:KPI_DAILY_DIRECT_CFG.READ_MODE, physicalRows:0 } }
    };
  }

  // Scheduled refresh only: accuracy is preferred over micro-optimizing this one read.
  // Raw values preserve typed percentages; display values preserve source text/error state.
  const range = sh.getRange(1, 1, lastRow, lastCol);
  const raw = range.getValues();
  const disp = range.getDisplayValues();
  const headers = (disp[0] || []).map(function(v){ return String(v == null ? '' : v).trim(); });
  const idx = kpiDailyDirectSchema_(headers);

  const required = [
    ['KPI Date', idx.date], ['Station Name', idx.hubName],
    ['%FM Ontime', idx.fmOntime], ['%LM Ontime', idx.lmOntime],
    ['%Deli Success', idx.deliSuccess], ['%Sorter Productivity', idx.sorterProductivityPct],
    ['%Rider Productivity', idx.riderProductivityPct], ['%Correct SOP - PU', idx.correctSopPu]
  ];
  const missingHeaders = required.filter(function(x){ return x[1] < 0; }).map(function(x){ return x[0]; });
  if (missingHeaders.length) throw new Error('KPI_DAILY_HEADER_INVALID: missing ' + missingHeaders.join(', '));

  const permission = getPermissionModel_(false);
  const stations = permission.stations || [];
  const matcher = kpiDailyDirectStationMatcher_(stations);
  const hubRegistry = {};
  const periods = {};
  const dates = {};
  const unmatched = {};
  const dedupe = {};

  stations.forEach(function(station){
    const key = normalizeCompare_(station.hubCode);
    if (!key) return;
    hubRegistry[key] = [station.hubCode, station.hubName, station.type || '', station.zone || ''];
  });

  function textCell(r, d, i) {
    if (i < 0) return '';
    const s = String((d && d[i]) != null ? d[i] : ((r && r[i]) != null ? r[i] : '')).trim();
    return (s === '-' || s === '—') ? '' : s;
  }

  function pctCell(r, d, i) {
    if (i < 0) return null;
    const rv = r[i];
    const dv = d[i];
    if (rv === '' || rv == null) return null;
    if (typeof rv === 'number' && isFinite(rv)) return headers.indexOf('Month')>=0&&headers.indexOf('KPI Date')>=0?rv*100:Math.abs(rv)<=2.5?rv*100:rv;
    const s = String(dv == null ? rv : dv).trim();
    if (!s || s === '-' || s === '—' || /lỗi|error|không data/i.test(s)) return null;
    return kpiDailyDirectPercent_(s);
  }

  for (let r = 1; r < raw.length; r++) {
    const rv = raw[r];
    const dv = disp[r] || [];
    const sourceHubName = textCell(rv, dv, idx.hubName);
    const sourceHubCode = idx.hubCode >= 0 ? textCell(rv, dv, idx.hubCode) : '';
    if (!sourceHubName && !sourceHubCode) continue;

    const dateKey = kpiDailyDirectDateKey_(rv[idx.date] || dv[idx.date]);
    if (!dateKey) continue;
    const period = dateKey.slice(0, 7);
    const station = matcher.resolve(sourceHubName, sourceHubCode);
    if (!station) {
      unmatched[sourceHubName || sourceHubCode] = true;
      continue;
    }

    const hubCode = station.hubCode;
    const hubKey = normalizeCompare_(hubCode);
    const grade = textCell(rv, dv, idx.grade);
    const finalPoint = pctCell(rv, dv, idx.finalPointPct);
    const fm = pctCell(rv, dv, idx.fmOntime);
    const lm = pctCell(rv, dv, idx.lmOntime);
    const deli = pctCell(rv, dv, idx.deliSuccess);
    const sorter = pctCell(rv, dv, idx.sorterProductivityPct);
    const rider = pctCell(rv, dv, idx.riderProductivityPct);
    const sop = pctCell(rv, dv, idx.correctSopPu);
    const hubType = idx.hubType >= 0 ? textCell(rv, dv, idx.hubType) : '';
    const region = idx.region >= 0 ? textCell(rv, dv, idx.region) : '';
    const volume = idx.totalVolume >= 0 ? kpiDailyDirectNumber_(rv[idx.totalVolume]) : null;

    // IMPORTANT: KPI Daily is already the final result.
    // A blank FM for an LM hub must NOT erase Grade/Final Point.
    // Every field is passed through independently from source.
    const compact = [
      period, dateKey, hubCode, station.hubName || sourceHubName,
      hubType || station.type || '', region || station.zone || '',
      grade, finalPoint, fm, lm, deli, sorter, rider, sop, volume,
      true // source row exists
    ];

    // Last source row for the same date/HUB wins; there is no merge/scoring.
    dedupe[dateKey + '|' + hubKey] = compact;
    periods[period] = true;
    dates[dateKey] = true;
  }

  const compactRows = Object.keys(dedupe).map(function(k){ return dedupe[k]; })
    .sort(function(a,b){ return factSortDateDesc_(a[1], b[1]) || String(a[3] || '').localeCompare(String(b[3] || '')); });
  const hubs = Object.keys(hubRegistry).map(function(k){ return hubRegistry[k]; })
    .sort(function(a,b){ return String(a[1] || '').localeCompare(String(b[1] || '')); });
  const periodList = Object.keys(periods).sort().reverse();
  const dateList = Object.keys(dates).sort(factSortDateDesc_);

  return {
    sheetFound:true,
    sheetName:sh.getName(),
    generatedAt:new Date().toISOString(),
    periods:periodList,
    dates:dateList,
    hubs:hubs,
    rows:compactRows,
    sourceMeta:{
      directDaily:{
        found:true,
        sheetName:sh.getName(),
        readMode:KPI_DAILY_DIRECT_CFG.READ_MODE,
        physicalRows:Math.max(0, lastRow - 1),
        physicalColumns:lastCol,
        normalizedRows:compactRows.length,
        hasGrade:idx.grade>=0,
        hasFinalPoint:idx.finalPointPct>=0,
        permissionHubCount:stations.length,
        unmatchedStationCount:Object.keys(unmatched).length,
        unmatchedStations:Object.keys(unmatched).sort().slice(0,100)
      }
    }
  };
}


function clearKpiDailyDirectCache_() {
  removeChunkedCacheJson_(
    KPI_DAILY_DIRECT_CFG.CACHE_KEY
  );

  removeChunkedCacheJson_(
    KPI_DAILY_DIRECT_CFG.HUB_CACHE_KEY
  );
}


function getKpiDailyDirectModel_(forceRefresh) {
  if (forceRefresh === true) {
    clearKpiDailyDirectCache_();
  }

  if (forceRefresh !== true) {
    const cached = getChunkedCacheJson_(
      KPI_DAILY_DIRECT_CFG.CACHE_KEY
    );

    if (
      cached &&
      cached.sheetFound !== false &&
      Array.isArray(cached.rows)
    ) {
      cached.cacheHit = true;
      return cached;
    }
  }

  const model = buildKpiDailyDirectModel_();

  model.cacheHit = false;

  putChunkedCacheJson_(
    KPI_DAILY_DIRECT_CFG.CACHE_KEY,
    model,
    KPI_DAILY_DIRECT_CFG.CACHE_TTL_SEC
  );

  return model;
}


function getKpiDailyDirectMeta_(forceRefresh) {
  const model = getKpiDailyDirectModel_(
    forceRefresh === true
  );

  return {
    sheetFound: model.sheetFound !== false,
    sheetName: model.sheetName || KPI_DAILY_DIRECT_CFG.SHEET_NAME,
    generatedAt: model.generatedAt || '',
    periods: model.periods || [],
    dates: model.dates || [],
    rows: Array.isArray(model.rows)
      ? model.rows.length
      : 0,
    sourceMeta: model.sourceMeta || {},
    readMode: KPI_DAILY_DIRECT_CFG.READ_MODE,
    directSource: true,
    cacheHit: !!model.cacheHit
  };
}



/**
 * FAST SUMMARY PATH:
 * Build only one tiny row per date. For multi-HUB scope we do not construct
 * hundreds/thousands of row objects because the Web App only needs the date
 * and source-completeness count until the user expands that date.
 */
function getKpiDailyDirectDayList_(
  period,
  hubCodes,
  forceRefresh
) {
  period =
    dailyKpiNormalizePeriod_(period) ||
    dailyKpiCurrentPeriod_();

  const model = getKpiDailyDirectModel_(
    forceRefresh === true
  );

  if (!model || model.sheetFound === false) {
    return null;
  }

  const requested = (hubCodes || []).filter(Boolean);
  const allowed = {};

  requested.forEach(function(code) {
    allowed[normalizeCompare_(code)] = true;
  });

  const singleHub = requested.length === 1;
  const byDate = {};

  (model.rows || []).forEach(function(row) {
    if (row[0] !== period) return;

    if (
      requested.length &&
      !allowed[normalizeCompare_(row[2])]
    ) {
      return;
    }

    const dateKey = row[1];

    if (!byDate[dateKey]) {
      byDate[dateKey] = {
        dateKey: dateKey,
        completeHubCount: 0,
        sourceRowCount: 0,
        singleRow: null
      };
    }

    const day = byDate[dateKey];

    day.sourceRowCount += 1;

    if (row[15] === true) {
      day.completeHubCount += 1;
    }

    if (singleHub) {
      day.singleRow = row;
    }
  });

  const days = Object.keys(byDate)
    .sort(factSortDateDesc_)
    .map(function(dateKey) {
      const day = byDate[dateKey];
      const single = day.singleRow
        ? kpiDailyDirectRowToObject_(
            day.singleRow
          )
        : null;

      return {
        dateKey: dateKey,
        dateLabel: factDateLabel_(dateKey),

        grade:
          single && single.complete
            ? single.grade
            : '',

        finalPointPct:
          single && single.complete
            ? single.finalPointPct
            : null,

        fmOntime:
          single
            ? single.fmOntime
            : null,

        lmOntime:
          single
            ? single.lmOntime
            : null,

        deliSuccess:
          single
            ? single.deliSuccess
            : null,

        sorterProductivityPct:
          single
            ? single.sorterProductivityPct
            : null,

        riderProductivityPct:
          single
            ? single.riderProductivityPct
            : null,

        correctSopPu:
          single
            ? single.correctSopPu
            : null,

        hubType:
          single
            ? single.hubType || ''
            : '',

        completeHubCount:
          day.completeHubCount,

        sourceRowCount:
          day.sourceRowCount
      };
    });

  return {
    ready: true,
    directSource: true,
    materialized: false,
    merged: false,
    period: period,
    generatedAt: model.generatedAt || '',
    cacheHit: !!model.cacheHit,
    cacheLevel: model.cacheHit
      ? 'SCRIPT_CACHE'
      : 'KPI_DAILY_SHEET',
    sourceMeta: model.sourceMeta || {},
    days: days
  };
}


/**
 * FAST DAY DETAIL PATH:
 * Convert only rows for ONE requested date to objects.
 */
function getKpiDailyDirectDaySlice_(
  period,
  dateKey,
  hubCodes,
  forceRefresh
) {
  period =
    dailyKpiNormalizePeriod_(period) ||
    dailyKpiCurrentPeriod_();

  dateKey = factDateKey_(dateKey);

  const model = getKpiDailyDirectModel_(
    forceRefresh === true
  );

  if (!model || model.sheetFound === false) {
    return null;
  }

  const requested = (hubCodes || []).filter(Boolean);
  const allowed = {};

  requested.forEach(function(code) {
    allowed[normalizeCompare_(code)] = true;
  });

  const rows = [];

  (model.rows || []).forEach(function(row) {
    if (row[0] !== period) return;
    if (row[1] !== dateKey) return;

    if (
      requested.length &&
      !allowed[normalizeCompare_(row[2])]
    ) {
      return;
    }

    rows.push(
      kpiDailyDirectRowToObject_(row)
    );
  });

  return {
    ready: true,
    directSource: true,
    materialized: false,
    merged: false,
    period: period,
    dateKey: dateKey,
    generatedAt: model.generatedAt || '',
    cacheHit: !!model.cacheHit,
    cacheLevel: model.cacheHit
      ? 'SCRIPT_CACHE'
      : 'KPI_DAILY_SHEET',
    sourceMeta: model.sourceMeta || {},
    rows: rows
  };
}


function getKpiDailyDirectSlice_(
  period,
  hubCodes,
  forceRefresh
) {
  period =
    dailyKpiNormalizePeriod_(period) ||
    dailyKpiCurrentPeriod_();

  const model = getKpiDailyDirectModel_(
    forceRefresh === true
  );

  if (!model || model.sheetFound === false) {
    return null;
  }

  const requested = (hubCodes || []).filter(Boolean);
  const allowed = {};

  requested.forEach(function(code) {
    allowed[normalizeCompare_(code)] = true;
  });

  const rows = [];

  (model.rows || []).forEach(function(compactRow) {
    if (compactRow[0] !== period) return;

    if (
      requested.length &&
      !allowed[normalizeCompare_(compactRow[2])]
    ) {
      return;
    }

    rows.push(
      kpiDailyDirectRowToObject_(compactRow)
    );
  });

  return {
    ready: true,
    directSource: true,
    materialized: false,
    merged: false,
    period: period,
    generatedAt: model.generatedAt || '',
    cacheHit: !!model.cacheHit,
    cacheLevel: model.cacheHit
      ? 'SCRIPT_CACHE'
      : 'KPI_DAILY_SHEET',
    sourceMeta: model.sourceMeta || {},
    rows: rows
  };
}


function getKpiDailyDirectHubCatalog_(forceRefresh) {
  if (forceRefresh !== true) {
    const cached = getChunkedCacheJson_(
      KPI_DAILY_DIRECT_CFG.HUB_CACHE_KEY
    );

    if (cached && Array.isArray(cached.hubs)) {
      return cached.hubs;
    }
  }

  const model = getKpiDailyDirectModel_(
    forceRefresh === true
  );

  const hubs = (model.hubs || []).map(function(h) {
    return {
      hubCode: h[0],
      hubName: h[1],
      type: h[2] || '',
      zone: h[3] || '',
      district: ''
    };
  });

  putChunkedCacheJson_(
    KPI_DAILY_DIRECT_CFG.HUB_CACHE_KEY,
    { hubs: hubs },
    KPI_DAILY_DIRECT_CFG.CACHE_TTL_SEC
  );

  return hubs;
}


function refreshKpiDailyDirectCache_() {
  const started = Date.now();

  const model = getKpiDailyDirectModel_(true);

  return {
    ok: true,
    directSource: true,
    materialized: false,
    merged: false,
    sheetName: model.sheetName || KPI_DAILY_DIRECT_CFG.SHEET_NAME,
    rows: Array.isArray(model.rows)
      ? model.rows.length
      : 0,
    periods: model.periods || [],
    sourceMeta: model.sourceMeta || {},
    generatedAt: model.generatedAt || '',
    ms: Date.now() - started
  };
}


/* ============================================================
   OLD NAME COMPATIBILITY — SAFE NO-MERGE WRAPPERS
   ------------------------------------------------------------
   The old app still has monitor/admin helpers that call these names.
   Every wrapper below uses KPI Daily direct. No six-source merge exists.
   ============================================================ */

function getMergedDailyKpiMeta_(forceRefresh) {
  const meta = getKpiDailyDirectMeta_(
    forceRefresh === true
  );

  return {
    buildId: '',
    generatedAt: meta.generatedAt,
    sheetName: meta.sheetName,
    rows: meta.rows,
    rawRows: 0,
    periods: meta.periods,
    dates: meta.dates,
    sourceMeta: {
      mergedDaily:
        (meta.sourceMeta || {}).directDaily || {}
    },
    etlSourceMeta: {},
    validation: {
      ok: meta.sheetFound,
      status: meta.sheetFound
        ? 'READY'
        : 'NOT_READY',
      warnings: []
    },
    periodConfigVersions: {},
    liveSheetAuthoritative: true,
    readMode: KPI_DAILY_DIRECT_CFG.READ_MODE
  };
}


function ensureMergedDailyKpiMeta_(forceRefresh) {
  return getMergedDailyKpiMeta_(
    forceRefresh === true
  );
}


function getMergedDailyKpiStoredMeta_() {
  return getMergedDailyKpiMeta_(false);
}


function readMergedDailyKpiSlice_(
  period,
  hubCodes,
  forceRefresh
) {
  return getKpiDailyDirectSlice_(
    period,
    hubCodes,
    forceRefresh === true
  );
}


function getMergedDailyHubCatalog_(forceRefresh) {
  return getKpiDailyDirectHubCatalog_(
    forceRefresh === true
  );
}


function clearMergedDailyHubCatalogCache_() {
  removeChunkedCacheJson_(
    KPI_DAILY_DIRECT_CFG.HUB_CACHE_KEY
  );
}


function rebuildMergedDailyKpiFact_() {
  return refreshKpiDailyDirectCache_();
}


function runMergedDailyKpiETL() {
  return refreshKpiDailyDirectCache_();
}


function markMergedDailyKpiDirty_() {
  // KPI Daily is already the final source.
  return true;
}


function clearMergedDailyKpiDirty_() {
  return true;
}


function migrateKpiDailyMergeToLeanSchema() {
  requireAdmin_();

  return {
    ok: true,
    skipped: true,
    directSource: true,
    note: 'No merge schema exists. KPI Daily is read directly.'
  };
}


function repairMergedDailyKpiMetaFromSheet() {
  requireAdmin_();

  return refreshKpiDailyDirectCache_();
}


function debugKpiDailyDirectSource() {
  requireAdmin_();

  const model = getKpiDailyDirectModel_(true);

  return {
    ok: model.sheetFound !== false,
    sheetName: model.sheetName || '',
    rows: Array.isArray(model.rows)
      ? model.rows.length
      : 0,
    hubCount: Array.isArray(model.hubs)
      ? model.hubs.length
      : 0,
    periods: model.periods || [],
    dates: (model.dates || []).slice(0, 31),
    sourceMeta: model.sourceMeta || {},
    cacheHit: !!model.cacheHit,
    sample: (model.rows || [])
      .slice(0, 10)
      .map(kpiDailyDirectRowToObject_)
  };
}
