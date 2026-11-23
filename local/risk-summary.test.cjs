const assert = require('node:assert/strict');
const vm = require('node:vm');
const {read} = require('./source.cjs');
const clone = data => JSON.parse(JSON.stringify(data));
const format = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'});

function between(source, from, to) {
  const start=source.indexOf(from), end=source.indexOf(to,start+from.length);
  assert.ok(start>=0&&end>start, from);
  return source.slice(start,end);
}

function verifyPivotBackend() {
  let clock='2026-11-18T02:00:00Z', opened=0, rawRead=0, pivotReads=0, unavailable=false;
  let urgentPivots,alertPivots;
  const cache=new Map();
  const access={allowed:true,rank:'SUP',customAccess:true,allowedPages:['dashboard','compensated']};
  const paidStages={fm:'FM',lm:'LM'};
  const stations=[
    {hubCode:'A',hubName:'Depot A Hub',stationName:'Shared'},
    {hubCode:'B',hubName:'Depot B Hub',stationName:'Shared Hub'},
    {hubCode:'C',hubName:'Depot C Hub'},
  ];
  let authorized=['A','C'];
  const localSerial=Date.parse('2026-11-19T00:00:00Z')/86400000+25569+0.99;
  const alert=[
    ['station','COUNT of spx_shipment_id','SUM of COGS','date','aging','stage','unknown_extra'],
    ['Depot A','2',1200000,'2026-11-18',8,paidStages.fm,'PRIVATE-ALERT-MARKER'],
    ['Depot A Hub',3,45,'2026-11-20','15–21 ngày',paidStages.lm],
    ['Depot C',1,7,'2026-11-17T17:00:00Z',2,paidStages.fm],
    ['Depot A Hub',1,'','2026-11-19T17:30:00Z',12,paidStages.lm],
    ['Depot A',0,99,'2026-11-25',2,'zero'],
    ['Depot A','#VALUE!',99,'2026-11-26',2,'later malformed'],
    ['Depot C',10,99,'2026-11-16',2,'earlier'],
    ['Depot A',19,99,'2026-11-17',2,'past'],
    ['Depot A',20,99,'2026-11-31',2,'invalid'],
    ['Depot A',21,99,'2026-11-19T26:00:00',2,'invalid'],
    ['Depot A',22,99,'2026-11-19 garbage',2,'invalid'],
    ['Depot A Extension',30,99,'2026-11-19',2,'prefix'],
    ['Shared',33,99,'2026-11-19',2,'ambiguous'],
    ['Depot B',34,99,'2026-11-28',2,'out-of-scope'],
    ['Grand Total',1000,999,'2026-11-19',2,'subtotal'],
  ];
  let urgent=[
    ['deadline','fleet_final_station','COUNTA of shipment_id','cogs','aging','feedback'],
    ['2026-11-18 23:15:00+07','Depot A',4,250,22,'Pending'],
    [new Date('2026-11-18T17:06:00Z'),'Depot A',2,'',7,'Done'],
    ['20/11/2026','Depot A',1,11,'8–14 ngày','PRIVATE-FEEDBACK-MARKER'],
    [localSerial,'Depot A',1,3,12,''],
    ['2026-11-17T18:00:00Z','Depot C',1,22,8,''],
    ['2026-11-17 20:00:00','Depot A',15,99,2,''],
  ];
  function sheet(name,rows,pivot=true) {
    return {getName:()=>name,getLastRow:()=>rows.length,getLastColumn:()=>rows[0].length,
      getRange(row,col,height,width){
        if(!pivot){rawRead++;throw Error('Raw sheet read');}
        pivotReads++;
        assert.deepEqual([row,col,height,width],[1,1,rows.length,rows[0].length]);
        return {getValues:()=>rows};
      }};
  }
  const ctx=vm.createContext({
    Date:class extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return Date.parse(clock);}},
    Utilities:{formatDate:(date,zone)=>{assert.equal(zone,'Asia/Ho_Chi_Minh');return format.format(date);}},
    requireAccess_(pages){ctx.assertPageAccess_(access,pages);return access;},
    assertScopeAccess_(account,type,value){
      assert.equal(account,access);
      if(type!=='CITY'||value!=='HCM_CITY')throw Error('SCOPE_DENIED');
      return {type,value,hubCodes:authorized,label:'Synthetic scope'};
    },
    getPermissionModel_:()=>({stations}),getSecurityVersion_:()=>1,
    getModuleNavigationSettings_:()=>({modules:{compensated:{enabled:true}}}),moduleRuleMatchesAccess_:rule=>rule.enabled,
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
    CacheService:{getScriptCache:()=>({get:key=>cache.get(key),put:(key,data,ttl)=>{
      assert.equal(ttl,1800);cache.set(key,data);
    }})},
    SpreadsheetApp:{openById(){
      opened++;
      return {getSheets:()=>[
        sheet('[Alert]',alert,false),sheet('unverified alert_pivot backup',alert,false),
        ...(alertPivots??[sheet('alert_pivot',alert)]),...(urgentPivots??(unavailable?[]:[sheet('URGENT PIVOT',urgent)]))
      ]};
    }},
    UrlFetchApp:{fetch(){throw Error('Unexpected upstream fetch');}}
  });
  vm.runInContext(between(read('Code.gs'),'function assertPageAccess_(access,pages){','function accessGrantProtected_('),ctx);
  vm.runInContext(read('FLMModule.gs'),ctx);
  for(const offset of ['+15:00','-15','+14:01','-14:01','+12:60','-13:61']){
    assert.equal(ctx.flmRiskPivotDay_('2026-11-18T23:30:00'+offset),null,offset);
  }
  assert.equal(ctx.flmRiskPivotDay_('2026-11-18T23:30:00.123456+14:00'),'2026-11-18');
  assert.equal(ctx.flmRiskPivotDay_('2026-11-18T23:30:00-14'),'2026-11-19');
  // Sheet Date objects normally share the Apps Script runtime's calendar type.
  urgent[2][0]=vm.runInContext("new Date('2026-11-18T17:06:00Z')",ctx);
  const load=(selected,force=false)=>clone(ctx.flmTeamGetRiskSummary({scopeType:'CITY',scopeValue:'HCM_CITY',selectedHubCodes:selected,anchorDate:'1900-01-01',force}));
  const a=load(['A']);
  assert.equal(a.today,'2026-11-18');
  assert.equal(a.expiresAt,'2026-11-18T02:30:00.000Z');
  assert.deepEqual(a.sources.map(source=>source.status),['OK','OK'],'Recognizes shipment ID count columns in both pivots');
  assert.equal(a.sources[0].hubRows[0].n,4);
  assert.equal(a.sources[0].hubRows[0].knownCogs,45);
  assert.equal(a.sources[0].hubRows[0].missingCogs,1);
  assert.deepEqual(a.sources[0].hubRows[0].stages,{LM:4});
  assert.deepEqual([a.sources[0].hubRows[0].hvOrders,a.sources[0].hubRows[0].hvCogs],[null,null]);
  assert.deepEqual(a.sources[0].dates,['2026-11-20']);
  assert.deepEqual(a.sources[1].dates,['2026-11-18','2026-11-19','2026-11-20']);
  const urgentA=a.sources[1].hubRows[0];
  assert.deepEqual([urgentA.n,urgentA.knownCogs,urgentA.missingCogs],[8,264,2]);
  assert.deepEqual(urgentA.aging,{'> 21 ngày':4,'≤ 7 ngày':2,'8–14 ngày':2});
  assert.deepEqual(urgentA.feedback,{'Chưa phản hồi':4,'Đã phản hồi':2,'Khác':1});
  assert.doesNotMatch(JSON.stringify(a),/PRIVATE|subtotal|Shared|Depot B|Depot C|high_value|shipment/);
  assert.equal(rawRead,0);
  assert.equal(pivotReads,2);
  assert.deepEqual(load(['A']),a);
  assert.equal(opened,1,'Warm response should avoid reading the sheets');
  assert.deepEqual(load(['C']).sources[0].dates,['2026-11-18'],'Timestamps choose the scoped Vietnam date even when a different HUB has newer data');
  assert.equal(load(['C']).sources[0].hubRows[0].hubCode,'C');
  assert.equal(opened,2);
  assert.deepEqual(load(['A','C']).sources[0].hubRows.map(r=>r.hubCode),['A']);
  load(['C','A']);
  assert.equal(opened,3,'Equivalent HUB selections use one scoped cache');
  assert.throws(()=>load(['B']),/HUB_ACCESS_DENIED/);
  access.allowedPages=['dashboard'];
  assert.throws(()=>load(['A']),/PAGE_ACCESS_DENIED/);
  access.allowedPages=['compensated'];
  access.rank='NORMAL';
  assert.throws(()=>load(['A']),/MODULE_ACCESS_DENIED/);
  assert.equal(opened,3,'Authorize before reading sheets or serving cache');
  access.rank='SUP';
  load(['A'],true);
  assert.equal(opened,4,'Explicit refresh bypasses the existing cache');
  clock='2026-11-18T02:31:00Z';
  load(['A']);
  assert.equal(opened,5,'The established 30-minute scope cache expires');
  clock='2026-11-18T17:00:00Z';
  unavailable=true;
  const next=load(['A']);
  assert.equal(next.today,'2026-11-19');
  assert.equal(next.sources[0].hubRows[0].n,4);
  assert.deepEqual(load(['C']).sources[0].dates,['2026-11-18'],'Historical Alert is still visible after Vietnam midnight');
  assert.equal(next.sources[1].status,'UNAVAILABLE');
  assert.equal(rawRead,0,'Missing pivot does not fall back to raw or similar names');
  unavailable=false;
  assert.equal(load(['A'],true).sources[1].status,'OK');
  unavailable=true;
  assert.equal(load(['A'],true).sources[1].status,'UNAVAILABLE');
  assert.equal(load(['A']).sources[1].status,'UNAVAILABLE','Explicit refresh invalidates a prior successful summary even if the pivot disappears');
  unavailable=false;
  for(const [alertHeader,urgentHeader] of [
    ['  COUNTA   of SPX_SHIPMENT_ID  ','COUNT of shipment_id'],
    ['orders','COUNTA of id'],
  ]){
    alert[0][1]=alertHeader;
    urgent[0][2]=urgentHeader;
    assert.deepEqual(load(['A'],true).sources.map(source=>source.hubRows[0]?.n),[4,4]);
  }
  const alias=sheet('PRELOST PIVOT',urgent);
  const preferred=(...rows)=>sheet('URGENT PIVOT',[urgent[0],...rows]);
  const row=(count,station='Depot A',day='2026-11-20')=>[day,station,count,'','',''];
  const urgentSource=(...pivots)=>{urgentPivots=pivots;return load(['A'],true).sources[1];};
  const noRows=status=>({id:'urgent',status,dates:[],hubRows:[]});
  assert.equal(urgentSource(alias,preferred(row(9))).hubRows[0]?.n,9,'Canonical pivot wins even when listed after the alias');
  const malformedHeader=sheet('URGENT PIVOT',[['deadline','station','COUNTA of rider_id'],['2026-11-20','Depot A',1234]]);
  assert.equal(urgentSource(malformedHeader,alias).hubRows[0]?.n,4,'A valid known alias can replace a malformed exact-name tab');
  assert.deepEqual(urgentSource(malformedHeader),noRows('UNAVAILABLE'),'Ignores counts of unrelated fields');
  for(const count of ['#VALUE!',-1,1.5,'',Number.MAX_SAFE_INTEGER+1]){
    const malformed=preferred(row(9),row(count));
    assert.equal(urgentSource(malformed,alias).hubRows[0]?.n,4,'Malformed scoped counts invalidate the entire candidate');
    assert.deepEqual(urgentSource(malformed),noRows('UNAVAILABLE'));
  }
  const unreadable={...preferred(),getRange:()=>({getValues(){throw Error('Synthetic read failure');}})};
  assert.equal(urgentSource(unreadable,alias).hubRows[0]?.n,4,'Read errors allow fallback to the next known name');
  assert.deepEqual(urgentSource(unreadable,malformedHeader),noRows('ERROR'),'Read failures surface if every candidate is unusable');
  assert.deepEqual(urgentSource(unreadable,sheet('PRELOST PIVOT',[urgent[0]])),noRows('EMPTY'),'An empty alias can recover from a read failure');
  assert.deepEqual(urgentSource(alias,preferred()),noRows('EMPTY'),'A valid empty pivot takes precedence over another alias');
  assert.deepEqual(urgentSource(alias,preferred(row(0),row('#VALUE!','Depot B'),row('#VALUE!','Depot A','2026-11-18'))),
    noRows('EMPTY'),'Zero counts and malformed counts outside the selected window or HUB do not invalidate a pivot');
  urgentPivots=undefined;
  const alertAlias=sheet('ALERT SUMMARY',[alert[0],['Depot A',8,10,'2026-11-15']]);
  const alertSource=(...pivots)=>{alertPivots=pivots;return load(['A'],true).sources[0];};
  const badAlert=sheet('ALERT PIVOT',[...alert,['Depot A','#VALUE!','','2026-11-20']]);
  assert.equal(alertSource(alertAlias,sheet('ALERT PIVOT',alert)).hubRows[0].n,4,'Canonical Alert pivot wins even when the alias comes first');
  assert.deepEqual(alertSource(badAlert,alertAlias).dates,['2026-11-15'],'An invalid count on the winning day invalidates the candidate');
  assert.equal(alertSource(badAlert).status,'UNAVAILABLE');
  assert.equal(alertSource({...unreadable,getName:()=>'ALERT PIVOT'},badAlert).status,'ERROR');
  assert.deepEqual(alertSource(alertAlias,sheet('ALERT PIVOT',[alert[0],['Depot A',0,'','2026-11-27']])),
    {id:'alert',status:'EMPTY',dates:[],hubRows:[]},'A genuinely empty canonical Alert pivot wins');
  alertPivots=undefined;
  assert.equal(rawRead,0);
  clock='2026-11-20T17:00:00Z';
  urgent=[urgent[0]];
  const empty=load(['A']);
  assert.deepEqual(empty.sources.map(s=>[s.status,s.hubRows.length,s.dates.length]),[['OK',1,1],['EMPTY',0,0]]);
  const metrics=(header,...rows)=>{
    const pivot=sheet('ALERT PIVOT',[['station','count','cogs','date','stage',...header],
      ...rows.map(([n,cogs,stage,...rest])=>['Depot A',n,cogs,'2026-11-20',stage,...rest])]);
    const result=alertSource(pivot);
    assert.equal(result.status,'OK');
    const h=result.hubRows[0];
    return [h.hvOrders,h.hvCogs,h.stages];
  };
  assert.deepEqual(metrics(['high value'],[2,2000000,' FM ',true],[3,'','RT',false],[1,1500000,'eHa','HV']),
    [3,3500000,{FM:2,RT:3,eHa:1}]);
  assert.deepEqual(metrics(['hv'],[1,'','LM','1'],[1,'','RT','0']),[1,null,{LM:1,RT:1}]);
  assert.deepEqual(metrics(['hv'],[2,2000000,'Support assigned',''],[1,0,'RT',false]),
    [null,null,{'Support assigned':2,RT:1}]);
  assert.deepEqual(metrics(['hv_count','hv_cogs'],[3,2400000,'LM','2',2100000]),[2,2100000,{LM:3}]);
  assert.deepEqual(metrics(['hv_count','hv_cogs'],[3,2400000,'LM','',2100000]),[null,2100000,{LM:3}]);
  assert.deepEqual(metrics(['hv_count','hv_cogs'],[3,2400000,'LM','2',1999999]),[2,null,{LM:3}]);
  for(const count of [-1,1.5,4,'#VALUE!']){
    assert.deepEqual(metrics(['hv_count','hv_cogs'],[3,2400000,'LM',count,2100000]),[null,null,{LM:3}]);
  }
  for(const [headers,row] of [
    [['high_value'],[1,999999,'FM',true]],
    [['high_value'],[1,1000000,'FM',false]],
    [['hv_count'],[2,1500000,'FM',2]],
    [['hv_count','hv_cogs'],[2,3000000,'FM',1,1500000]]
  ]){
    assert.deepEqual(metrics(headers,row),[null,null,{FM:row[0]}]);
  }
  assert.deepEqual(metrics(['hv_count','hv_cogs'],[2,2499999,'FM',1,1500000]),[1,1500000,{FM:2}]);
  console.log('PASS: At-Risk pivot scope, dates, validation and cache, exact operation codes, and independent HV count and COGS coverage.');

  clock='2026-11-18T02:00:00Z';
  access.rank='AOM';
  ctx.PropertiesService.getScriptProperties=()=>({getProperty:name=>name==='SUPABASE_LOST_SECRET_KEY'?'sb_secret_fixture':null});
  const fetched=[],day='2026-11-20';
  let failure='',invalidOnly=false;
  const aggregate=(source,risk_day,station,metrics={})=>({source,risk_day,station,order_count:1,
    known_cogs:0,missing_cogs:1,hv_orders:0,hv_cogs:0,
    aging_7:0,aging_14:0,aging_21:0,aging_over_21:0,missing_aging:1,missing_feedback:1,...metrics});
  const alertA=aggregate('alert',day,'DEPOT A',{order_count:2,known_cogs:1000000,hv_orders:1,hv_cogs:1000000,aging_7:1,missing_feedback:2});
  const unknownC=aggregate('alert',day,'DEPOT C');
  const malformedDate=aggregate('alert',null,'DEPOT A');
  const serviceUrgentA=aggregate('urgent','2026-11-18','DEPOT A',{known_cogs:900,missing_cogs:0});
  ctx.UrlFetchApp.fetch=(raw,options)=>{
    const url=new URL(raw),params=url.searchParams,offset=Number(params.get('offset'));
    const source=params.get('source').split('.')[1],latest=params.get('limit')==='1';
    assert.equal(url.pathname,'/rest/v1/at_risk_daily_summary');
    assert.equal(options.method,'get');
    assert.deepEqual(clone(options.headers),{apikey:'sb_secret_fixture'});
    assert.equal(options.followRedirects,false);
    assert.equal(params.get('station'),'in.("A","C","DEPOT A","DEPOT C")');
    assert.equal(params.get('order'),'risk_day.desc.nullslast,station.asc');
    assert.doesNotMatch(params.get('select'),/spx|claim|staff/);
    fetched.push([source,latest,offset]);
    let rows;
    if(latest){
      assert.equal(params.get('risk_day'),'not.is.null');
      rows=invalidOnly?[]:[{source,risk_day:'2026-11-28',station:'DEPOT B'},{source,risk_day:day,station:'DEPOT A'}];
    }else if(source==='alert'){
      assert.equal(invalidOnly?params.get('risk_day'):params.get('or'),invalidOnly?'is.null':'(risk_day.eq.'+day+',risk_day.is.null)');
      rows=invalidOnly?[malformedDate]:[alertA,unknownC,malformedDate];
      if(failure==='duplicate'&&offset)rows[offset]=alertA;
      if(failure==='malformed')rows=[{...alertA,unexpected:'PRIVATE_ROW'}];
    }else{
      assert.equal(params.get('or'),'(risk_day.gte.2026-11-18,risk_day.is.null)');
      rows=invalidOnly?[]:[serviceUrgentA];
    }
    return {getResponseCode:()=>failure==='missing'?404:206,getContentText:()=>JSON.stringify(rows.slice(offset,offset+1))};
  };
  const openedBefore=opened;
  assert.throws(()=>load(['B'],true),/HUB_ACCESS_DENIED/);
  access.allowedPages=['dashboard'];
  assert.throws(()=>load(['A','C'],true),/PAGE_ACCESS_DENIED/);
  access.allowedPages=['dashboard','compensated'];
  assert.equal(fetched.length,0,'Authorize an aggregate viewer before making a service-key request');
  const live=load(['A','C'],true);
  assert.equal(live.basis,'supabase');
  assert.equal(live.stationAliases,undefined,'Aggregate viewers do not receive the detail alias map');
  access.rank='SUP';
  assert.deepEqual(load(['A','C']).stationAliases,{A:'A',C:'C','DEPOT A':'A','DEPOT C':'C'},
    'Detail viewers receive only unique scoped directory aliases even on a warm shared summary');
  access.rank='AOM';
  assert.equal(opened,openedBefore);
  assert.deepEqual(live.sources.map(s=>[s.status,s.dates,s.invalidDates]),[['OK',[day],1],['OK',['2026-11-18'],0]]);
  assert.deepEqual(live.sources[0].hubRows.map(h=>[h.hubCode,h.n,h.hvOrders,h.hvCogs,h.missingAging,h.missingFeedback]),
    [['A',2,1,1000000,1,2],['C',1,null,null,1,1]]);
  assert.deepEqual(live.sources[0].hubRows[0].stages,{});
  assert.deepEqual(live.sources[0].hubRows[0].aging,{'≤ 7 ngày':1,'Chưa xác định':1});
  assert.match(JSON.stringify(live),/Depot A Hub/);
  assert.doesNotMatch(JSON.stringify(live),/DEPOT B|2026-11-28|sb_secret/);
  assert.deepEqual(fetched,[['alert',true,0],['alert',true,1],['alert',false,0],['alert',false,1],['alert',false,2],['alert',false,3],['urgent',false,0],['urgent',false,1]]);
  assert.deepEqual(load(['C','A']),live,'Warm scoped result does not require a new service read');
  assert.equal(fetched.length,8);
  invalidOnly=true;
  assert.deepEqual(load(['A','C'],true).sources.map(s=>[s.status,s.invalidDates]),[['UNAVAILABLE',1],['EMPTY',0]]);
  invalidOnly=false;
  for(failure of ['missing','malformed','duplicate']){
    const fallback=load(['A','C'],true);
    assert.equal(fallback.basis,'pivot',failure);
    assert.doesNotMatch(JSON.stringify(fallback),/PRIVATE_ROW|sb_secret/);
  }
  assert.equal(opened,openedBefore+3);
  assert.equal(rawRead,0);
  console.log('PASS: Supabase At-Risk summary scope and service-only requests, latest day, short pages, coverage, cache, and pivot fallback.');

  const bulk=Array.from({length:500},(_,i)=>{
    const hubCode='H'+String(i).padStart(3,'0');
    return {hubCode,hubName:'Synthetic Distribution Depot '+hubCode,stationName:'Synthetic Service Station '+hubCode};
  });
  stations.push(...bulk);
  authorized=bulk.map(h=>h.hubCode);
  const seenStations=new Set();
  let bulkRequests=0,urgentPages=0,overflow='';
  ctx.UrlFetchApp.fetch=raw=>{
    const params=new URL(raw).searchParams,filter=params.get('station');
    assert.ok(filter.length<1309);
    const batch=JSON.parse('['+filter.slice(4,-1)+']');
    batch.forEach(value=>seenStations.add(value));
    bulkRequests++;
    let rows=[];
    const offset=Number(params.get('offset'));
    if(overflow&&params.get('source')==='eq.urgent'){
      urgentPages++;
      const shift=new Date(Date.parse('2026-11-18')+offset*86400000).toISOString().slice(0,10);
      if(overflow==='page'||offset<4)rows=[aggregate('urgent',shift,batch[0])];
    }
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(rows)};
  };
  const emptyBulk=load(authorized,true);
  assert.equal(emptyBulk.basis,'supabase');
  assert.deepEqual(emptyBulk.sources.map(source=>source.status),['EMPTY','EMPTY']);
  assert.equal(seenStations.size,1500);
  assert.ok(bulkRequests>100,'Every authorized alias batch can complete its initial queries');
  const baseRequests=bulkRequests;
  overflow='page';
  assert.equal(load(authorized,true).basis,'pivot');
  assert.equal(urgentPages,100,'An upstream batch that never terminates hits the per-query page limit');
  overflow='total';
  bulkRequests=0;
  assert.equal(load(authorized,true).basis,'pivot');
  assert.equal(bulkRequests,baseRequests+100,'Many short batches still hit the shared extra-page budget');
  console.log('PASS: 500 authorized HUBs can return empty and oversized paging falls back without partial results.');
}

async function verifySummaryClient() {
  const src=read('Javascript.html');
  const state={page:'compensated',boot:{},drillPath:{}}, claims={tab:'risk',manualScopeView:'orders',riskFilter:'all'};
  const modal={active:false}, rpc=[], timers=new Map(), controls=new Map(), trace=[];
  let now='2026-11-18T16:50:00Z', serial=0, hubs=['A','B'], topHub='', scope={type:'CITY',value:'HCM_CITY'};
  let allowed=true, orderPermission=true, detailStatus='LOADING', rendered='', focusCount=0;
  const google={script:{run:{withSuccessHandler(success){return {withFailureHandler(failure){
    return {flmTeamGetRiskSummary(request){trace.push('summary');rpc.push({request,success,failure});}};
  }};}}}};
  const ctx=vm.createContext({
    state,FLMClaims:claims,FLMTeam:{claims:{}},FLMHubOrders:modal,FLMSupabaseRisk:{},google,
    window:{addEventListener(){}},document:{hidden:false,addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,
      getElementById:id=>controls.get(id)},
    setTimeout(run,delay){timers.set(++serial,{run,delay});return serial;},clearTimeout:id=>timers.delete(id),
    Date:class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}},
    flmSourceToday_:()=>format.format(new Date(now)),volumeShift_:(date,n)=>new Date(Date.parse(date)+n*86400000).toISOString().slice(0,10),
    flmTeamClientKey_:request=>JSON.stringify(['fixture',request]), currentDrillView:()=>scope,
    flmTeamVolumeHub_:()=>topHub, effectiveSelectedHubCodes:()=>hubs, isNormalAccount:()=>false,clientPageAllowed_:()=>allowed,
    flmClaimsAllowedViews_:()=>orderPermission?['zone','hub','orders']:['hub'],flmGetActiveScopeView_:()=>orderPermission?claims.manualScopeView:'hub',
    flmTeamLoad_:force=>ctx.flmLoadRiskSummary_(force),
    flmClaimsModalHub_:code=>hubs.includes(code)?{value:code}:null,
    flmCloseHubOrdersModal_(){modal.active=false;modal.riskDetailKey='';},
    flmRenderHubOrdersModal_(){}, flmClaimsBindResults_(){},
    flmRiskForToday_(day){
      const risk=ctx.FLMSupabaseRisk;
      risk.today=day;
      risk.modalSlots??=new Map();
      return risk;
    },
    flmFetchSupabaseLiveRisk_(force){trace.push(force?'raw-force':'raw');},
    flmFetchSupabaseRiskModal_(){if(ctx.flmRiskModalHub_())trace.push('raw-modal');},
    render:()=>render(),
    flmClaimsSummary_:m=>'summary-count:'+m.total.n+' pending:'+m.pendingCount+' hv:'+m.hvCount,
    flmClaimsLoading_:()=>'<p>Loading summary</p>',flmClaimsInsights_:()=>'',flmClaimsBreakdown_:()=>'',
    flmClaimsOrdersTable_:()=>'<h2 id="flmRiskOrderTitle">RAW-DETAIL</h2>',flmClaimsHubsTable_:m=>m.rows.map(r=>r.hubCode).join(' '),
    flmClaimsModel_(){return {source:{status:detailStatus,error:'detail only'}};},flmClaimsZoneTable_:()=>'',uiDateLabel:String,e:String,flmTeamFmt_:String,
    flmValidDate_:day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)
  });
  vm.runInContext(between(src,'var FLMRiskSummary=null;','function flmFetchSupabaseLiveRisk_('),ctx);
  for(const [first,next] of [['function designNavIcon(key){','function designPageName(key){'],
                              ['function flmClaimsScopeTabs_(active,riskAction){','function flmBuildHubToZoneMap_(){'],
                              ['function flmRiskAddMetrics_(total,row,partial){','function flmClaimsZoneTable_(m){'],
                              ['function flmRiskSummaryModel_(data){','function flmClaimsRender_(d){'],
                              ['function flmClaimsBind_(){','\r\n}']]){
    const section=between(src,first,next);
    vm.runInContext(section+(next==='\r\n}'?next:''),ctx);
  }
  function render(){
    ctx.flmRiskSyncDetails_();
    if(state.page!=='compensated'||claims.tab!=='risk')return;
    rendered=ctx.flmRiskReport_();
    controls.clear();
    for(const match of rendered.matchAll(/id="(flmRisk(?:OpenDetails|OrderTitle|SummaryRetry|DetailRetry))"/g)){
      controls.set(match[1],{getAttribute:()=>String(/aria-expanded="true"/.test(rendered)),focus(){focusCount++;}});
    }
    ctx.flmClaimsBind_();
  }
  const data=(request,options={})=>({today:request.anchorDate,expiresAt:new Date(Date.parse(now)+1800000).toISOString(),
    sources:[{id:'alert',status:'OK',dates:['2026-11-12'],hubRows:[{hubCode:request.selectedHubCodes[0],station:'Demo',n:6,knownCogs:500,missingCogs:0,aging:{},feedback:{},stages:{}}]},
      {id:'urgent',status:'UNAVAILABLE',hubRows:[]}],...options});

  render();
  render();
  ctx.flmRiskRecheck_();
  assert.deepEqual(trace,['summary'],'Opening, rerendering and resuming send only one aggregate request');
  assert.match(rendered,/Xem đơn chi tiết/);
  assert.doesNotMatch(rendered,/RAW-DETAIL/);
  rpc[0].success(data(rpc[0].request));
  assert.match(rendered,/Prelost: chưa có bảng tổng hợp · Tổng chỉ gồm nguồn khả dụng/);
  assert.match(rendered,/summary-count:6 pending:null hv:null/);
  assert.match(rendered,/Prelost từ 2026-11-18 trở đi · Alert 2026-11-12 · Giờ Việt Nam/);
  assert.equal(rpc.length,1);
  controls.get('flmRiskOpenDetails').onclick();
  assert.equal(trace.at(-1),'raw');
  assert.equal(focusCount,1);
  assert.match(rendered,/Đang tải đơn chi tiết/);
  detailStatus='ERROR';
  render();
  assert.match(rendered,/summary-count:6/);
  assert.match(rendered,/detail only/);
  controls.get('flmRiskDetailRetry').onclick();
  assert.ok(trace.includes('raw-force'));
  detailStatus='OK';
  render();
  assert.match(rendered,/RAW-DETAIL/);

  ctx.flmRiskRecheck_({persisted:true});
  assert.equal(claims.riskDetailKey,'','Browser back-forward cache restores summary first');
  assert.doesNotMatch(rendered,/RAW-DETAIL/);
  controls.get('flmRiskOpenDetails').onclick();
  topHub='B';

  render();
  assert.equal(claims.riskDetailKey,'');
  assert.equal(trace.at(-1),'summary');
  assert.deepEqual(clone(rpc[1].request.selectedHubCodes),['B']);
  assert.doesNotMatch(rendered,/RAW-DETAIL/);
  rpc[1].success(data(rpc[1].request));
  const rawCount=trace.filter(x=>x.startsWith('raw')).length;
  controls.get('flmRiskSummaryRetry').onclick();
  assert.equal(rpc[2].request.force,true);
  rpc[2].failure(Error('private upstream failure'));
  render();
  assert.equal(rpc.length,3,'A failed automatic bind does not retry');
  assert.doesNotMatch(rendered,/private upstream failure/);
  controls.get('flmRiskSummaryRetry').onclick();
  now='2026-11-18T17:00:00Z';
  ctx.flmRiskRecheck_();
  assert.equal(rpc[4].request.anchorDate,'2026-11-19');
  rpc[3].success(data(rpc[3].request));
  assert.doesNotMatch(rendered,/summary-count:6/);
  rpc[4].success(data(rpc[4].request,{sources:[{id:'alert',status:'EMPTY',hubRows:[]},{id:'urgent',status:'EMPTY',hubRows:[]}]}));
  assert.match(rendered,/Không có đơn trong các kỳ báo cáo/);
  assert.match(rendered,/Alert không có đơn/);
  assert.equal(trace.filter(x=>x.startsWith('raw')).length,rawCount,'Refresh, retries and midnight do not request raw before another action');

  controls.get('flmRiskOpenDetails').onclick();
  assert.match(rendered,/Alert chi tiết từ hôm nay \(Supabase\)/);
  const previousKey=claims.riskDetailKey;
  let canceled=0;
  ctx.FLMSupabaseRisk.liveRequest={stop(){canceled++;}};
  state.page='dashboard';
  render();
  assert.equal(canceled,1);
  state.page='compensated';
  render();
  assert.equal(claims.riskDetailKey,'','Browser back cannot restore detail opt-in');
  assert.doesNotMatch(rendered,/RAW-DETAIL/);
  modal.active=true;
  modal.tab='urgent';
  modal.hubCode='B';
  modal.riskDetailKey=previousKey;
  now='2026-11-19T17:00:00Z';
  ctx.flmRiskRecheck_();
  assert.equal(modal.active,false,'An open risk detail modal closes when its date changes');
  orderPermission=false;
  render();
  assert.doesNotMatch(rendered,/flmRiskOpenDetails|RAW-DETAIL/);
  const before=trace.length;
  ctx.flmRiskOpenDetails_();
  allowed=false;
  ctx.flmLoadRiskSummary_(true);
  render();
  assert.equal(trace.length,before);
  assert.match(rendered,/không có quyền/);
  console.log('PASS: At-Risk opening sends only the summary RPC, detail focus and opt-in, separate retries, scope/day races, navigation and permissions.');

  allowed=true;
  const hub=({hubCode='B',...rest}={})=>({hubCode,station:'Demo '+hubCode,n:1,knownCogs:0,missingCogs:1,
    hvOrders:null,hvCogs:null,aging:{},feedback:{},stages:{},...rest});
  const request=ctx.flmRiskSummaryRequest_();
  const service=data(request,{basis:'supabase',sources:[
    {id:'alert',status:'OK',dates:['2026-11-19'],invalidDates:2,hubRows:[hub({n:2,knownCogs:1000000,hvOrders:1,hvCogs:1000000})]},
    {id:'urgent',status:'OK',dates:[request.anchorDate],invalidDates:0,hubRows:[hub()]},
  ]});
  ctx.flmRiskSummaryEntry_(request).data=service;
  render();
  assert.match(rendered,/Đơn thiếu ngày hợp lệ · Alert 2/);
  const [row]=ctx.flmRiskSummaryModel_(service).data.hubStats;
  assert.deepEqual([row.totalOrders,row.totalCogs,row.hvOrders,row.hvCogs,row.missingCogs],[3,1000000,1,1000000,2]);
  assert.equal(ctx.flmRiskRawHubModel_(service,null),null,'A Supabase aggregate remains the source after order detail is loaded');
  const zone={name:'Synthetic Zone'};
  Object.assign(ctx,{FLM_ZONES_CONFIG:[zone],flmBuildHubToZoneMap_:()=>({B:zone,C:zone}),
    flmGetScopeInfo_:()=>({}),appExportIcon:()=>'',flmClaimsMoney_:h=>String(h.knownCogs)});
  const reportSource=src.slice(src.indexOf('function flmRiskTableBasis_(m){'));
  for(const [start,finish] of [['function flmRiskTableBasis_(m){','function flmRiskAddMetrics_('],
    ['function flmClaimsZoneTable_(m){','function flmClaimsHubRows_('],
    ['function flmClaimsHubsTable_(m){','function flmClaimsOrdersTable_(']]){
    vm.runInContext(between(reportSource,start,finish),ctx);
  }
  vm.runInContext(between(src,'function flmTeamFmt_(n,digits){','function flmTeamCards_('),ctx);
  const model=ctx.flmRiskSummaryModel_({...service,sources:[service.sources[0],
    {...service.sources[1],hubRows:[...service.sources[1].hubRows,hub({hubCode:'C'})]}]});
  const zoneHtml=ctx.flmClaimsZoneTable_(model),hubHtml=ctx.flmClaimsHubsTable_(model);
  assert.match(zoneHtml,/<tfoot>.*td-hv-order">1<.*td-hv-cogs">1,000,000</);
  assert.doesNotMatch(zoneHtml,/td-fm|Thiếu phân loại/);
  assert.match(hubHtml,/Tổng hợp Alert và Prelost \(Supabase\)/);
  assert.doesNotMatch(hubHtml,/Thiếu phân loại/);
  assert.match(hubHtml,/Demo C.*<td>C<\/td><td>1<\/td>/);
  let csv;
  ctx.Blob=class {constructor(parts){csv=parts.join('');}};
  ctx.URL={createObjectURL:()=>'',revokeObjectURL(){}};
  ctx.document.createElement=()=>({click(){}});
  vm.runInContext(between(src,'function flmClaimsExport_(){','function flmClaimsSelectView_(view){'),ctx);
  ctx.flmClaimsExport_();
  assert.match(csv,/"Đơn thiếu COGS","Nguồn chưa đủ","Có đơn thiếu ngày hợp lệ trong phạm vi"/);
  assert.doesNotMatch(csv,/"Đơn thiếu phân loại"|"FM"/);
  assert.match(csv,/"Demo B","B","3","1000000","1","1000000","2","Không","Có"/);
  console.log('PASS: Supabase report and CSV retain confirmed metrics, flag excluded dates, and report partial COGS without operation breakdown.');
}

async function verifyModalFeedIsolation() {
  const src=read('Javascript.html');
  const a={value:'A',label:'Depot A',station:'Shared depot'}, b={value:'B',label:'Depot B',station:'Shared depot'};
  const c={value:'C',label:'Depot C',station:'Shared depot'};
  const state={page:'compensated',selectedHubCodes:[],drillPath:{}};
  const claims={tab:'risk',manualScopeView:'orders'};
  const tabs=['lost','urgent','alert'].map(name=>({dataset:{clModalTab:name}}));
  const reads=[], downloads=[], storage=new Map(), summaryCalls=[];
  let selected=['A','B'], now='2026-11-18T12:00:00Z', canOrder=true, mounted=false, gate=null, rejectFeed='', suffix='', aliasRows=false;
  let bindMain=false,mainPending;
  const dialog={innerHTML:'',remove(){mounted=false;}},retry={};
  const response=rows=>({ok:true,json:async()=>rows});
  const ctx=vm.createContext({
    state,FLMClaims:claims,URL,AbortController,performance,Blob,
    FLMSupabaseRisk:{prelostUrl:'https://fixture.invalid/rest/v1/urgent_orders',alertUrl:'https://fixture.invalid/rest/v1/alert_orders'},
    window:{addEventListener(){}},document:{
      hidden:false, addEventListener(){}, createElement:()=>dialog,
      getElementById(id){
        if(id==='clHubOrdersModal'&&mounted)return dialog;
        if(id==='clModalRetry'&&dialog.innerHTML.includes('id="clModalRetry"'))return retry;
      },
      querySelectorAll:selector=>selector==='[data-cl-modal-tab]'?tabs:[],
      body:{appendChild(){mounted=true;},classList:{add(){},remove(){}}}
    },
    Date:class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}},
    sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    setTimeout:()=>1,clearTimeout(){},render(){
      if(bindMain&&ctx.flmRiskMainDetailsOpen_())mainPending=ctx.flmFetchSupabaseLiveRisk_(false);
    },
    google:{script:{run:{withSuccessHandler(success){return {withFailureHandler(){
      return {flmTeamGetRiskSummary(request){summaryCalls.push({request,success});}};
    }};}}}},
    flmSourceToday_:()=>format.format(new Date(now)),volumeShift_:(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10),
    flmValidDate_:day=> /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day,
    clientPageAllowed_:()=>true,isNormalAccount:()=>false,accessInfo:()=>({allData:false}),
    flmClaimsAllowedViews_:()=>canOrder?['orders']:['hub'],flmGetActiveScopeView_:()=>claims.manualScopeView,
    currentDrillView:()=>({type:'CITY',value:'HCM_CITY'}),flmTeamVolumeHub_:()=>'',
    effectiveSelectedHubCodes:()=>selected,currentOrgHubNodes:()=>[a,b],drill:()=>({root:{hubs:[a,b,c]}}),
    flmTeamClientKey_:request=>JSON.stringify(['fixture',request]),
    flmBuildSupabaseLostSource_:()=>({status:'LOADING'}),flmLoadLostReport_(){},
    flmTeamFmt_:String,e:String,
    fetch(url,{signal}){
      const urgent=url.pathname.endsWith('urgent_orders'), feed=urgent?'urgent':'alert',offset=url.searchParams.get('offset');
      reads.push({feed,offset,signal,days:url.searchParams.getAll(columnFor(feed))});
      assert.equal(url.searchParams.get('fleet_final_station'),null);
      if(rejectFeed===feed)return Promise.resolve({ok:false,status:503});
      if(offset!=='0')return Promise.resolve(response([]));
      if(gate&&gate.feed===feed)return new Promise(resolve=>gate.finish=resolve);
      const column=urgent?'deadline':'date';
      const row=(id,station,date=ctx.flmSourceToday_())=>({id,[column]:date,spx_tracking:feed.toUpperCase()+'-'+id+suffix,fleet_final_station:station,cogs:12,yeu_cau_claim:'Synthetic reason'});
      return Promise.resolve(response([
        row(1,aliasRows?' A ':'  dEpoT   a HUB  ',urgent?undefined:'2026-11-17T02:00:00+14:00'),
        row(2,aliasRows?'Depot A / B Hub':'Depot B'),row(3,'Depot C'),
        row(4,'Shared depot'),row(5,'Depot A Extension'),row(6,'Depot A','2026-11-15T18:00:00Z')
      ]));
    }
  });
  ctx.URL=class extends URL {
    static createObjectURL(blob){downloads.push(blob);return 'blob:fixture';}
  };
  const hubName=src.match(/^function hubMapName\(.+$/m)[0];
  vm.runInContext(hubName,ctx);
  for(const [from,to] of [
    ['function flmSupabaseHeaders_(','function flmMatchHub_('],
    ['function flmGetScopeInfo_(){','function flmBuildSupabaseRiskSource_(){'],
    ['var FLMHubOrders={active:false','// Daily Snapshot reuses the authorized FLM aggregates']
  ])vm.runInContext(between(src,from,to),ctx);
  const pending=()=>ctx.FLMSupabaseRisk.modalRequest?.pending;
  const paths=()=>reads.map(r=>r.feed+':'+r.offset);
  const columnFor=feed=>feed==='urgent'?'deadline':'date';
  function setAlertDay(day){
    const entry=ctx.flmRiskSummaryEntry_(ctx.flmRiskSummaryRequest_());
    entry.data={sources:[{id:'alert',status:'OK',dates:[day]}]};
  }
  function unavailableAlert(){
    ctx.flmRiskSummaryEntry_(ctx.flmRiskSummaryRequest_()).error='Fixture unavailable';
  }

  ctx.flmFetchSupabaseRiskModal_(false);
  assert.deepEqual(paths(),[],'No raw read before a detail action');
  unavailableAlert();
  ctx.flmOpenHubOrdersModal_('A');
  assert.deepEqual(paths(),['urgent:0']);
  assert.match(dialog.innerHTML,/Đang tải danh sách đơn/);
  assert.match(dialog.innerHTML,/Đơn Alert<\/span><b>—<\/b>/);
  ctx.flmFetchSupabaseLiveRisk_(false);
  assert.deepEqual(paths(),['urgent:0'],'Modal consent cannot launch the main two-feed request');
  await pending();
  assert.deepEqual(paths(),['urgent:0','urgent:6']);
  assert.match(dialog.innerHTML,/URGENT-1/);
  assert.doesNotMatch(dialog.innerHTML,/URGENT-[2-6]/);
  assert.deepEqual(clone(ctx.flmRiskModalFeedState_(a,'urgent').rows).map(row=>row.orderId),['URGENT-1']);
  assert.equal(ctx.flmRiskModalFeedState_(a,'alert').status,'LOADING');

  ctx.flmRiskSummaryEntry_(ctx.flmRiskSummaryRequest_()).error='';
  tabs[2].onclick();
  assert.equal(reads.length,2,'Alert modal waits for the scoped summary day');
  setAlertDay('2026-11-16');
  ctx.flmRenderHubOrdersModal_();
  await pending();
  assert.deepEqual(paths(),['urgent:0','urgent:6','alert:0','alert:6']);
  assert.deepEqual(reads[2].days,['gte.2026-11-15','lt.2026-11-18']);
  assert.match(dialog.innerHTML,/Ngày Alert 2026-11-16/);
  assert.match(dialog.innerHTML,/ALERT-1/);
  assert.match(dialog.innerHTML,/ALERT-6/);
  assert.doesNotMatch(dialog.innerHTML,/ALERT-[2-5]/);
  dialog.click=()=>{};
  ctx.flmExportHubOrdersCsv_();
  const csv=await downloads.at(-1).text();
  assert.match(csv,/"ALERT-1","2026-11-16"/);
  assert.match(csv,/"ALERT-6","2026-11-16"/);
  assert.doesNotMatch(csv,/ALERT-[2-5]/);
  tabs[1].onclick();
  assert.equal(reads.length,4,'Revisiting the same feed and HUB reuses its scoped cache');

  ctx.flmOpenHubOrdersModal_('B');
  await pending();
  assert.equal(reads.length,6,'Another HUB has a different cache entry');
  assert.match(dialog.innerHTML,/URGENT-2/);
  assert.doesNotMatch(dialog.innerHTML,/URGENT-1/);
  ctx.flmOpenHubOrdersModal_('A');
  assert.equal(reads.length,6);

  gate={feed:'urgent'};
  const old=ctx.flmFetchSupabaseRiskModal_(true), stopped=reads.at(-1).signal;
  tabs[2].onclick();
  assert.equal(stopped.aborted,true,'Switching to a cached feed aborts the previous tab request');
  gate.finish(response([{id:90,deadline:'2026-11-18',fleet_final_station:'Depot A',spx_tracking:'STALE'}]));
  gate=null;
  await old;
  assert.match(dialog.innerHTML,/ALERT-1/);
  assert.doesNotMatch(dialog.innerHTML,/STALE/);

  gate={feed:'alert'};
  const oldDay=ctx.flmFetchSupabaseRiskModal_(true), oldDaySignal=reads.at(-1).signal;
  setAlertDay('2026-11-18');
  ctx.flmRiskSyncDetails_();
  assert.equal(oldDaySignal.aborted,true,'A new summary day invalidates the in-flight modal query');
  assert.equal(ctx.flmRiskModalFeedState_(a,'alert').status,'LOADING');
  gate.finish(response([{id:90,date:'2026-11-16',fleet_final_station:'Depot A',spx_tracking:'STALE'}]));
  gate=null;
  await oldDay;
  ctx.flmRenderHubOrdersModal_();
  await pending();
  assert.match(dialog.innerHTML,/Ngày Alert 2026-11-18/);
  assert.doesNotMatch(dialog.innerHTML,/ALERT-1|ALERT-6|STALE/);

  selected=['A'];
  ctx.flmRiskSyncDetails_();
  assert.equal(ctx.FLMHubOrders.active,false);
  unavailableAlert();
  ctx.flmOpenHubOrdersModal_('A');
  await pending();
  assert.equal(reads.filter(r=>r.feed==='urgent'&&r.offset==='0').length,4,'Selecting a new scope makes a separate cache key');
  now='2026-11-18T17:00:00Z';
  const beforeMidnight=reads.length;
  ctx.flmRiskSyncDetails_();
  assert.equal(ctx.FLMHubOrders.active,false);
  ctx.flmFetchSupabaseRiskModal_(false);
  assert.equal(reads.length,beforeMidnight);
  canOrder=false;
  ctx.flmOpenHubOrdersModal_('A');
  assert.equal(reads.length,beforeMidnight);

  canOrder=true;
  unavailableAlert();
  ctx.flmOpenHubOrdersModal_('A');
  await pending();
  assert.equal(reads.length,beforeMidnight+2);
  unavailableAlert();
  rejectFeed='alert';
  tabs[2].onclick();
  await pending();
  assert.match(dialog.innerHTML,/Không thể tải danh sách đơn/);
  assert.equal(ctx.flmRiskModalFeedState_(a,'urgent').status,'OK','A failed Alert query keeps cached Prelost available');
  rejectFeed='';
  retry.onclick();
  await pending();
  assert.match(dialog.innerHTML,/Alert chi tiết từ hôm nay \(Supabase\)/);

  now='2026-11-18T17:30:01Z';
  const beforeTtl=reads.length;
  ctx.flmRenderHubOrdersModal_();
  await pending();
  assert.equal(reads.length,beforeTtl+2);
  assert.ok(reads.slice(beforeTtl).every(r=>r.feed==='alert'),'Expired modal cache refreshes only the active feed');

  selected=['A','B'];
  ctx.flmCloseHubOrdersModal_();
  unavailableAlert();
  claims.riskDetailKey=ctx.flmRiskDetailKey_();
  await ctx.flmFetchSupabaseLiveRisk_(false);
  const beforeReuse=reads.length;
  ctx.flmOpenHubOrdersModal_('B');
  assert.equal(reads.length,beforeReuse,'A compatible fresh main result can satisfy a HUB modal');
  assert.match(dialog.innerHTML,/URGENT-2/);
  assert.doesNotMatch(dialog.innerHTML,/URGENT-1/);

  const day='2026-11-16';
  const respond=(call,chosenDay=day)=>call.success({
    today:call.request.anchorDate,expiresAt:new Date(Date.parse(now)+1800000).toISOString(),
    sources:[{id:'alert',status:'OK',dates:[chosenDay]},{id:'urgent',status:'EMPTY',dates:[]}]
  });
  claims.riskDetailKey='';
  ctx.flmCloseHubOrdersModal_();
  setAlertDay(day);
  ctx.flmOpenHubOrdersModal_('A');
  await pending();
  tabs[2].onclick();
  await pending();
  assert.match(dialog.innerHTML,/ALERT-1/);
  suffix='-REFRESHED';
  const modalRefresh=ctx.flmLoadRiskSummary_(true);
  assert.match(dialog.innerHTML,/Đang tải danh sách đơn/);
  assert.doesNotMatch(dialog.innerHTML,/ALERT-1/);
  respond(summaryCalls.at(-1));
  await modalRefresh;
  await pending();
  assert.match(dialog.innerHTML,/ALERT-1-REFRESHED/,'The open modal reloads when the pivot day stays the same');

  ctx.flmCloseHubOrdersModal_();
  claims.riskDetailKey=ctx.flmRiskDetailKey_();
  await ctx.flmFetchSupabaseLiveRisk_(false);
  const rk=ctx.FLMSupabaseRisk;
  assert.ok(rk.alertData.some(row=>row.orderId==='ALERT-1-REFRESHED'));
  assert.ok(storage.has(ctx.FLM_RISK_ORDERS_CACHE_KEY));
  const slow={feed:'alert'};
  gate=slow;
  const staleDetail=ctx.flmFetchSupabaseLiveRisk_(true),staleSignal=reads.at(-1).signal;
  setAlertDay(day);
  const staleSummary=ctx.flmLoadRiskSummary_(false),staleCall=summaryCalls.at(-1);
  gate=null;
  suffix='-LATEST';
  bindMain=true;
  const mainRefresh=ctx.flmLoadRiskSummary_(true),forcedCall=summaryCalls.at(-1);
  assert.equal(forcedCall.request.force,true,'Explicit refresh supersedes an automatic summary request');
  assert.equal(staleSignal.aborted,true);
  assert.equal(rk.alertData,null,'Old rows are removed while refreshing');
  assert.equal(storage.has(ctx.FLM_RISK_ORDERS_CACHE_KEY),false);
  respond(forcedCall);
  await mainRefresh;
  await mainPending;
  respond(staleCall,'2026-11-15');
  slow.finish(response([{id:99,date:day,fleet_final_station:'Depot A',spx_tracking:'STALE-DETAIL'}]));
  await Promise.all([staleSummary,staleDetail]);
  assert.equal(ctx.flmRiskAlertDetailDay_(),day);
  assert.deepEqual(clone(rk.alertData).map(row=>row.orderId),['ALERT-1-LATEST','ALERT-6-LATEST']);
  assert.deepEqual(JSON.parse(storage.get(ctx.FLM_RISK_ORDERS_CACHE_KEY)).alert.map(row=>row.orderId),['ALERT-1-LATEST','ALERT-6-LATEST']);
  assert.ok(rk.prelostData.some(row=>row.orderId==='URGENT-1-LATEST'));
  claims.tab='lost';
  claims.riskDetailKey='';
  ctx.flmCloseHubOrdersModal_();
  state.boot={};
  rk.liveFetchedAt=null;
  rk.modalSlots.clear();
  const beforeLostRisk=reads.length,beforeLostSummary=summaryCalls.length;
  ctx.flmOpenHubOrdersModal_('A');
  tabs[1].onclick();
  await pending();
  assert.equal(summaryCalls.length,beforeLostSummary,'A cold Lost modal uses independent authorized detail scoping');
  assert.deepEqual(reads.slice(beforeLostRisk).map(row=>row.feed),['urgent','urgent']);
  assert.match(dialog.innerHTML,/URGENT-1-LATEST/);
  assert.match(dialog.innerHTML,/Chưa phản hồi/,'Pivot or independent detail keeps its prior feedback label');
  aliasRows=true;
  const beforeAliasMap=reads.length;
  ctx.flmRiskSummaryEntry_(ctx.flmRiskSummaryRequest_()).data={
    basis:'supabase',stationAliases:{A:'A','DEPOT A/B':'A'},sources:[{id:'alert',status:'EMPTY',dates:[]}]
  };
  ctx.flmRenderHubOrdersModal_();
  await pending();
  assert.equal(reads.length,beforeAliasMap+2,'An authoritative alias map replaces the cached independent subset');
  assert.match(dialog.innerHTML,/URGENT-1-LATEST/);
  assert.match(dialog.innerHTML,/URGENT-2-LATEST/);
  assert.match(dialog.innerHTML,/Chưa xác định/);
  assert.doesNotMatch(dialog.innerHTML,/URGENT-[34]-LATEST|Chưa phản hồi/);
  ctx.flmExportHubOrdersCsv_();
  const scopedModalCsv=await downloads.at(-1).text();
  assert.match(scopedModalCsv,/"URGENT-2-LATEST"[^\r\n]*"Chưa xác định"/);
  console.log('PASS: HUB modal requests only its selected feed, keeps exact scoped rows, reuses compatible cache, and isolates retries, races and expiry.');
}

(async()=>{verifyPivotBackend();await verifySummaryClient();await verifyModalFeedIsolation();})().catch(error=>{console.error(error);process.exitCode=1;});
