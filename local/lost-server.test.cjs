const assert = require('node:assert/strict');
const vm = require('node:vm');
const {read} = require('./source.cjs');

const stations = [
  {hubCode:'A',hubName:'Depot A Hub',stationName:'Shared Hub'},
  {hubCode:'B',hubName:'Depot B Hub',stationName:'Shared'},
  {hubCode:'C',hubName:'Depot C Hub'}
];
const account = {allowed:true,rank:'SUP',hubCodes:['A','C'],customAccess:true,allowedPages:['compensated','dashboard']};
const testKey = 'sb_secret_synthetic-fixture';
const fixture = 'FIXTURE-PRIVATE-FIELD';
const calls = [];
let activeEmail = 'staff@example.test', key = testKey, enabled = true, signedOut = false;
let legacyReads = 0;
let responses = [];
const cache = new Map();
let rawRows = [['date','station','reason','shipment','amount'],['2026-11-17','Depot A Hub','Demo','LEGACY-ROW',20]];
let pivotRows = null;
let failedLegacyRead = false;
function sheet(rows){
  return {getLastRow:()=>rows.length,getLastColumn:()=>rows[0].length,
    getDataRange:()=>({getValues:()=>rows}),getRange:(row,col,height,width)=>({
      getValues:()=>{
        if(row>=2&&failedLegacyRead)throw Error(fixture);
        return rows.slice(row-1,row-1+height).map(line=>Array.from({length:width},(_,i)=>line[col-1+i]??''));
      }
    })};
}
const context = vm.createContext({
  APP:{CITY_VALUE:'HCM_CITY'},
  Session:{getActiveUser:()=>({getEmail:()=>activeEmail})},
  normalizeEmail_:email=>email.toLowerCase(),
  workspaceSignedOut_:()=>signedOut,
  getUserAccessByEmail_:email=>email==='staff@example.test'?account:{allowed:false},
  PropertiesService:{getScriptProperties:()=>({getProperty:name=>{
    assert.ok(['FLM_TEAM_ENABLED','SUPABASE_LOST_SECRET_KEY','LOST_DB_SHEET_ID'].includes(name));
    return name==='SUPABASE_LOST_SECRET_KEY'?key:null;
  }})},
  Utilities:{formatDate:()=> '2026-11-18'},
  getModuleNavigationSettings_:()=>({modules:{compensated:{enabled}}}),
  moduleRuleMatchesAccess_:rule=>rule.enabled,
  getPermissionModel_:()=>({stations}),
  cleanText_:String,
  normalizeCompare_:String,
  normalizeOrgType_:type=>String(type||'CITY').toUpperCase(),
  buildScopeContext_:()=>({enabled:{CITY:true},options:{CITY:[{value:'HCM_CITY'}]}}),
  intersectHubCodes_:(a,b)=>a.filter(code=>b.includes(code)),
  getSecurityVersion_:()=>1,
  CacheService:{getScriptCache:()=>({get:key=>cache.get(key),put:(key,value)=>cache.set(key,value)})},
  SpreadsheetApp:{openById:()=>({
    getSheetByName(name){
      if(name==='LOST_PIVOT')return pivotRows&&sheet(pivotRows);
      if(name!=='LOST')return null;
      legacyReads++;
      return rawRows&&sheet(rawRows);
    },
    getSheets:()=>[]
  })},
  UrlFetchApp:{fetch(url,options){
    calls.push({url:new URL(url),options});
    assert.ok(responses.length,'Unexpected upstream request');
    const next = responses.shift();
    if(next instanceof Error)throw next;
    return {getResponseCode:()=>next.status,getContentText:()=>{
      assert.equal(next.status,200,'Error responses must not be read');
      return typeof next.body==='string'?next.body:JSON.stringify(next.body);
    }};
  }}
});

const code = read('Code.gs');
for(const name of ['getActiveEmail_','requireAccess_','assertPageAccess_','assertScopeAccess_']){
  const start = code.indexOf(`function ${name}(`);
  assert.ok(start>=0,name);
  const end = code.indexOf('\n}',start)+2;
  vm.runInContext(code.slice(start,end),context);
}
vm.runInContext(read('FLMModule.gs'),context);

const request = {scopeType:'CITY',scopeValue:'HCM_CITY',selectedHubCodes:['A'],from:'2026-11-01',to:'2026-11-17'};
const report = extra=>context.flmTeamGetLostReport({...request,...extra});
const metadata = module=>context.flmTeamGetLostSourceStatus({...request,module});
const assertError = (result,code)=>assert.equal(JSON.stringify(result),JSON.stringify({error:code}));
const ok = body=>({status:200,body});
const row = (hub,date='2026-11-17',fields={})=>({hub,ngay_chot:date,spx_tracking:'FIXTURE-ORDER',...fields});

activeEmail = '';
assertError(report({email:'staff@example.test'}),'LOST_ACCESS');
activeEmail = 'other@example.test';
assertError(report({email:'staff@example.test'}),'LOST_ACCESS');
activeEmail = 'staff@example.test';
signedOut = true;
assertError(report(),'LOST_ACCESS');
signedOut = false;
enabled = false;
assertError(report(),'LOST_ACCESS');
enabled = true;
assertError(report({scopeType:'HUB',scopeValue:'B'}),'LOST_ACCESS');
assertError(report({selectedHubCodes:['A','B']}),'LOST_ACCESS');
account.allowedPages = ['dashboard'];
assertError(report({module:'snapshot'}),'LOST_ACCESS');
account.allowedPages = ['compensated'];
assertError(metadata('snapshot'),'LOST_ACCESS');
assertError(metadata('not-a-page'),'LOST_ACCESS');
account.allowedPages = ['dashboard','compensated'];
for(const bad of [{from:'2026-02-29'},{from:'2026-11-17',to:'2026-11-16'},{from:'2026-10-01'},{from:'0000-11-01'},
  {to:'2026-11-18'},{to:'2026-11-17T00:00:00Z'},{from:['2026-11-01']},{from:'2026-11-01&select=*'}]){
  assertError(report(bad),'LOST_RANGE');
}
for(const invalid of [null,'sb_secret_','sb_publishable_fixture','sb_secret_fixture\nleak','placeholder']){
  key=invalid;
  assertError(report(),'LOST_CONFIG');
}
assert.equal(calls.length,0,'Denials and invalid configuration never call Supabase');
key=testKey;

responses = [ok([row('Depot B'),row('Shared Hub'),row('Depot'),row('Depot C'),row('Depot A','2026-11-31'),row('Depot A','2026-10-31')]),
  ok([row(' depot  a HUB ','2026-11-17',{last_user:'staff@example.test',cod_cogs:123,unexpected:fixture})]),ok([])];
const details = report({url:'https://other.example.test',table:'other',select:'*',key:'caller-key'});
assert.equal(details.rows.length,1);
assert.equal(details.rows[0].hubCode,'A');
assert.equal(details.rows[0].last_user,'staff@example.test');
assert.equal(details.rows[0].unexpected,undefined);
assert.deepEqual(calls.map(c=>c.url.searchParams.get('offset')),['0','6','7']);
for(const {url,options} of calls){
  assert.equal(url.hostname,'aqvcybxcfgicxmzpczgd.supabase.co');
  assert.equal(url.pathname,'/rest/v1/lost_orders');
  assert.equal(url.searchParams.get('order'),'ngay_chot.desc,spx_tracking.asc');
  assert.deepEqual(url.searchParams.getAll('ngay_chot'),['match.^[0-9]{4}-[0-9]{2}-[0-9]{2}$','gte.2026-11-01','lte.2026-11-17']);
  assert.equal(url.searchParams.get('limit'),'1000');
  assert.deepEqual(Object.keys(options.headers),['apikey']);
  assert.ok(options.headers.apikey===testKey);
  assert.equal(options.followRedirects,false);
  assert.equal(options.muteHttpExceptions,true);
}

account.rank='AOM';
responses = [ok([row('Depot A','2026-11-17',{last_user:fixture,rider:fixture,ly_do:fixture,cod_cogs:1800000,so_tien_den_bu:0,last_status_spx:'LMHub_Delivered'}),
  row('Depot A','2026-11-16',{ly_do:'Đơn hàng mất tại Hub',log_loi_cuoi:{amount:200},trang_thai_he_thong:'Order marked as missing'}),row('Depot B')]),ok([])];
const aggregate=report({details:true});
assert.equal(aggregate.rows,undefined);
assert.doesNotMatch(JSON.stringify(aggregate),/FIXTURE|last_user|spx_tracking|log_loi_cuoi/);
assert.doesNotMatch(calls.at(-1).url.searchParams.get('select'),/last_user|rider|spx_tracking/);
assert.equal(aggregate.summary.total.n,2);
assert.equal(aggregate.summary.total.amount,200);
assert.equal(aggregate.summary.hubStats[0].hvOrders,1);
assert.equal(aggregate.summary.hubStats[0].hvCogs,1800000);
assert.equal(aggregate.summary.hubStats[0].lm,1);
assert.equal(aggregate.summary.hubStats[0].eha,1);
assert.deepEqual(Array.from(aggregate.summary.reasons,r=>r.reason),['Lý do khác','Đơn hàng mất tại Hub']);
assert.deepEqual(Array.from(aggregate.summary.series,r=>r.date),['2026-11-16','2026-11-17']);

account.allowedPages=['dashboard'];
responses = [ok([row('Depot B')]),ok([row('Depot A','2026-11-16',{rider:fixture})])];
assert.equal(JSON.stringify(metadata('snapshot')),'{"latestDate":"2026-11-16"}');
assert.equal(calls.at(-1).url.searchParams.get('select'),'ngay_chot,hub');
assert.equal(calls.at(-1).url.searchParams.get('offset'),'1');
assertError(metadata('compensated'),'LOST_ACCESS');
assert.equal(context.flmTeamGetHubOrders({...request,hubCode:'A'}).lost.length,0);
assert.equal(legacyReads,0);
account.allowedPages=['dashboard','compensated'];
assert.equal(context.flmTeamGetHubOrders({...request,hubCode:'A'}).lost.length,0);
assert.equal(legacyReads,0);

account.rank='SUP';
assert.equal(context.flmTeamGetHubOrders({...request,hubCode:'A'}).lost[0].shipmentId,'LEGACY-ROW');
for(const [response,expected] of [[{status:302,body:fixture},'LOST_UPSTREAM'],[{status:401,body:fixture},'LOST_CONFIG'],
  [{status:500,body:fixture},'LOST_UPSTREAM'],[ok(fixture),'LOST_UPSTREAM'],[new Error(fixture),'LOST_UPSTREAM']]){
  responses=[response];
  assertError(report(),expected);
}
responses=[ok([row('Depot A')]),ok([])];
assert.equal(report().rows.length,1,'Retry makes a fresh query after upstream failures');

const client=read('Javascript.html').replace(/\r\n/g,'\n');
assert.doesNotMatch(client,/\bFLM_(?:SUPABASE|FIREBASE)_SAMPLE\b/);
for(const name of ['flmResolveLostReason_','flmResolveLostAmount_','flmNormalizeLostRow_','flmLostLocalRows_','flmRunClientBenchmark_','flmRunGasBenchmark_']){
  const start=client.indexOf(`function ${name}(`);
  assert.ok(start>=0,name);
  vm.runInContext(client.slice(start,client.indexOf('\n}',start)+2),context);
}
for(const fields of [
  {ly_do:'Đền bù',log_loi_cuoi:'{}',loai_yeu_cau:'Đơn hàng mất tại Hub',so_tien_den_bu:0},
  {log_loi_cuoi:'{"reason":"Chưa ghi lý do","error":"missing","amount":25}',cod_cogs:5},
  {ly_do:'   ',log_loi_cuoi:{error:'missing',amount:'Infinity',cogs:25}},
  {log_loi_cuoi:'404',cod_cogs:'40'},
  {log_loi_cuoi:'[]',so_tien_den_bu:'-5'},
  {log_loi_cuoi:{reason:false,error:'missing',amount:20},loai_yeu_cau:12},
  {log_loi_cuoi:' ',so_tien_den_bu:' ',cod_cogs:0}
]){
  const input=row('Depot A','2026-11-17',fields);
  const summary=context.flmLostReportValues_(input),detail=context.flmNormalizeLostRow_(input,false);
  assert.equal(summary.reason,detail.reason);
  assert.equal(summary.amount,detail.amount);
  assert.equal(summary.cogs,detail.cogs);
}
context.window={};
context.performance={now:()=>0};
context.flmLostRange_=()=>({from:'2026-11-01',to:'2026-11-17',key:'active'});
context.flmGetScopeInfo_=()=>({allowedNodes:[{value:'A',label:'Depot A'}]});
context.volumeShift_=context.flmTeamShift_;
assert.equal(context.flmLostLocalRows_(context.flmLostRange_())[0].spx_tracking,'DEMO-LOST-1');
assert.equal(context.flmRunClientBenchmark_(),'0.00');
context.flmLostRange_=()=>null;
assert.equal(context.flmRunClientBenchmark_(),null);
context.flmRunGasBenchmark_((err,time)=>assert.equal(time,null,'Unavailable RPC cannot supply a fabricated time'));

pivotRows=[['date','station','reason','count','amount'],
  ['2026-11-17','Depot B',fixture,7,900],['2026-11-17','Shared',fixture,5,800],
  ['2026-11-17','Depot',fixture,3,600],['2026-11-16','Depot  A Hub',fixture,2,40],
  ['16/11/2026','A','Đơn hàng mất tại Hub',1,10],['2026-11-15','A',fixture,1,30],
  ['2026-11-17','Depot C',fixture,4,100],['2026-11-18','A',fixture,1,100],['2026-11-31','A',fixture,1,100]];
const dashboardRequest={...request,anchorDate:'2026-11-18',tab:'lost'};
const statusRequest={...request,module:'snapshot'};
account.allowedPages=['dashboard'];
const stats=context.flmTeamGetSourceStatus(statusRequest).sources.find(s=>s.id==='lost');
assert.deepEqual(Array.from(stats.dates),['2026-11-15','2026-11-16']);
assert.equal(stats.rows,2,'Only scoped source rows on the latest reported date contribute');
assert.equal(stats.reportingHubs,1);
assert.equal(context.flmTeamGetSourceStatus({...statusRequest,selectedHubCodes:['C']}).sources.find(s=>s.id==='lost').latestDate,'2026-11-17');
const legacyAggregate=context.flmTeamGetClaims(dashboardRequest).lost;
assert.equal(legacyAggregate.total.n,4);
assert.equal(legacyAggregate.total.amount,80);
assert.deepEqual(Array.from(legacyAggregate.reasons,r=>r.reason),['Lý do khác','Đơn hàng mất tại Hub']);
assert.doesNotMatch(JSON.stringify(legacyAggregate),/FIXTURE|shipmentId/);
assert.equal(context.flmTeamGetHubOrders({...dashboardRequest,hubCode:'A'}).lost.length,0,'Dashboard-only detail roles receive no Lost orders');

const desk=context.flmTeamContext_('compensated',dashboardRequest);
const lossRate=context.flmParseLossRateRows_([['Station','2026-11'],['A','0.1%'],['Shared','98%'],['Depot','97%']],desk.closing,desk.masterAliases);
assert.deepEqual(Object.keys(lossRate),['A']);
assert.equal(lossRate.A.formatted,'0.1%');
rawRows=null;
cache.set(context.flmLostMasterKey_(desk),JSON.stringify([
  {hubCode:'A',station:'Shared',d:'2026-11-17',reason:fixture,n:1,amount:99},
  {hubCode:'A',station:'Depot B',d:'2026-11-17',reason:fixture,n:1,amount:99},
  {hubCode:'A',station:'Depot A',d:'2026-11-17',reason:'Scoped cached row',n:1,amount:10}
]));
account.allowedPages=['compensated','dashboard'];
const cachedDetails=context.flmTeamGetHubOrders({...dashboardRequest,hubCode:'A',force:true}).lost;
assert.equal(cachedDetails.length,1);
assert.equal(cachedDetails[0].reason,'Scoped cached row');
assert.equal(cachedDetails[0].shipmentId,'—');

cache.clear();
pivotRows=null;
context.flmTeamMetadata_=()=>({revision:'fixture'});
context.flmTeamQuery_=(sql,ctx)=>{
  const aliases=Array.from(ctx.params.find(p=>p.name==='stations').parameterValue.arrayValues,p=>p.value);
  if(!sql.includes('flm_lost_current'))return [];
  if(sql.includes('SELECT shipment_id')){
    assert.deepEqual(aliases.sort(),['A','DEPOT A']);
    return [{station:'Shared',shipment_id:fixture,d:'2026-11-17',amt:200},
      {station:'Depot C',shipment_id:fixture,d:'2026-11-17',amt:300},
      {station:'Depot A',shipment_id:'BQ-SCOPED',d:'2026-11-17',amt:0}];
  }
  return [{station:'Shared',d:'2026-11-17',reason:fixture,n:1,amount:200},
    {station:'Depot',d:'2026-11-17',reason:fixture,n:1,amount:300},
    {station:'Depot A',d:'2026-11-16',reason:fixture,n:1,amount:10}];
};
const bqAggregate=context.flmTeamGetClaims({...dashboardRequest,force:true}).lost;
assert.equal(bqAggregate.total.amount,10);
assert.equal(bqAggregate.reasons[0].reason,'Lý do khác');
const bqDetails=context.flmTeamGetHubOrders({...dashboardRequest,selectedHubCodes:['A','C'],hubCode:'A',force:true}).lost;
assert.equal(bqDetails.length,1);
assert.equal(bqDetails[0].shipmentId,'BQ-SCOPED');
assert.equal(bqDetails[0].amount,0);

const beforeBudget=calls.length;
responses=Array.from({length:100},()=>ok([row('Depot B')]));
assertError(metadata('snapshot'),'LOST_UPSTREAM');
assert.equal(calls.length,beforeBudget+100,'Out-of-scope pages hit an explicit budget failure');
console.log('PASS: Lost server identity, page and HUB access, metadata, aggregate-only responses, date and key validation, pagination, safe errors, and retry.');
console.log('PASS: Legacy Lost source stats, snapshot and fallback detail enforce unique aliases and scoped shapes, with detail and aggregate normalization parity.');

cache.clear();
rawRows = [['date','station','reason','shipment','amount'],['2026-11-17','Depot A Hub','Fallback','LEGACY-DURING-OUTAGE',20]];
account.rank = 'SUP';
const beforeScoped = calls.length;
const beforeLegacy = legacyReads;
const orderRequest = {...dashboardRequest,selectedHubCodes:['A','C'],hubCode:'A',force:true};
responses = [
  ok([row('Depot A Hub','2026-11-17',{spx_tracking:'NEW-01',so_tien_den_bu:0,cod_cogs:700,ly_do:'Scoped reason'}),
    row('Depot C','2026-11-17',{spx_tracking:'NEW-02',so_tien_den_bu:999})]),
  ok([row('Depot A','2026-11-16',{spx_tracking:'NEW-03',so_tien_den_bu:null,cod_cogs:1500,last_user:fixture})]),
  ok([])
];
const scopedOrders = context.flmTeamGetHubOrders(orderRequest).lost;
assert.deepEqual(Array.from(scopedOrders,item=>[item.shipmentId,item.amount]),[['NEW-01',0],['NEW-03',null]]);
assert.doesNotMatch(JSON.stringify(scopedOrders),/FIXTURE|cod_cogs|last_user/);
assert.equal(legacyReads,beforeLegacy);
const [initialScope,cursorScope] = calls.slice(beforeScoped).map(call=>call.url);
assert.equal(initialScope.searchParams.get('select'),'spx_tracking,ngay_chot,hub,ly_do,so_tien_den_bu');
assert.match(initialScope.searchParams.get('hub'),/ilike\(any\)\.\{.*DEPOT A/);
assert.doesNotMatch(initialScope.searchParams.get('hub'),/DEPOT (?:B|C)|SHARED/i);
assert.deepEqual(cursorScope.searchParams.getAll('spx_tracking'),['neq.','gt.NEW-02']);
assert.equal(initialScope.searchParams.get('order'),'spx_tracking.asc');

responses = [ok([])];
assert.equal(context.flmTeamGetHubOrders(orderRequest).lost.length,0,'Complete Supabase empty is authoritative.');
assert.equal(legacyReads,beforeLegacy);

responses = [ok([row('Depot A','2026-11-17',{spx_tracking:'PARTIAL'})]),{status:503,body:fixture}];
const fallbackOrders = context.flmTeamGetHubOrders(orderRequest).lost;
assert.deepEqual(Array.from(fallbackOrders,item=>item.shipmentId),['LEGACY-DURING-OUTAGE']);
assert.doesNotMatch(JSON.stringify(fallbackOrders),/PARTIAL|FIXTURE/);

const scopedStatus = () => context.flmTeamGetSourceStatus({
  ...statusRequest,selectedHubCodes:['A','C'],force:true
}).sources.find(source=>source.id==='lost');
responses = [
  ok([row('Depot A','2026-11-16',{spx_tracking:'STATUS-01'}),
    row('Shared','2026-11-17',{spx_tracking:'STATUS-02',created_at:'2026-11-18T01:00:00Z'})]),
  ok([row('A','2026-11-17',{spx_tracking:'STATUS-03',created_at:'2026-11-17T03:00:00Z'}),
    row('Depot C Hub','2026-11-17',{spx_tracking:'STATUS-04',created_at:'2026-11-17T04:00:00Z'})]),
  ok([])
];
const statusAfterCutover = scopedStatus();
assert.equal(statusAfterCutover.status,'AVAILABLE');
assert.deepEqual(Array.from(statusAfterCutover.dates),['2026-11-16','2026-11-17']);
assert.equal(statusAfterCutover.rows,2);
assert.equal(statusAfterCutover.reportingHubs,2);
assert.equal(statusAfterCutover.expectedHubs,2);
assert.equal(statusAfterCutover.latestAt,'2026-11-17T04:00:00.000Z');
assert.doesNotMatch(JSON.stringify(statusAfterCutover),/STATUS-0|Shared/);
assert.equal(calls.at(-1).url.searchParams.get('select'),'spx_tracking,ngay_chot,hub,created_at');

responses = [ok([])];
assert.equal(scopedStatus().status,'EMPTY');
responses = [ok([row('A','2026-11-17',{spx_tracking:'DUP'})]),ok([row('A','2026-11-17',{spx_tracking:'DUP'})])];
assert.equal(scopedStatus().reportingHubs,1,'Repeated page keys discard the partial result and recover via Sheets.');

let beforeDenied = calls.length;
assert.throws(()=>context.flmTeamGetHubOrders({...orderRequest,hubCode:'B'}),/HUB_ACCESS_DENIED/);
account.rank = 'AOM';
assert.equal(context.flmTeamGetHubOrders(orderRequest).lost.length,0,'AOM detail policy still applies before Supabase.');
assert.equal(calls.length,beforeDenied);
console.log('PASS: Scoped Lost compatibility status and detail use verified fields, retain nulls, and distinguish complete empty from fallback.');

cache.clear();
pivotRows = null;
rawRows = null;
account.rank = 'SUP';
const unavailableStatus = (force=false) => context.flmTeamGetSourceStatus({...statusRequest,force});
const lostStatusRow = result => result.sources.find(source=>source.id==='lost');
responses = [{status:503,body:fixture}];
const failedStatus = unavailableStatus();
assert.equal(failedStatus.ok,false);
assert.equal(lostStatusRow(failedStatus).status,'ERROR','Absent fallback sheets cannot prove an empty feed.');
assert.equal(lostStatusRow(failedStatus).latestDate,null);
assert.doesNotMatch(JSON.stringify(failedStatus),/FIXTURE|503|sb_secret/);
const beforeStatusRetry = calls.length;
responses = [ok([])];
assert.equal(lostStatusRow(unavailableStatus()).status,'EMPTY','Nonforced retry must read the now-available source.');
assert.equal(calls.length,beforeStatusRetry+1);
responses = [{status:503,body:fixture}];
rawRows = [['unrecognized']];
assert.equal(lostStatusRow(unavailableStatus(true)).status,'ERROR','A malformed header does not prove an empty feed.');
responses = [{status:503,body:fixture}];
rawRows = [['date','station','reason','shipment','amount']];
assert.equal(lostStatusRow(unavailableStatus(true)).status,'EMPTY','A readable header-only fallback is an empty feed.');

cache.clear();
const workingQuery = context.flmTeamQuery_;
context.flmTeamQuery_ = () => { throw Error(fixture); };
const retryableRequest = {...orderRequest,force:false};
const detailCacheKey = 'flm:hub-orders:v6:1:2026-11-18:A';
rawRows = null;
responses = [{status:503,body:fixture}];
assert.throws(()=>context.flmTeamGetHubOrders(retryableRequest),/^Error: LOST_UPSTREAM$/);
assert(!cache.has(detailCacheKey),'An unavailable read must not cache empty detail.');
rawRows = [['date','station','reason','shipment','amount'],['2026-11-17','Depot A Hub','Fallback','LEGACY-FAILURE',20]];
failedLegacyRead = true;
responses = [{status:503,body:fixture}];
assert.throws(()=>context.flmTeamGetHubOrders(orderRequest),/^Error: LOST_UPSTREAM$/);
assert(!cache.has(detailCacheKey),'A failed Sheets and BigQuery fallback must be retryable.');
const beforeDetailRetry = calls.length;
failedLegacyRead = false;
responses = [ok([row('Depot A','2026-11-17',{spx_tracking:'RECOVERED'})]),ok([])];
assert.equal(context.flmTeamGetHubOrders(retryableRequest).lost[0].shipmentId,'RECOVERED');
assert.equal(calls.length,beforeDetailRetry+2);
assert(cache.has(detailCacheKey));
responses = [ok([])];
assert.equal(context.flmTeamGetHubOrders(orderRequest).lost.length,0,'Forced retry must bypass and replace an older successful cache entry.');
assert.equal(context.flmTeamGetHubOrders(retryableRequest).lost.length,0,'Confirmed empty is cacheable.');
rawRows = [['date','station','reason','shipment','amount']];
responses = [{status:503,body:fixture}];
assert.equal(context.flmTeamGetHubOrders(orderRequest).lost.length,0,'A valid empty Sheets result survives a failing secondary fallback.');

context.flmTeamQuery_ = sql=>sql.includes('flm_lost_current')?[{station:'Depot A',d:'2026-11-17',shipment_id:'PARTIAL-BQ',amt:5},null]:[];
rawRows = null;
responses = [{status:503,body:fixture}];
assert.throws(()=>context.flmTeamGetHubOrders(orderRequest),/^Error: LOST_UPSTREAM$/,'Partial BigQuery rows must not be returned after a parsing failure.');
context.flmTeamQuery_ = workingQuery;
console.log('PASS: Lost source failures are retryable and never become cached empty or partial detail.');
