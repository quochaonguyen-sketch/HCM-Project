/** Shared web API entry points. Uses configured production data sources.
 * The local runtime supplies SpreadsheetApp using imported XLSX data.
 * No sample data or local identity is included in this file.
 */
function getKpiClientMonthCache(month, force) {
  return getKpiClientMonthCacheUncached_(month, force);
}
function getDailyKpiClientPeriodCache(period, force) {
  return getDailyKpiClientPeriodCacheUncached_(period, force);
}
function getForecastClientMasterCache(force) {
  return getForecastClientMasterCacheUncached_(force);
}
function deployHubCatalog_(access, permission) {
  const allowed = new Set(fullAuthorizedHubCodes_(access, permission).map(normalizeCompare_));
  return (permission.stations || []).filter(s => allowed.has(normalizeCompare_(s.hubCode)))
    .map(s => ({code:s.hubCode,name:s.hubName,zone:s.zone||'',aom:s.aom||[],sup:s.sup||[]}));
}
var DEPLOY_READ_CACHE_ = {};
function deployReadRows_(db, name, force) {
  var cacheKey = (db && db.getId ? db.getId() : 'db') + ':' + name;
  if (!force && ScriptApp.getScriptId() !== 'local-only' && DEPLOY_READ_CACHE_[cacheKey]) return DEPLOY_READ_CACHE_[cacheKey];
  const sheet = db.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(v => String(v || '').trim());
  const rows = values.filter(row => row.some(v => v !== '' && v != null)).map(row => {
    const result = {};
    headers.forEach((col, i) => {
      if (!col) return;
      const value = row[i];
      result[col] = value instanceof Date
        ? Utilities.formatDate(value,'Asia/Ho_Chi_Minh',col==='hour'?'HH:mm':/fetched|captured|computed|^datetime$|^first_clock_in$/i.test(col)?"yyyy-MM-dd'T'HH:mm:ssXXX":'yyyy-MM-dd')
        : value == null ? null : value;
    });
    return result;
  });
  DEPLOY_READ_CACHE_[cacheKey] = rows;
  return rows;
}
function workspaceD0Rows_(access, section, force) {
  const names = section ? d0SectionSheets_(section) : d0SectionSheets_();
  if (!section || section === 'attendance') names.push('BigQuery Attendance');
  return workspaceD0NamedRows_(access,names,force);
}
function workspaceD0NamedRows_(access, names, force) {
  return d0WorkspaceSnapshot_(access,names,force);
}
function getD0Snapshot(force, section) {
  if (section === 'hourly') return getD0HourlySnapshot(force);
  const access = requireAccess_(['dashboard','d0']);
  if (access.rank === 'NORMAL') throw Error('ACCESS_DENIED');
  const snapshot = d0SummarySnapshot_(workspaceD0Rows_(access,section,force));
  return section ? d0SnapshotSection_(snapshot,section) : snapshot;
}
// Separate RPC: independent of legacy D0 section registries and summary filters.
function getD0HourlySnapshot(force) {
  const access = requireAccess_(['dashboard','d0']);
  if (access.rank === 'NORMAL') throw Error('ACCESS_DENIED');
  const snapshot = workspaceD0NamedRows_(access,['Throughput Hourly D0'],force);
  snapshot.sheets['Throughput Hourly D0'] = d0HourlyRows_(snapshot.sheets['Throughput Hourly D0'] || []);
  return Object.assign({},snapshot,{section:'hourly',summaryOnly:true,cacheSeconds:60,apiVersion:'d0-hourly-v2'});
}
function getD0Riders(code,page,sort,direction,force,query) {
  const access = requireAccess_(['d0']);
  assertScopeAccess_(access,'HUB',code);
  const snapshot=workspaceD0Rows_(access,'delivery',force);
  const target = String(code || '').trim().toLowerCase();
  return d0RiderPage_((snapshot.sheets['Delivery Progress D0']||[]).filter(r => {
    return String(r.hub_code || '').trim().toLowerCase() === target ||
           String(r.station_id || '').trim().toLowerCase() === target ||
           String(r.station_name || '').trim().toLowerCase() === target;
  }),page,sort,direction,query);
}
function getAccessDirectory() {
  requireAdmin_();
  const settings=getAccessGrantSettings();
  return {users:settings.accounts,stations:settings.hubs,accounts:settings.accounts,hubs:settings.hubs};
}
