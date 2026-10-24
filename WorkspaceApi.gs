/** Shared web API entry points. Uses configured Google Sheets in production.
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
function deployReadRows_(db, name) {
  const sheet = db.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(v => String(v || '').trim());
  return values.filter(row => row.some(v => v !== '' && v != null)).map(row => {
    const result = {};
    headers.forEach((key, i) => {
      if (!key) return;
      const value = row[i];
      result[key] = value instanceof Date
        ? Utilities.formatDate(value,'Asia/Ho_Chi_Minh',key==='hour'?'HH:mm':/fetched|captured|computed|^datetime$/i.test(key)?"yyyy-MM-dd'T'HH:mm:ssXXX":'yyyy-MM-dd')
        : value == null ? null : value;
    });
    return result;
  });
}
function workspaceD0Rows_(access, section) {
  const names = section ? d0SectionSheets_(section) : d0SectionSheets_();
  if (!section || section === 'attendance') names.push('BigQuery Attendance');
  return workspaceD0NamedRows_(access,names);
}
function workspaceD0NamedRows_(access, names) {
  const id = PropertiesService.getScriptProperties().getProperty('D0_DB_SHEET_ID');
  if (!id) throw Error('D0_DB_SHEET_ID is not configured.');
  const catalog = deployHubCatalog_(access,getPermissionModel_(false));
  const key = v => String(v||'').trim().toLowerCase().replace(/(?:\s+hub)+$/i,'').replace(/\s+/g,' ');
  const aliases = {};
  catalog.forEach(h => {aliases[key(h.code)]=h;aliases[key(h.name)]=h;});
  const db = SpreadsheetApp.openById(id), sheets = {};
  names.forEach(name => {
    sheets[name]=deployReadRows_(db,name).flatMap(row => {
      const hub=aliases[key(row.hub_code)]||aliases[key(row.station_name)];
      return hub ? [Object.assign({},row,{hub_code:hub.code,zone:hub.zone,aom:hub.aom,sup:hub.sup})] : [];
    });
  });
  return {sheets:sheets,hubCatalog:catalog,access:toPublicAccess_(access,getPermissionModel_(false)),generatedAt:new Date().toISOString()};
}
function getD0Snapshot(force, section) {
  if (section === 'hourly') return getD0HourlySnapshot(force);
  const access = requireAccess_(['dashboard','d0']);
  if (access.rank === 'NORMAL') throw Error('ACCESS_DENIED');
  const snapshot = d0SummarySnapshot_(workspaceD0Rows_(access,section));
  return section ? d0SnapshotSection_(snapshot,section) : snapshot;
}
// Separate RPC: independent of legacy D0 section registries and summary filters.
function getD0HourlySnapshot(force) {
  const access = requireAccess_(['dashboard','d0']);
  if (access.rank === 'NORMAL') throw Error('ACCESS_DENIED');
  const snapshot = workspaceD0NamedRows_(access,['Throughput Hourly D0']);
  snapshot.sheets['Throughput Hourly D0'] = d0HourlyRows_(snapshot.sheets['Throughput Hourly D0'] || []);
  return Object.assign({},snapshot,{section:'hourly',summaryOnly:true,cacheSeconds:60,apiVersion:'d0-hourly-v2'});
}
function getD0Riders(code,page,sort,direction,force,query) {
  const access = requireAccess_(['d0']);
  assertScopeAccess_(access,'HUB',code);
  const snapshot=workspaceD0Rows_(access,'delivery');
  return d0RiderPage_((snapshot.sheets['Delivery Progress D0']||[]).filter(r=>String(r.hub_code)===String(code)),page,sort,direction,query);
}
function getAccessDirectory() {
  requireAdmin_();
  const settings=getAccessGrantSettings();
  return {users:settings.accounts,stations:settings.hubs,accounts:settings.accounts,hubs:settings.hubs};
}
