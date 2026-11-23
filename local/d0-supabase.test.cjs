const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const vm = require('node:vm');
const path = require('node:path');
const { writeFixtures } = require('./test-fixtures.cjs');

// The emulator resolves its workspace at import time.
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(),'hcm-d0-supabase-'));
process.on('exit',() => fs.rmSync(fixtureDir,{recursive:true,force:true}));
writeFixtures(fixtureDir);
process.env.HCM_LOCAL_DATA_DIR = fixtureDir;
const { createRuntime, dataDir } = require('./apps-script-runtime.cjs');
assert.equal(dataDir, fixtureDir, 'The D0 emulator must read only the generated fixture directory');

const runtime = createRuntime();
const ctx = runtime.context;
const permission = ctx.getPermissionModel_(false);
const sup = Object.values(permission.users).find(user => user.rank === 'SUP');
const allowed = permission.stations.filter(station => sup.hubCodes.includes(station.hubCode));
const [hub, otherAllowed] = allowed;
const denied = permission.stations.find(station => !sup.hubCodes.includes(station.hubCode));
const activeUser = ctx.Session.getActiveUser;
const nativeProps = ctx.PropertiesService.getScriptProperties;
const config = {
  D0_SUPABASE_URL: 'https://synthetic-d0.supabase.co',
  D0_SUPABASE_SECRET_KEY: 'sb_secret_synthetic-test-only'
};
ctx.PropertiesService.getScriptProperties = () => {
  const original = nativeProps();
  return { ...original, getProperty: name => Object.hasOwn(config,name) ? config[name] : original.getProperty(name) };
};

const day = runtime.provenance.asOf;
const yesterday = new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString().slice(0,10);
const stamp = day + ' 09:00:00';
const attendanceRows = runtime.data.backend.sheets['BigQuery Attendance'];
const nameIndex = attendanceRows[0].indexOf('station_name');
const clockIndex = attendanceRows[0].indexOf('first_clock_in');
const firstClock = attendanceRows.slice(1).find(row => row[nameIndex] === hub.hubName);
assert(firstClock && clockIndex >= 0);
firstClock[clockIndex] = new Date(day + 'T21:00:00+07:00');
const sources = Object.values(ctx.d0SupabaseSources_());
const byTable = new Map(sources.map(source => [source.table, source]));
const received = 'lm_hub_received_in_system_order_qty_1h';
const assigned = 'lm_hub_fleet_assigned_order_qty_td';
const delivered = 'lm_hub_fleet_delivered_order_qty_eod';
const baseline = {
  fm_order_volume_d0: [
    {station_id:1, snapshot_date:day, total_fm_inbound:3, outbound:null, picked:0},
    {station_id:2, station_name:otherAllowed.hubName, snapshot_date:yesterday, total_fm_inbound:90}
  ],
  fm_pending_pickup_backlog_d0: [
    {id:'pickup-1', snapshot_date:day, pending_pickup_1_2_days:1, pending_pickup_3_5_days:0, pending_pickup_gt_5_days:null}
  ],
  backlog_d0: [
    {station_id:1, fetched_at:yesterday + ' 18:00:00', total_backlog_d_minus_1:2},
    {station_id:2, station_name:otherAllowed.hubName, total_backlog_d_minus_1:0}
  ],
  lm_backlog_d0: [{station_id:1, backlog_d0:4}],
  lm_order_volume_d0: [{station_id:1, fetched_at:day + 'T02:00:00.100001Z', pending_inbound:0}],
  delivery_progress_d0: [
    {id:'1-active', driver_id:'active', driver_name:'Synthetic Current', [assigned]:4, [delivered]:0, fetched_at:stamp + '.100002'},
    {id:'1-inactive', driver_id:'inactive', driver_name:'Previous Collection', [assigned]:100, fetched_at:stamp + '.100001'},
    {id:'1-other', driver_id:'other', driver_name:'Another Current', [assigned]:5, fetched_at:day + 'T02:00:00.1000020Z'}
  ],
  throughput_hourly_d0: [
    {id:'hour-0', grass_date:day, hour:'00:00', [received]:0, fetched_at:stamp + '.100002'},
    {id:'hour-1', grass_date:day, hour:'00:00', [received]:91, fetched_at:stamp + '.100001'},
    {id:'hour-2', grass_date:day, hour:'01:00', [received]:null},
    {id:'hour-3', grass_date:yesterday, hour:'02:00', [received]:91}
  ],
  roster_d0: [{id:'roster-1', event_date_iso:day, attendance_pct:'80.00', present_count:0}],
  roster_shifts_d0: [{id:'shift-1', event_date_iso:yesterday, shift_date_iso:yesterday, shift:'22:00-06:00', actual_people:3}]
};

const requests = [];
let behavior = 'ok';
let forecastRows = [];
function response(status, data) {
  return {getResponseCode:() => status, getContentText:() => JSON.stringify(data)};
}
ctx.UrlFetchApp.fetch = (url, options) => {
  assert.equal(options.method,'get');
  assert.equal(options.followRedirects,false);
  assert.equal(options.headers.apikey,config.D0_SUPABASE_SECRET_KEY);
  const target = new URL(url);
  assert.equal(target.origin,config.D0_SUPABASE_URL);
  const table = target.pathname.split('/').pop();
  if (table === 'forecast_daily') return response(200,forecastRows);
  const source = byTable.get(table);
  assert(source, 'Only the nine verified D0 relations can be requested.');
  const filter = target.searchParams.get('station_name');
  assert(filter?.startsWith('ilike(any).{'), 'Every request must include a station constraint.');
  const patterns = JSON.parse('[' + filter.slice('ilike(any).{'.length,-1) + ']')
    .map(pattern => pattern.replace(/\\([\\%_])/g,'$1'));
  const requestedFields = target.searchParams.get('select').split(',');
  assert.equal(target.searchParams.get('order'),source.key + '.asc');
  assert.equal(target.searchParams.get('limit'),'500');
  const cursor = target.searchParams.get(source.key);
  requests.push({table,patterns,cursor,requestedFields,urlLength:url.length});
  assert(url.length<=2082);
  if (behavior === 'denied') return response(403,{sensitive:'never echo upstream'});
  if (behavior === 'failure') return response(503,{sensitive:'never echo upstream'});
  if (behavior === 'malformed') return response(200,[{station_id:1}]);
  if (behavior === 'empty') return response(200,[]);
  const selectedRows = (baseline[table] || []).map(fields => ({
    station_id:1, station_name:hub.hubName.toLowerCase().replace(/ hub$/,''), fetched_at:stamp, ...fields
  }));
  if (behavior === 'freshness' && table === 'throughput_hourly_d0'){
    selectedRows.splice(0,selectedRows.length,
      {station_id:1,station_name:hub.hubName,id:'fresh',fetched_at:new Date().toISOString()},
      {station_id:1,station_name:hub.hubName.toLowerCase().replace(/ hub$/,''),id:'stale',fetched_at:yesterday + ' 09:00:00'});
  }
  if (behavior === 'scope' && !cursor && patterns.includes(hub.hubName.toLowerCase())) {
    selectedRows.unshift({station_id:-999, station_name:denied.hubName, fetched_at:stamp, id:'foreign'});
  }
  const matches = selectedRows.filter(row => patterns.includes(row.station_name.toLowerCase()) || row.id === 'foreign');
  const sorted = matches.sort((left,right) => source.key === 'id' ?
    left.id.localeCompare(right.id) : left.station_id - right.station_id);
  const page = sorted.filter(row => !cursor || row.id === 'foreign' ||
    (source.key === 'id' ? row.id > cursor.slice(3) : row.station_id > Number(cursor.slice(3)))).slice(0,500);
  return response(200,page.map(row => Object.fromEntries(requestedFields.map(field => [field,row[field] ?? null]))));
};

ctx.Session.getActiveUser = () => ({getEmail:() => sup.email});
for (const file of ['Code.gs','WorkspaceApi.gs']) {
  const rootCode = fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const apiCode = file === 'Code.gs' ? rootCode.slice(rootCode.indexOf('function deployHubCatalog_(access, permission) {')) : rootCode;
  vm.runInContext(apiCode,ctx,{filename:file});

  const fm = runtime.call('getD0Snapshot',[true,'fm']);
  assert.equal(fm.section,'fm');
  assert.equal(fm.sheets['FM Order Volume D0'].length,1);
  const [fmRow] = fm.sheets['FM Order Volume D0'];
  assert.equal(fmRow.hub_code,hub.hubCode);
  assert.equal(fmRow['Total FM Inbound'],3);
  assert.equal(fmRow.Picked,0);
  assert.equal(fmRow.Outbound,null);
  assert.equal(fmRow.picked,undefined);
  assert.equal(fm.todayForecast?.date,day);
  assert.equal(fm.todayForecast?.byHub[hub.hubCode].fm,1000);
  forecastRows = [{hub_code:denied.hubCode,hub_name:hub.hubName,fm_forecast:735,lm_forecast:735}];
  const foreignPlan = runtime.call('getD0Snapshot',[true,'fm']).todayForecast;
  assert.equal(foreignPlan?.source,'workbook','A foreign-only reply must fall through to the original workbook');
  assert.equal(foreignPlan?.byHub[hub.hubCode].fm,1000,'A foreign explicit code cannot claim the name of an authorized HUB');
  forecastRows = [{hub_code:hub.hubCode,fm_forecast:0,lm_forecast:1200}];
  const correctedPlan = runtime.call('getD0Snapshot',[true,'fm']).todayForecast;
  assert.equal(correctedPlan?.byHub[hub.hubCode].fm,1000,'The snapshot uses the raw same-day cell to resolve a defaulted zero');
  assert.equal(correctedPlan?.byHub[hub.hubCode].lm,1200);
  forecastRows = [];
  const readForecast = ctx.d0TodayForecastFromWorkbook_;
  ctx.d0TodayForecastFromWorkbook_ = () => ({date:day,byHub:{[hub.hubCode]:{fm:1000}}});
  baseline.fm_order_volume_d0[0].snapshot_date = yesterday;
  assert.equal(runtime.call('getD0Snapshot',[true,'fm']).todayForecast?.date,undefined,'A later workbook day cannot stand in for this D0 report.');
  baseline.fm_order_volume_d0[0].snapshot_date = day;
  ctx.d0TodayForecastFromWorkbook_ = readForecast;

  const pickupSnapshot = runtime.call('getD0Snapshot',[true,'fmPickup']);
  const [pickup] = pickupSnapshot.sheets['FM Pending Pickup Backlog D0'];
  assert.equal(pickupSnapshot.todayForecast,null);
  assert.equal(pickup.pending_pickup_from_seller_backlog_1_2_days,1);
  assert.equal(pickup.pending_pickup_from_seller_backlog_3_5_days,0);
  assert.equal(pickup.pending_pickup_from_seller_backlog_gt_5_days,null);

  const {sheets:lm,todayForecast:lmForecast} = runtime.call('getD0Snapshot',[true,'lm']);
  assert.equal(lmForecast?.date,day);
  assert.equal(lmForecast?.byHub[hub.hubCode].lm,1200);
  assert.equal(lm['Backlog D0'].length,1,'Ignore the prior-day HUB backlog while retaining the current one.');
  assert.equal(lm['Backlog D0'][0].hub_code,otherAllowed.hubCode);
  assert.equal(lm['Backlog D0'][0]['total_backlog D-1'],0);
  assert.equal(lm['LM Backlog D0'][0].backlog_d0,4);
  assert.equal(lm['LM Order Volume D0'][0].pending_inbound,0);
  assert.equal(lm['LM Order Volume D0'][0].fetched_at,day + 'T09:00:00.100001+07:00');

  const hourly = runtime.call('getD0HourlySnapshot',[true]);
  assert.equal(hourly.apiVersion,'d0-hourly-v2');
  assert.equal(hourly.todayForecast,null);
  assert.equal(hourly.sheets['Throughput Hourly D0'].length,1);
  assert.equal(hourly.sheets['Throughput Hourly D0'][0][received],0);
  assert.equal(hourly.sheets['Throughput Hourly D0'][0].fetched_at,day + 'T09:00:00.100002+07:00');
  assert.equal(runtime.call('getD0Snapshot',[true,'hourly']).section,'hourly');

  const {sheets:delivery} = runtime.call('getD0Snapshot',[true,'delivery']);
  assert.equal(delivery['Delivery Progress D0'][0].rider_count,2);
  assert.equal(delivery['Delivery Progress D0'][0][assigned],9);
  const riders = runtime.call('getD0Riders',[hub.hubCode,1,'driver_id','asc',true,'current']);
  assert.equal(riders.total,2);
  assert.equal(riders.rows[0][delivered],0);
  assert.deepEqual(Array.from(riders.rows,row=>row.fetched_at),Array(2).fill(day + 'T09:00:00.100002+07:00'));

  const attendance = runtime.call('getD0Snapshot',[true,'attendance']);
  assert.equal(attendance.attendanceCapabilities.late,false);
  assert.equal(attendance.todayForecast,null);
  assert.equal(attendance.sheets['Roster D0'][0].attendance_pct,80);
  assert.equal(attendance.sheets['Roster Shifts D0'][0].shift_end,day + 'T06:00:00+07:00');
  assert(attendance.sheets['Attendance Hours D0'].some(row => row.hub_code === hub.hubCode && row.hour === 21));

  behavior = 'scope';
  assert(runtime.call('getD0Snapshot',[true,'fm']).sheets['FM Order Volume D0'].every(row => sup.hubCodes.includes(row.hub_code)));
  behavior = 'ok';
  const priorRequests = requests.length;
  assert.throws(() => runtime.call('getD0Riders',[denied.hubCode,1,'','asc',false,'']),/SCOPE/);
  const requireAccess = ctx.requireAccess_;
  ctx.requireAccess_ = () => ({rank:'NORMAL'});
  assert.throws(() => runtime.call('getD0Snapshot',[true,'lm']),/ACCESS_DENIED/);
  assert.throws(() => runtime.call('getD0HourlySnapshot',[false]),/ACCESS_DENIED/);
  ctx.requireAccess_ = requireAccess;
  assert.equal(requests.length,priorRequests);

  behavior = 'empty';
  assert.equal(runtime.call('getD0Snapshot',[true,'fm']).sheets['FM Order Volume D0'].length,0);
  behavior = 'denied';
  assert.throws(() => runtime.call('getD0Snapshot',[true,'fm']),/^Error: D0_SUPABASE_CONFIG$/);
  behavior = 'malformed';
  assert.throws(() => runtime.call('getD0Snapshot',[true,'fm']),/^Error: D0_SUPABASE_UPSTREAM$/);
  behavior = 'failure';
  assert.throws(() => runtime.call('getD0Snapshot',[true,'fm']),/^Error: D0_SUPABASE_UPSTREAM$/);
  behavior = 'ok';
}

assert.deepEqual(new Set(requests.map(request => request.table)),new Set(byTable.keys()));
assert(requests.every(request => !request.patterns.includes(denied.hubName.toLowerCase())));
assert(requests.some(request => request.table === 'delivery_progress_d0'));
const aliasScope = ctx.d0HubAliases_([{code:'A',name:'Collision Hub'}],{stations:[
  {hubCode:'A',hubName:'Collision Hub'}, {hubCode:'B',hubName:'Collision'}
]});
assert(!aliasScope.has('collision'),'An out-of-scope alias collision must fail closed.');
assert.throws(() => ctx.d0SupabaseRows_(byTable.get('fm_order_volume_d0'),{remaining:0,deadline:Date.now()+1000},new Map(),['scope'],false),/D0_SUPABASE_LIMIT/);

const full = runtime.call('getD0Snapshot',[false]);
assert.equal(full.summaryOnly,true);
assert.equal(full.sheets['FM Order Volume D0'][0].Picked,0);
assert.equal(full.sheets['Delivery Progress D0'][0].rider_count,2);

ctx.Session.getActiveUser = activeUser;
behavior = 'freshness';
const hourlyHealth = runtime.call('getSourceHealth',[]).sources.find(source => source.actualSheet === 'throughput_hourly_d0');
assert.equal(hourlyHealth.status,'ACTIVE','Only the newest alias for this HUB determines freshness.');
assert.equal(hourlyHealth.rows,2);
assert.equal(hourlyHealth.checkedHubs,1);
assert.equal(hourlyHealth.lateHubs,0);
behavior = 'empty';
const sourceHealth = runtime.call('getSourceHealth',[]);
const d0Health = sourceHealth.sources.filter(source => source.module === 'D0');
assert.equal(d0Health.length,9);
assert(d0Health.every(source => source.status === 'EMPTY' && byTable.has(source.actualSheet)));
assert(requests.at(-1).requestedFields.every(field => ['station_id','station_name','fetched_at','id'].includes(field)));
behavior = 'denied';
const healthErrors = runtime.call('getSourceHealth',[]).sources.filter(source => source.module === 'D0');
assert(healthErrors.every(source => source.status === 'ERROR' && source.reason === 'D0_SUPABASE_CONFIG'));


// Exercise the real cache implementation with deterministic isolated storage and no live fetch.
{
  const cacheValues=new Map(),cacheTtls=[],cacheExpiry=new Map();let cacheClock=0;
  const cache={get:k=>(cacheExpiry.get(k)||0)>cacheClock?cacheValues.get(k)||null:null,getAll:keys=>Object.fromEntries(keys.filter(k=>cache.get(k)).map(k=>[k,cache.get(k)])),
    put(k,v,ttl){cacheValues.set(k,v);cacheExpiry.set(k,cacheClock+ttl*1000);if(k.startsWith('d0_'))cacheTtls.push(ttl)},putAll(values,ttl){Object.entries(values).forEach(([k,v])=>{cacheValues.set(k,v);cacheExpiry.set(k,cacheClock+ttl*1000)});if(Object.keys(values).some(k=>k.startsWith('d0_')))cacheTtls.push(ttl)},remove:k=>cacheValues.delete(k)};
  ctx.CacheService.getScriptCache=()=>cache;
  ctx.Session.getActiveUser=()=>({getEmail:()=>sup.email});
  const start=requests.length;
  behavior='ok';
  const initial=runtime.call('getD0Snapshot',[false,'delivery']);
  const cold=requests.length-start;
  const batches=ctx.d0SupabaseStationFilters_(ctx.d0HubAliases_(ctx.deployHubCatalog_(ctx.requireAccess_(['d0']),permission),permission)).length;
  assert(cold>=batches);assert(requests.slice(start).every(r=>r.cursor===null),'Each alias batch stops after its short page');
  assert.equal(initial.sheets['Delivery Progress D0'][0].rider_count,2);
  runtime.call('getD0Snapshot',[false,'delivery']);
  const details=runtime.call('getD0Riders',[hub.hubCode,1,'driver_id','asc',false,'current']);
  assert.equal(details.total,2);
  assert.equal(requests.length-start,cold,'Summary, repeat summary and detail reuse one raw scoped read');
  assert(details.rows.every(row=>row.driver_name && row.hub_code===hub.hubCode));
  assert(!requests.at(-1).requestedFields.includes('lm_hub_fleet_delivered_pct_eod'),'Unused percentage is not transferred');
  const cacheCount=cacheValues.size;
  behavior='empty';
  runtime.call('getD0Snapshot',[true,'delivery']);
  const afterForce=requests.length;
  assert.equal(runtime.call('getD0Snapshot',[false,'delivery']).sheets['Delivery Progress D0'].length,0);
  assert.equal(requests.length,afterForce,'Forced successful empty replaces prior nonempty cache');
  assert(cacheValues.size>cacheCount);
  behavior='denied';
  assert.throws(()=>runtime.call('getD0Snapshot',[true,'delivery']),/D0_SUPABASE_CONFIG/);
  const afterFailedForce=requests.length;
  assert.throws(()=>runtime.call('getD0Snapshot',[false,'delivery']),/D0_SUPABASE_CONFIG/);
  assert.equal(requests.length,afterFailedForce+1,'Failed force cannot reveal an old cached empty success');
  behavior='ok';
  runtime.call('getD0Snapshot',[false,'delivery']);
  // An evicted chunk must trigger a complete read rather than a partial success.
  const manifest=[...cacheValues.keys()].find(k=>k.startsWith('d0_sb_v2:delivery_progress_d0:')&&!k.slice('d0_sb_v2:delivery_progress_d0:'.length).includes(':'));
  cacheValues.delete(JSON.parse(cacheValues.get(manifest))[0]);
  const beforeEviction=requests.length;
  runtime.call('getD0Snapshot',[false,'delivery']);
  assert.equal(requests.length,beforeEviction+cold);
  assert(cacheTtls.every(ttl=>ttl===60),'Server cache agrees with the client freshness window');

  const cfg={base:'https://synthetic-d0.supabase.co/rest/v1/'};
  const catalog=[{code:'same-prefix-'.repeat(4)+'A',name:'First',zone:'1',aom:[],sup:[]}];
  const other=[{...catalog[0],code:'same-prefix-'.repeat(4)+'B'}];
  assert.notEqual(ctx.d0ScopeCacheKey_(cfg,catalog),ctx.d0ScopeCacheKey_(cfg,other));
  assert.notEqual(ctx.d0ScopeCacheKey_(cfg,catalog),ctx.d0ScopeCacheKey_(cfg,[{...catalog[0],zone:'2'}]));
  const foreignAlias=new Map([['first',catalog[0]]]);
  assert.notEqual(ctx.d0ScopeCacheKey_(cfg,catalog,foreignAlias),ctx.d0ScopeCacheKey_(cfg,catalog,new Map()));
  // Real API identities use different scope caches, even when requesting the same feed.
  const beforeScope=requests.length;
  ctx.Session.getActiveUser=activeUser;
  runtime.call('getD0Snapshot',[false,'delivery']);
  assert(requests.length>beforeScope);
  const afterAdminScope=requests.length;
  ctx.Session.getActiveUser=()=>({getEmail:()=>sup.email});
  runtime.call('getD0Snapshot',[false,'delivery']);
  assert.equal(requests.length,afterAdminScope);

  cacheClock+=61000;
  const expired=requests.length;runtime.call('getD0Snapshot',[false,'delivery']);
  assert.equal(requests.length,expired+cold,'Expired data must be read again');
  const large={payload:require('node:crypto').randomBytes(160000).toString('base64')};
  ctx.d0CacheWrite_('d0_chunk_test',large);
  assert(JSON.parse(cacheValues.get('d0_chunk_test')).length>1);
  assert.equal(ctx.d0CacheRead_('d0_chunk_test').payload,large.payload);
  ctx.d0CacheWrite_('d0_chunk_test',[]);
  assert.equal(ctx.d0CacheRead_('d0_chunk_test').length,0,'A small replacement cannot reuse a previous chunk generation');

  const nativeFetch=ctx.UrlFetchApp.fetch,nativeConsole=ctx.console,diagnostics=[];
  ctx.console={...console,warn:text=>diagnostics.push(JSON.parse(text))};
  let calls=0;
  function fail(status,text){calls=0;ctx.UrlFetchApp.fetch=()=>{calls++;return {getResponseCode:()=>status,getContentText:()=>text}};}
  const read=()=>ctx.d0SupabaseRows_(byTable.get('fm_order_volume_d0'),{...cfg,key:'not-a-live-key',remaining:20,deadline:Date.now()+1000},new Map(),['station_name=eq.Synthetic'],false);
  fail(400,JSON.stringify({code:'42703',message:'private payload and URL'}));
  assert.throws(read,/D0_SUPABASE_UPSTREAM/);assert.equal(calls,1);
  assert.deepEqual(diagnostics.at(-1),{code:'D0_SUPABASE_UPSTREAM',relation:'fm_order_volume_d0',kind:'http',status:400,upstreamCode:'42703'});
  fail(404,JSON.stringify({code:'PGRST205'}));assert.throws(read,/UPSTREAM/);assert.equal(calls,1);
  fail(200,'not json private');assert.throws(read,/UPSTREAM/);assert.equal(calls,1);assert.equal(diagnostics.at(-1).kind,'json');
  fail(200,'{}');assert.throws(read,/UPSTREAM/);assert.equal(calls,1);assert.equal(diagnostics.at(-1).kind,'shape');
  fail(200,'[{"station_id":1}]');assert.throws(read,/UPSTREAM/);assert.equal(calls,1);assert.equal(diagnostics.at(-1).kind,'schema');
  fail(503,JSON.stringify({code:'private payload'}));assert.throws(read,/UPSTREAM/);assert.equal(calls,3);
  calls=0;ctx.UrlFetchApp.fetch=()=>{calls++;throw Error('private transport URL')};
  assert.throws(read,/UPSTREAM/);assert.equal(calls,3);assert.equal(diagnostics.at(-1).kind,'transport');
  assert(!JSON.stringify(diagnostics).includes('private'));
  // Full-page pagination still reads the next page; a short last page stops immediately.
  calls=0;
  const projection=['station_id','station_name','fetched_at',...byTable.get('fm_order_volume_d0').fields.split(',')];
  ctx.UrlFetchApp.fetch=()=>{calls++;return response(200,calls===1?Array.from({length:500},(_,i)=>Object.fromEntries(projection.map(f=>[f,f==='station_id'?i:f==='station_name'?'Synthetic':f==='fetched_at'?stamp:null]))):[])};
  assert.equal(read().length,0);assert.equal(calls,2);
  ctx.UrlFetchApp.fetch=nativeFetch;ctx.console=nativeConsole;

  // Forecast cache is partitioned by exact HUB catalog and force updates it.
  let forecastCalls=0;
  ctx.UrlFetchApp.fetch=()=>{forecastCalls++;return response(200,[{hub_code:'A',fm_forecast:0,lm_forecast:null},{hub_code:'B',fm_forecast:20,lm_forecast:30}])};
  const forecastA=[{code:'A',name:'Alpha'}],forecastB=[{code:'B',name:'Beta'}];
  assert.equal(ctx.d0TodayForecastFromSupabase_(cfg,forecastA,day,false).byHub.A.fm,null);
  assert.equal(ctx.d0TodayForecastFromSupabase_(cfg,forecastA,day,false).lmForecast,null);
  const onlyB=ctx.d0TodayForecastFromSupabase_(cfg,forecastB,day,false);
  assert.deepEqual(Object.keys(onlyB.byHub),['B']);assert.equal(onlyB.byHub.B.fm,20);assert.equal(forecastCalls,2);
  ctx.d0TodayForecastFromSupabase_(cfg,forecastB,day,true);assert.equal(forecastCalls,3);
  ctx.d0TodayForecastFromSupabase_(cfg,forecastB,day,false);assert.equal(forecastCalls,3);

  const noPlan = { code:'C', name:'Synthetic Bulky Facility' };
  const fullScope = [...forecastA, ...forecastB, noPlan];
  const forecastUrls = [];
  ctx.UrlFetchApp.fetch = url => {
    forecastUrls.push(url);
    return response(200, [{ hub_code:'A', fm_forecast:0, lm_forecast:10 }, { hub_code:'B', fm_forecast:null, lm_forecast:30 }]);
  };
  const supabasePlan = ctx.d0TodayForecastFromSupabase_(cfg,fullScope,day,true);
  assert.equal(supabasePlan.byHub.A.fm,null,'A legacy Supabase zero is ambiguous until the exact source cell confirms it');
  assert.equal(supabasePlan.byHub.B.fm,null);
  assert.equal(supabasePlan.byHub.C.lm,null,'An unmatched facility does not get a default zero');
  assert.equal(supabasePlan.fmForecast,null);
  assert.equal(supabasePlan.lmForecast,null);
  assert.equal(ctx.d0TodayForecastFromSupabase_(cfg,[...forecastA,...forecastB],day,true).lmForecast,40);
  ctx.UrlFetchApp.fetch = url => {
    forecastUrls.push(url);
    return response(200, []);
  };
  assert.equal(ctx.d0TodayForecastFromSupabase_(cfg,fullScope,yesterday,true),null);
  assert.equal(forecastUrls.length,3);
  assert(forecastUrls.every(url => url.includes('/forecast_daily?plan_date=eq.')), 'The coalesced summary view cannot validate zero');

  const props = { getProperty: () => null };
  const workbook = { getId: () => 'synthetic-workbook', getSheets: () => sheets };
  const matrix = (name, data) => ({
    getName: () => name, getParent: () => workbook,
    getDataRange: () => ({ getValues: () => data })
  });
  const sheets = [
    matrix('FC T1026', [['HUB',day],['','#FM Forecast'],['Alpha',0],['Beta','']]),
    matrix('FC T1126', [['HUB',day],['','#LM Forecast'],['Alpha','1,000'],['Beta',40]])
  ];
  const workbookPlan = ctx.d0TodayForecastFromWorkbook_(props,workbook,fullScope,day,true);
  assert.equal(workbookPlan.byHub.A.fm,0,'A literal workbook zero is a plan');
  assert.equal(workbookPlan.byHub.B.fm,null,'A blank workbook cell stays missing');
  assert.equal(workbookPlan.byHub.C.fm,null);
  assert.equal(workbookPlan.byHub.A.lm,1000);
  assert.equal(workbookPlan.byHub.B.lm,40);
  assert.equal(workbookPlan.fmForecast,null);
  assert.equal(ctx.d0TodayForecastFromWorkbook_(props,workbook,fullScope,yesterday,true),null,'The workbook fallback requires the exact day');

  const callsBeforeForeign = forecastUrls.length;
  ctx.UrlFetchApp.fetch = url => {
    forecastUrls.push(url);
    return response(200,[{hub_code:'foreign',hub_name:'Alpha',fm_forecast:735}]);
  };
  assert.equal(ctx.d0TodayForecastFromSupabase_(cfg,forecastA,day,true),null);
  assert.equal(ctx.d0TodayForecastFromSupabase_(cfg,forecastA,day,false),null);
  assert.equal(forecastUrls.length,callsBeforeForeign+2,'A reply without any authorized match must stay out of cache');

  const collisionCatalog = [{code:'A',name:'Collision Hub'}];
  const permissions = {stations:[{hubCode:'A',hubName:'Collision Hub'},{hubCode:'B',hubName:'Collision'}]};
  const sharedNames = ctx.d0HubAliases_(collisionCatalog,permissions);
  ctx.UrlFetchApp.fetch = () => response(200,[{hub_code:'',hub_name:'Collision Hub',fm_forecast:735}]);
  assert.equal(ctx.d0TodayForecastFromSupabase_(cfg,collisionCatalog,day,true,sharedNames),null);
  ctx.UrlFetchApp.fetch = () => response(200,[{hub_code:' a ',hub_name:'Collision Hub',fm_forecast:21}]);
  assert.equal(ctx.d0TodayForecastFromSupabase_(cfg,collisionCatalog,day,true,sharedNames).byHub.A.fm,21);
  ctx.UrlFetchApp.fetch = () => response(200,[{hub_code:' ',hub_name:'Alpha Hub',fm_forecast:27}]);
  assert.equal(ctx.d0TodayForecastFromSupabase_(cfg,forecastA,day,true).byHub.A.fm,27,'A unique name resolves when the source omits the code');

  const readWorkbook = () => workbookPlan;
  ctx.UrlFetchApp.fetch = () => response(200,[{hub_code:'A',fm_forecast:0,lm_forecast:10},{hub_code:'B',fm_forecast:0,lm_forecast:0}]);
  const reconciled = ctx.d0TodayForecastFromSupabase_(cfg,fullScope,day,true,undefined,readWorkbook);
  assert.equal(reconciled.byHub.A.fm,0,'The original cell confirms this zero');
  assert.equal(reconciled.byHub.A.lm,10,'A confirmed positive Supabase quantity is kept');
  assert.equal(reconciled.byHub.B.fm,null,'A blank cell leaves the legacy zero ambiguous');
  assert.equal(reconciled.byHub.B.lm,40,'Use the verified positive cell for a defaulted Supabase value');
  const noOriginal = ctx.d0TodayForecastFromSupabase_(cfg,fullScope,day,false);
  assert.equal(noOriginal.byHub.A.fm,null,'The Supabase cache cannot certify a zero by itself');
  const stale = () => ({...workbookPlan,date:yesterday});
  assert.equal(ctx.d0TodayForecastFromSupabase_(cfg,fullScope,day,false,undefined,stale).byHub.A.fm,null);
  const unavailable = () => { throw Error('Synthetic workbook unavailable'); };
  const withoutWorkbook = ctx.d0TodayForecastFromSupabase_(cfg,fullScope,day,false,undefined,unavailable);
  assert.equal(withoutWorkbook.byHub.A.fm,null);
  assert.equal(withoutWorkbook.byHub.A.lm,10,'Workbook unavailability preserves independently known plans');

  ctx.UrlFetchApp.fetch=nativeFetch;
  const serializedBytes=Buffer.byteLength(JSON.stringify(details.rows));
  const summaryBytes=Buffer.byteLength(JSON.stringify(initial.sheets['Delivery Progress D0']));
  console.log('D0 synthetic evidence: delivery cold='+cold+' requests; warm summary+detail=0 requests; forced empty warm=0 requests; detail bytes='+serializedBytes+'; summary bytes='+summaryBytes+'.');
}

ctx.ScriptApp.getScriptId = () => 'synthetic-production-id';
delete config.D0_SUPABASE_URL;
delete config.D0_SUPABASE_SECRET_KEY;
assert.throws(() => runtime.call('getD0Snapshot',[true,'fm']),/^Error: D0_SUPABASE_CONFIG$/);
console.log('PASS: D0 Supabase projections, snapshot boundaries, paging, empty/errors, scoped APIs, and source health.');
