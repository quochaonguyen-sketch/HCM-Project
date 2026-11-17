/**
 * FastDataLoader — Ultra-low latency data loader for Google Apps Script.
 * 
 * 1. L1 In-Memory Execution Memo (0ms for repeated calls in the same run)
 * 2. Google Sheets API v4 (Advanced Service) single-roundtrip batch fetching
 * 3. Graceful fallback to single-call SpreadsheetApp (no slow 500-row chunking loops)
 * 4. Automatic CacheService chunked compression for payloads up to 2MB
 */

var __FAST_DATA_MEMO__ = Object.create(null);

/**
 * Fast sheet reader: reads an entire range or sheet in a single RPC round-trip.
 * Uses Google Sheets API v4 if available, otherwise native single-call getValues().
 *
 * @param {string|Spreadsheet} ssOrId - Spreadsheet ID or Spreadsheet object
 * @param {string} sheetName - Target sheet name
 * @param {string} [rangeA1] - Optional A1 notation (e.g. 'A1:Z500' or '2:1000')
 * @returns {Array<Array<*>>} 2D matrix of cell values
 */
function fastReadSheetValues_(ssOrId, sheetName, rangeA1) {
  var ssId = typeof ssOrId === 'string' ? ssOrId : (ssOrId && typeof ssOrId.getId === 'function' ? ssOrId.getId() : '');
  var memoKey = 'read:' + ssId + ':' + sheetName + ':' + (rangeA1 || '*');
  if (__FAST_DATA_MEMO__[memoKey]) return __FAST_DATA_MEMO__[memoKey];

  var values = null;

  // 1. Google Sheets API v4 (Advanced Service) - fastest path (1 HTTP request, raw JSON)
  if (typeof Sheets !== 'undefined' && Sheets && Sheets.Spreadsheets && Sheets.Spreadsheets.Values && ssId) {
    try {
      var rangeStr = "'" + sheetName.replace(/'/g, "''") + "'" + (rangeA1 ? '!' + rangeA1 : '');
      var res = Sheets.Spreadsheets.Values.get(ssId, rangeStr, {
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      });
      if (res && Array.isArray(res.values)) {
        values = res.values;
      }
    } catch (_) {
      // Fallback to SpreadsheetApp on any API error or quota limit
      values = null;
    }
  }

  // 2. Native single-call SpreadsheetApp fallback (1 RPC call, avoids slow chunking loops)
  if (!values) {
    var ss = typeof ssOrId === 'string' ? SpreadsheetApp.openById(ssOrId) : ssOrId;
    if (!ss) return [];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];

    var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
    if (lastRow <= 0 || lastCol <= 0) return [];

    if (rangeA1) {
      values = sheet.getRange(rangeA1).getValues();
    } else {
      values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    }
  }

  __FAST_DATA_MEMO__[memoKey] = values || [];
  return __FAST_DATA_MEMO__[memoKey];
}

/**
 * Fast batch sheet reader: reads multiple ranges in a single round-trip.
 *
 * @param {string} ssId - Spreadsheet ID
 * @param {Array<string>} rangeList - Array of range notations (e.g. ["Sheet1!A1:B10", "Sheet2!A2:Z"])
 * @returns {Array<Array<Array<*>>>} Array of 2D matrices corresponding to rangeList
 */
function fastBatchReadSheetValues_(ssId, rangeList) {
  if (!rangeList || !rangeList.length) return [];

  // Google Sheets API v4 batchGet
  if (typeof Sheets !== 'undefined' && Sheets && Sheets.Spreadsheets && Sheets.Spreadsheets.Values && ssId) {
    try {
      var res = Sheets.Spreadsheets.Values.batchGet(ssId, {
        ranges: rangeList,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      });
      if (res && Array.isArray(res.valueRanges)) {
        return res.valueRanges.map(function(vr) { return vr.values || []; });
      }
    } catch (_) {}
  }

  // Fallback: read sequentially via fastReadSheetValues_
  return rangeList.map(function(r) {
    var parts = r.split('!');
    var sheetName = parts[0].replace(/^'|'$/g, '');
    var range = parts[1] || '';
    return fastReadSheetValues_(ssId, sheetName, range);
  });
}

/**
 * Fast sheet writer: writes a 2D array in a single setValues() call.
 *
 * @param {Spreadsheet} ss - Target spreadsheet object
 * @param {string} sheetName - Target sheet name
 * @param {Array<Array<*>>} data2D - Rows to write
 * @param {boolean} [clearFirst=false] - Whether to clear the sheet before writing
 * @returns {Sheet} Target sheet
 */
function fastWriteSheetValues_(ss, sheetName, data2D, clearFirst) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else if (clearFirst) {
    sheet.clearContents();
  }
  if (!data2D || !data2D.length || !data2D[0] || !data2D[0].length) return sheet;

  sheet.getRange(1, 1, data2D.length, data2D[0].length).setValues(data2D);
  return sheet;
}

/**
 * High-speed cached loader: checks L1 RAM, then CacheService (chunked), then executes fetcherFn.
 *
 * @param {string} cacheKey - Unique cache key
 * @param {number} ttlSec - Time-to-live in seconds (max 21600 = 6 hours)
 * @param {Function} fetcherFn - Callback returning fresh data if cache miss
 * @returns {*} Loaded data
 */
function fastCachedQuery_(cacheKey, ttlSec, fetcherFn) {
  if (__FAST_DATA_MEMO__[cacheKey]) return __FAST_DATA_MEMO__[cacheKey];

  var ttl = Math.min(Math.max(ttlSec || 300, 60), 21600);

  // 1. Try CacheService (using chunked reader if available, else native)
  try {
    var cached = typeof getChunkedCacheJson_ === 'function' ? getChunkedCacheJson_(cacheKey) : null;
    if (cached) {
      __FAST_DATA_MEMO__[cacheKey] = cached;
      return cached;
    }
  } catch (_) {}

  // 2. Cache miss: execute fetcher
  var fresh = fetcherFn();

  // 3. Save to CacheService and L1 memo
  if (fresh != null) {
    __FAST_DATA_MEMO__[cacheKey] = fresh;
    try {
      if (typeof putChunkedCacheJson_ === 'function') {
        putChunkedCacheJson_(cacheKey, fresh, ttl);
      } else {
        var str = JSON.stringify(fresh);
        if (str.length < 95000 && typeof CacheService !== 'undefined') {
          CacheService.getScriptCache().put(cacheKey, str, ttl);
        }
      }
    } catch (_) {}
  }

  return fresh;
}
