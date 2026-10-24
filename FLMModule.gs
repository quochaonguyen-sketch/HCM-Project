/** FLM HCM adapters. Read-only: no loaders, owner gates, triggers or sheet copies.
 * Source contracts: FLM_HCM_MODULES_FOR_HAO/source-reference. */
const FLM_TEAM_CFG=Object.freeze({project:'root-opus-497613-d8',dataset:'hubops_pilot',location:'asia-southeast1',version:'flm-team-v6-source-dates',cacheSeconds:1800,historyCacheSeconds:21600,maxRows:15000});
const FLM_TEAM_VOLUME_FIELDS=Object.freeze(['pickup_request','pickup_done','seller_dts','fm_fwd_in','fm_ret_in','fm_ret_out','lh_arrived','lm_fwd_in','assigned','delivered','lm_ret_in','returned']);
function flmTeamDay_(value){
  const s=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('FLM_DATE_INVALID');return s;
}
function flmTeamShift_(day,n){return new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)}
function flmTeamAlias_(s){return String(s||'').trim().toUpperCase().replace(/\s+/g,' ').replace(/\s+HUB$/,'').replace(/\s*\/\s*/g,'/')}
function flmTeamNum_(v){if(v==null||v==='')return null;const n=Number(v);return isFinite(n)?n:null}
function flmTeamSum_(values){return values.length&&values.every(v=>v!==null&&v!==undefined&&isFinite(v))?values.reduce((a,b)=>a+b,0):null}
function flmTeamRatio_(a,b){return a==null||b==null||b<=0?null:a/b}
function flmTeamContext_(module,request){
  const access=requireAccess_(['dashboard',module]),r=request||{};
  if(access.rank==='NORMAL')throw Error('MODULE_ACCESS_DENIED');
  if(PropertiesService.getScriptProperties().getProperty('FLM_TEAM_ENABLED')==='false')throw Error('FLM_MODULE_DISABLED');
  const rule=(getModuleNavigationSettings_().modules||{})[module];
  if(!rule||!moduleRuleMatchesAccess_(rule,access))throw Error('MODULE_ACCESS_DENIED:'+module);
  const scope=assertScopeAccess_(access,r.scopeType,r.scopeValue),allowed=new Set(scope.hubCodes.map(String));
  const requested=r.selectedHubCodes==null?[]:r.selectedHubCodes;
  if(!Array.isArray(requested)||requested.length>500)throw Error('FLM_HUB_SELECTION_INVALID');
  requested.forEach(h=>{if(!allowed.has(String(h)))throw Error('HUB_ACCESS_DENIED')});
  const codes=(requested.length?Array.from(new Set(requested.map(String))):Array.from(allowed)).sort();
  if(!codes.length)throw Error('FLM_EMPTY_SCOPE');
  const day=flmTeamDay_(r.anchorDate||Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd'));
  const today=Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd');if(day>today)throw Error('FLM_FUTURE_ANCHOR');
  const stations=(getPermissionModel_(false).stations||[]),owners={},byCode={};
  stations.forEach(h=>{const code=String(h.hubCode);byCode[code]=h;[h.hubName,h.stationName,h.hubCode].filter(Boolean).forEach(name=>{const alias=flmTeamAlias_(name);if(!owners[alias])owners[alias]=new Set();owners[alias].add(code)})});
  const aliases={},ambiguous=[];
  Object.keys(owners).forEach(alias=>{const matches=Array.from(owners[alias]);if(matches.length===1&&codes.indexOf(matches[0])>=0)aliases[alias]=matches[0];else if(matches.length>1&&matches.some(c=>codes.indexOf(c)>=0))ambiguous.push(alias)});
  const ctx={access:access,scope:{type:scope.type,value:scope.value,label:scope.label,hubCount:codes.length},codes:codes,aliases:aliases,byCode:byCode,anchor:day,from:flmTeamShift_(day,-30),closing:flmTeamShift_(day,-1),to:flmTeamShift_(day,7),warnings:ambiguous.length?[ambiguous.length+' duplicate HUB aliases were excluded from the query.']:[]};
  ctx.params=[{name:'stations',parameterType:{type:'ARRAY',arrayType:{type:'STRING'}},parameterValue:{arrayValues:Object.keys(aliases).map(value=>({value:value}))}},...['from','closing','anchor','to'].map(k=>({name:k,parameterType:{type:'DATE'},parameterValue:{value:k==='anchor'?day:ctx[k]}}))];
  return ctx;
}
function flmTeamTable_(name){return '`'+FLM_TEAM_CFG.project+'.'+FLM_TEAM_CFG.dataset+'.'+name+'`'}
function flmTeamStationSql_(column){return "REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(TRIM("+column+")),r'\\s+',' '),r'\\s+HUB$',''),r'\\s*/\\s*','/') IN UNNEST(@stations)"}
function flmTeamMetadata_(table,fields){
  if(typeof BigQuery==='undefined')throw Error('BigQuery API is not enabled in Apps Script. See FLM-Integration-README.md.');
  const t=BigQuery.Tables.get(FLM_TEAM_CFG.project,FLM_TEAM_CFG.dataset,table),names=(t.schema&&t.schema.fields||[]).map(f=>f.name);
  const missing=fields.filter(f=>names.indexOf(f)<0);if(missing.length)throw Error('Schema '+table+' is missing columns: '+missing.join(', '));
  return {table:table,revision:String(t.lastModifiedTime||''),modifiedAt:t.lastModifiedTime?new Date(Number(t.lastModifiedTime)).toISOString():null};
}
function flmTeamQuery_(sql,ctx){
  if(!/^\s*(SELECT|WITH)\b/i.test(sql))throw Error('FLM_READ_ONLY_QUERY_REQUIRED');
  const c=FLM_TEAM_CFG,request={query:sql,useLegacySql:false,parameterMode:'NAMED',queryParameters:ctx.params,location:c.location,timeoutMs:10000,maxResults:c.maxRows,maximumBytesBilled:'1073741824',useQueryCache:true};
  let result=BigQuery.Jobs.query(request,c.project),end=Date.now()+25000;
  while(!result.jobComplete&&Date.now()<end){Utilities.sleep(500);result=BigQuery.Jobs.getQueryResults(c.project,result.jobReference.jobId,{location:c.location,timeoutMs:5000,maxResults:c.maxRows})}
  if(!result.jobComplete)throw Error('FLM_QUERY_TIMEOUT: retry or check the BigQuery job.');
  let rows=[],token,pages=0;
  do{
    if(++pages>100||Date.now()>end)throw Error('FLM_QUERY_TIMEOUT_OR_TOO_MANY_PAGES');
    if(result.errors&&result.errors.length)throw Error(result.errors.map(e=>e.message).join('; '));
    rows=rows.concat((result.rows||[]).map(r=>JSON.parse(r.f[0].v)));if(rows.length>c.maxRows)throw Error('FLM_RESULT_TOO_LARGE');
    token=result.pageToken;if(token)result=BigQuery.Jobs.getQueryResults(c.project,result.jobReference.jobId,{location:c.location,pageToken:token,maxResults:c.maxRows});
  }while(token);
  return rows;
}
function flmTeamCached_(kind,ctx,metadata,force,build,options){
  const opts=options||{},ttl=opts.ttlSeconds||FLM_TEAM_CFG.cacheSeconds;
  const signature=JSON.stringify([FLM_TEAM_CFG.version,FLM_TEAM_CFG.project,FLM_TEAM_CFG.dataset,FLM_TEAM_CFG.location,kind,ctx.access.email,ctx.access.rank,getSecurityVersion_(),ctx.scope,ctx.codes,ctx.aliases,ctx.anchor,metadata.map(m=>m.revision)]);
  let h=0;for(let i=0;i<signature.length;i++)h=(Math.imul(31,h)+signature.charCodeAt(i))|0;
  const key='flm-team:'+kind+':'+h,cache=CacheService.getScriptCache();
  if(!force&&metadata.every(m=>!!m.revision)){try{
    let value=cache.get(key)||'null';if(value.indexOf('gz:')===0)value=Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(value.slice(3)))).getDataAsString('UTF-8');
    const v=JSON.parse(value);if(v&&v.signature===signature&&v.expiresAt>Date.now())return v.data;
  }catch(ignored){}}
  const data=build();try{
    if(opts.cacheIf&&!opts.cacheIf(data))return data;
    let value=JSON.stringify({signature:signature,expiresAt:Date.now()+ttl*1000,data:data});
    if(value.length>16000&&typeof Utilities.gzip==='function'){
      value='gz:'+Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(value,'application/json')).getBytes());
      if(value.length<90000)cache.put(key,value,ttl);
    }else if(value.length<30000)cache.put(key,value,ttl);
  }catch(ignored){}return data;
}
// Context authorization runs before this lookup. A warm snapshot does not
// inspect BigQuery table metadata or start any query job.
function flmTeamFast_(kind,ctx,force,build){
  const today=Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd'),ttl=ctx.anchor<today?FLM_TEAM_CFG.historyCacheSeconds:FLM_TEAM_CFG.cacheSeconds;
  let built=false;
  const data=flmTeamCached_('fast:'+kind,ctx,[{revision:'ttl-snapshot-v1'}],force,()=>{
    built=true;const result=build(),ready=kind==='volume'?result.found&&(result.sources||[]).every(s=>!s.error):result.claims&&result.claims.status!=='ERROR'&&['urgent','alert'].every(k=>result.claims[k]&&result.claims[k].status==='OK')&&result.lost&&result.lost.status==='OK';
    const now=new Date();return Object.assign({},result,{cache:{stored:!!ready,cachedAt:now.toISOString(),expiresAt:ready?new Date(now.getTime()+ttl*1000).toISOString():null,ttlSeconds:ttl}});
  },{ttlSeconds:ttl,cacheIf:r=>r.cache.stored});
  return Object.assign({},data,{cache:Object.assign({},data.cache,{hit:!built,servedAt:new Date().toISOString()})});
}
function flmTeamBase_(ctx,sources){return {metricVersion:FLM_TEAM_CFG.version,scope:ctx.scope,anchorDate:ctx.anchor,closingDate:ctx.closing,from:ctx.from,to:ctx.to,sources:sources,warnings:ctx.warnings.slice(),checkedAt:new Date().toISOString()}}
/** Date availability and source checks share the same page/HUB authorization as data. */
function flmTeamGetSourceStatus(request){
  const r=request||{},module=String(r.module||'');if(!['backlog','compensated','snapshot'].includes(module))throw Error('FLM_SOURCE_MODULE_INVALID');
  requireAccess_([module==='snapshot'?'dashboard':module]);
  const today=Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd'),selection=Object.assign({},r,{anchorDate:today}),contexts={};
  if(module==='snapshot'){
    ['backlog','compensated'].forEach(name=>{try{contexts[name]=flmTeamContext_(name,selection)}catch(err){if(!/MODULE_ACCESS_DENIED|FLM_MODULE_DISABLED/.test(String(err.message)))throw err}});
    if(!contexts.backlog&&!contexts.compensated)throw Error('MODULE_ACCESS_DENIED');
  }else contexts[module]=flmTeamContext_(module,selection);
  const ctx=contexts.backlog||contexts.compensated;
  // Bound scans to one year. Forecast checks also include the existing D+7 horizon.
  ctx.from=flmTeamShift_(today,-365);ctx.params=ctx.params.map(p=>p.name==='from'?Object.assign({},p,{parameterValue:{value:ctx.from}}):p);
  return flmTeamCached_('source-status:'+module,ctx,[{revision:'scoped-dates-v1'}],r.force===true,()=>{
    const checkedAt=new Date().toISOString(),sources=[];
    function result(id,label,rows,meta,expected,kind){
      const sorted=rows.filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(String(row.d||''))).sort((a,b)=>String(b.d).localeCompare(String(a.d))),latest=sorted[0],dates=Array.from(new Set(sorted.map(row=>String(row.d))));
      return {id:id,label:label,status:latest?(kind==='records'?'AVAILABLE':String(latest.d)<expected?'OLDER':'AVAILABLE'):'EMPTY',latestDate:latest?String(latest.d):null,latestAt:latest&&latest.ingested_at||meta.modifiedAt||null,dates:dates,rows:latest?Number(latest.row_count==null?latest.rows||0:latest.row_count):0,reportingHubs:latest?Number(latest.hubs||0):0,expectedHubs:ctx.codes.length,expectedDate:expected,kind:kind||'snapshot',checkedAt:checkedAt};
    }
    function error(id,label,err){return {id:id,label:label,status:'ERROR',latestDate:null,latestAt:null,dates:[],expectedHubs:ctx.codes.length,checkedAt:checkedAt,message:'This source could not be read. Check its connection, access and required columns.'}}
    function dated(id,label,table,kind){
      try{
        const fields=['d','station'].concat(table==='flm_volume_snapshot'?FLM_TEAM_VOLUME_FIELDS:table==='flm_backlog_daily'?['fm_backlog','lm_backlog']:['mapped','ingested_at','amt','reason','shipment_id']),meta=flmTeamMetadata_(table,fields),sql='SELECT TO_JSON_STRING(t) FROM (SELECT d,COUNT(*) AS row_count,COUNT(DISTINCT REGEXP_REPLACE(UPPER(TRIM(station)),r\'\\s+HUB$\',\'\')) AS hubs'+(kind==='records'?',MAX(ingested_at) AS ingested_at':'')+' FROM '+flmTeamTable_(table)+' WHERE d BETWEEN @from AND @closing AND '+(kind==='records'?'mapped AND ':'')+flmTeamStationSql_('station')+' GROUP BY d) t';
        sources.push(result(id,label,flmTeamQuery_(sql,ctx),meta,ctx.closing,kind));
      }catch(err){sources.push(error(id,label,err))}
    }
    if(contexts.backlog){
      dated('volume','Volume / calculated backlog','flm_volume_snapshot','snapshot');dated('backlog','Stored backlog','flm_backlog_daily','snapshot');
      if(module==='backlog')try{
        const meta=flmTeamMetadata_('fc_raw',['d','station','flm','qty','fc_updated']),counts=flmTeamQuery_('SELECT TO_JSON_STRING(t) FROM (SELECT COUNT(*) AS row_count,COUNT(DISTINCT station) AS hubs FROM '+flmTeamTable_('fc_raw')+' WHERE d BETWEEN DATE_SUB(@anchor,INTERVAL 30 DAY) AND @to AND '+flmTeamStationSql_('station')+') t',ctx)[0]||{},stamp=meta.modifiedAt?Utilities.formatDate(new Date(meta.modifiedAt),'Asia/Ho_Chi_Minh','yyyy-MM-dd'):null;
        sources.push({id:'forecast',label:'Forecast',status:Number(counts.row_count==null?counts.rows||0:counts.row_count)?stamp&&stamp<today?'OLDER':'AVAILABLE':'EMPTY',latestDate:stamp,latestAt:meta.modifiedAt||null,dates:[],rows:Number(counts.row_count==null?counts.rows||0:counts.row_count),reportingHubs:Number(counts.hubs||0),expectedHubs:ctx.codes.length,expectedDate:today,kind:'forecast',horizon:{from:flmTeamShift_(today,-30),to:ctx.to},checkedAt:checkedAt});
      }catch(err){sources.push(error('forecast','Forecast',err))}
    }
    if(contexts.compensated){
      if(module==='compensated')try{
        const meta=flmTeamMetadata_('flm_claim_current',['source','station','mapped','snapshot_date','ingested_at','group_aging','stage','high_value','feedback','cogs','shipment_id']);
        // Global dates establish that an empty authorized scope is a valid zero.
        // Only authorized HUB counts are returned; no other HUB identities/rows.
        const data=flmTeamQuery_('WITH dates AS (SELECT source,snapshot_date AS d,MAX(ingested_at) AS ingested_at FROM '+flmTeamTable_('flm_claim_current')+' WHERE snapshot_date BETWEEN @from AND @anchor GROUP BY source,d),scoped AS (SELECT source,snapshot_date AS d,COUNT(*) AS row_count,COUNT(DISTINCT station) AS hubs FROM '+flmTeamTable_('flm_claim_current')+' WHERE mapped AND snapshot_date BETWEEN @from AND @anchor AND '+flmTeamStationSql_('station')+' GROUP BY source,d) SELECT TO_JSON_STRING(t) FROM (SELECT dates.*,IFNULL(scoped.row_count,0) AS row_count,IFNULL(scoped.hubs,0) AS hubs FROM dates LEFT JOIN scoped USING(source,d)) t',ctx);
        [['urgent','Prelost'],['alert','Alerts']].forEach(pair=>sources.push(result(pair[0],pair[1],data.filter(row=>row.source===pair[0]),meta,today,'snapshot')));
      }catch(err){sources.push(error('urgent','Prelost',err),error('alert','Alerts',err))}
      dated('lost','Lost records','flm_lost_current','records');
    }
    return {ok:sources.every(s=>s.status!=='ERROR'),module:module,scope:ctx.scope,checkedAt:checkedAt,today:today,closingDate:ctx.closing,dateWindow:{from:ctx.from,to:today},sources:sources,note:'Availability describes readable data, not whether an upstream job is running. A day without Lost records does not prove zero losses.'};
  },{ttlSeconds:300,cacheIf:out=>out.ok});
}
function flmTeamGetVolume(request){
  const ctx=flmTeamContext_('backlog',request);
  const data=flmTeamFast_('volume',ctx,request&&request.force===true,()=>flmTeamReadVolume_(ctx,request));
  if(ctx.access.customAccess&&!(ctx.access.allowedPages||[]).includes('backlog')){
    function snapshot(r){return {date:r.date,fm_backlog:r.fm_backlog,lm_backlog:r.lm_backlog,metricCoverage:{fm_backlog:r.metricCoverage.fm_backlog,lm_backlog:r.metricCoverage.lm_backlog}}}
    return Object.assign({},data,{totals:snapshot(data.totals),series:data.series.map(snapshot),hubRows:[],coverage:{expectedHubs:data.coverage.expectedHubs,reportingHubs:data.coverage.reportingHubs}});
  }
  return data;
}
function flmTeamReadVolume_(ctx,request){
  const volume=flmTeamMetadata_('flm_volume_snapshot',['d','station'].concat(FLM_TEAM_VOLUME_FIELDS));
  const backlog=flmTeamMetadata_('flm_backlog_daily',['d','station','fm_backlog','lm_backlog']);
  let forecast;try{forecast=flmTeamMetadata_('fc_raw',['d','station','flm','qty','fc_updated'])}catch(err){forecast={table:'fc_raw',error:String(err.message||err),revision:'error'}}
  return flmTeamCached_('volume',ctx,[volume,backlog,forecast],request&&request.force===true,()=>{
    const fields=FLM_TEAM_VOLUME_FIELDS.map(k=>'ANY_VALUE('+k+') AS '+k).join(',');
    const sql='WITH v AS (SELECT d,station,COUNT(*) AS volume_rows,'+fields+' FROM '+flmTeamTable_('flm_volume_snapshot')+' WHERE d BETWEEN @from AND @anchor AND '+flmTeamStationSql_('station')+' GROUP BY d,station),b AS (SELECT d,station,COUNT(*) AS backlog_rows,ANY_VALUE(fm_backlog) AS fm_backlog,ANY_VALUE(lm_backlog) AS lm_backlog FROM '+flmTeamTable_('flm_backlog_daily')+' WHERE d BETWEEN @from AND @anchor AND '+flmTeamStationSql_('station')+' GROUP BY d,station) SELECT TO_JSON_STRING(t) FROM (SELECT v.*,b.backlog_rows,b.fm_backlog AS stored_fm_backlog,b.lm_backlog AS stored_lm_backlog FROM v LEFT JOIN b USING(d,station)) t';
    const raw=flmTeamQuery_(sql,ctx);
    let fc=[],warning=forecast.error;
    if(!warning)try{fc=flmTeamQuery_('SELECT TO_JSON_STRING(t) FROM (SELECT d,station,flm,qty,fc_updated FROM '+flmTeamTable_('fc_raw')+' WHERE d BETWEEN @from AND @to AND '+flmTeamStationSql_('station')+' QUALIFY ROW_NUMBER() OVER(PARTITION BY d,station,flm ORDER BY fc_updated DESC)=1) t',ctx)}catch(err){warning=String(err.message||err)}
    const out=Object.assign(flmTeamBase_(ctx,[volume,backlog,forecast]),flmTeamVolumeBuild_(raw,fc,ctx));
    if(warning)out.warnings.push('Forecast unavailable: '+warning);
    return out;
  });
}
function flmTeamVolumeBuild_(raw,fc,ctx){
  const records={},forecasts={},fields=FLM_TEAM_VOLUME_FIELDS;
  raw.forEach(r=>{
    const code=ctx.aliases[flmTeamAlias_(r.station)];if(!code)throw Error('FLM_UNAUTHORIZED_SOURCE_HUB');
    const d=flmTeamDay_(r.d),key=code+'|'+d;if(records[key]||Number(r.volume_rows)!==1||Number(r.backlog_rows)>1)throw Error('FLM_DUPLICATE_HUB_DAY');
    const x={hubCode:code,date:d};fields.forEach(f=>x[f]=flmTeamNum_(r[f]));
    x.fm_backlog=x.pickup_request==null||x.pickup_done==null?null:Math.max(0,x.pickup_request-x.pickup_done);
    x.lm_backlog=[x.assigned,x.delivered,x.lm_ret_in,x.returned].some(v=>v==null)?null:Math.max(0,x.assigned-x.delivered+x.lm_ret_in-x.returned);
    x.backlogMismatch=['fm','lm'].some(leg=>flmTeamNum_(r['stored_'+leg+'_backlog'])!=null&&x[leg+'_backlog']!=null&&Math.abs(x[leg+'_backlog']-Number(r['stored_'+leg+'_backlog']))>.01);records[key]=x;
  });
  fc.forEach(r=>{const code=ctx.aliases[flmTeamAlias_(r.station)],leg=String(r.flm).toUpperCase();if(!code)throw Error('FLM_UNAUTHORIZED_SOURCE_HUB');if(['FM','LM'].indexOf(leg)<0)return;const key=code+'|'+flmTeamDay_(r.d)+'|'+leg;if(Object.prototype.hasOwnProperty.call(forecasts,key))throw Error('FLM_DUPLICATE_FORECAST');forecasts[key]=flmTeamNum_(r.qty)});
  const dates=Array.from({length:38},(_,i)=>flmTeamShift_(ctx.from,i));
  const dailyCache={},averageCache={};
  function knownSum(values){return flmTeamSum_(values.filter(v=>v!=null))}
  function metricCoverage(count,expected){return {reportingHubs:count,expectedHubs:expected,partial:count<expected}}
  function daily(date,codes){
    const key=date+'|'+codes.join(',');if(dailyCache[key])return dailyCache[key];
    const rs=codes.map(c=>records[c+'|'+date]||null),out={date:date,reportingHubs:rs.filter(Boolean).length,expectedHubs:codes.length,metricCoverage:{}};
    fields.concat(['fm_backlog','lm_backlog']).forEach(f=>{const values=rs.map(r=>r?r[f]:null);out[f]=knownSum(values);out.metricCoverage[f]=metricCoverage(values.filter(v=>v!=null).length,codes.length)});
    ['FM','LM'].forEach(leg=>{
      const prefix=leg.toLowerCase(),f=prefix+'_forecast',values=codes.map(c=>forecasts[c+'|'+date+'|'+leg]);
      out[f]=knownSum(values);out.metricCoverage[f]=metricCoverage(values.filter(v=>v!=null).length,codes.length);
      // Compare actual/forecast only for HUBs with both inputs on this day.
      const actualField=leg==='FM'?'fm_fwd_in':'lm_fwd_in',pairs=codes.map((c,i)=>({actual:rs[i]&&rs[i][actualField],forecast:forecasts[c+'|'+date+'|'+leg]})).filter(p=>p.actual!=null&&p.forecast!=null);
      const ratio=flmTeamRatio_(knownSum(pairs.map(p=>p.actual)),knownSum(pairs.map(p=>p.forecast)));
      out[prefix+'_gap']=ratio==null?null:ratio-1;out.metricCoverage[prefix+'_gap']=metricCoverage(pairs.length,codes.length);
    });dailyCache[key]=out;return out;
  }
  function cohort(date,field){return ctx.codes.filter(code=>{const r=records[code+'|'+date];return r&&r[field]!=null})}
  function average(codes,field){
    const key=field+'|'+codes.join(',');if(averageCache[key])return averageCache[key];
    // The same fixed HUB set must report every included daily denominator.
    const days=Array.from({length:14},(_,i)=>daily(flmTeamShift_(ctx.closing,-i),codes)).filter(r=>codes.length&&r.metricCoverage[field].reportingHubs===codes.length&&r[field]>0);
    return averageCache[key]={value:days.length?days.reduce((a,r)=>a+r[field],0)/days.length:null,days:days.length};
  }
  const series=dates.map(d=>daily(d,ctx.codes)),closing=series.find(d=>d.date===ctx.closing);
  const hubRows=ctx.codes.map(code=>{const h=ctx.byCode[code]||{},r=Object.assign({},daily(ctx.closing,[code]));r.hubCode=code;r.station=h.hubName||h.stationName||code;r.fm_dtc=flmTeamRatio_(r.fm_backlog,average([code],'pickup_done').value);r.lm_dtc=flmTeamRatio_(r.lm_backlog,average([code],'delivered').value);return r});
  const totals=Object.assign({},closing,{metricCoverage:Object.assign({},closing.metricCoverage)});
  ['fm','lm'].forEach(leg=>{
    const field=leg+'_backlog',codes=cohort(ctx.closing,field),denominator=average(codes,leg==='fm'?'pickup_done':'delivered');
    totals[leg+'_dtc']=flmTeamRatio_(totals[field],denominator.value);
    totals.metricCoverage[leg+'_dtc']=Object.assign(metricCoverage(codes.length,ctx.codes.length),{historyDays:denominator.days,historyWindow:14});
    // Risk uses the closing-day cohort throughout its historical comparison.
    const history=series.filter(r=>r.date<=ctx.closing).map(r=>daily(r.date,codes)).filter(r=>codes.length&&r.metricCoverage[field].reportingHubs===codes.length&&r[field]!=null).map(r=>r[field]);
    const mean=history.length?history.reduce((a,b)=>a+b,0)/history.length:null,ratio=flmTeamRatio_(totals[leg+'_backlog'],mean);
    totals[leg+'_risk']=ratio==null?null:ratio-1;
    totals.metricCoverage[leg+'_risk']=Object.assign(metricCoverage(codes.length,ctx.codes.length),{historyDays:history.length,historyWindow:30});
    series.forEach(r=>{const dayCodes=cohort(r.date,field),baseline=average(dayCodes,leg==='fm'?'pickup_done':'delivered');r[leg+'_dtc']=flmTeamRatio_(r[field],baseline.value);r.metricCoverage[leg+'_dtc']=Object.assign(metricCoverage(dayCodes.length,ctx.codes.length),{historyDays:baseline.days,historyWindow:14})});
  });
  const mismatches=Object.keys(records).filter(k=>records[k].backlogMismatch).length;
  const missingHubs=ctx.codes.map(code=>{const r=records[code+'|'+ctx.closing],h=ctx.byCode[code]||{};return {hubCode:code,station:h.hubName||h.stationName||code,missingRow:!r,missingFields:fields.filter(f=>!r||r[f]==null)}}).filter(h=>h.missingFields.length);
  return {found:raw.length>0,totals:totals,series:series,hubRows:hubRows,dataAsOf:raw.map(r=>r.d).sort().pop()||null,coverage:{expectedHubs:ctx.codes.length,reportingHubs:closing.reportingHubs,metrics:totals.metricCoverage,missingHubs:missingHubs},backlogMismatches:mismatches,limitations:['Detailed aging, inbound and capacity require separate sources; they are not inferred from the volume table.'],formulas:{fm:'max(0, Pickup Requests − Pickup Done)',lm:'max(0, Assigned − Delivered + LM Return Inbound − Returned)',gap:'Actual / Forecast − 1; only HUBs with both inputs',dtc:'Backlog for reporting HUBs / average positive daily volume L14D for the same HUB cohort; only complete cohort days',risk:'Closing-day backlog / average backlog L30D for the same HUB cohort − 1; only complete cohort days (>15% needs review)'}};
}
function flmTeamGetClaims(request){
  const ctx=flmTeamContext_('compensated',request);
  const data=flmTeamFast_('claims',ctx,request&&request.force===true,()=>flmTeamReadClaims_(ctx,request));
  return ctx.access.customAccess&&!(ctx.access.allowedPages||[]).includes('compensated')?Object.assign({},data,{claims:{status:'ACCESS_DENIED'}}):data;
}
function flmTeamReadClaims_(ctx,request){
  const out=flmTeamBase_(ctx,[]);
  function part(name,run){try{out[name]=run()}catch(err){out[name]={status:'ERROR',error:String(err.message||err)};out.warnings.push(name+': '+String(err.message||err))}}
  part('claims',()=>{
    const meta=flmTeamMetadata_('flm_claim_current',['source','station','mapped','group_aging','stage','high_value','feedback','cogs','shipment_id','snapshot_date','ingested_at']);out.sources.push(meta);
    return flmTeamCached_('claims',ctx,[meta],request&&request.force===true,()=>{
      // One job returns source dates and scoped aggregates. Source dates are
      // deliberately independent of scope, so an empty authorized HUB is zero
      // only when the requested snapshot actually exists.
      const data=flmTeamQuery_('WITH latest AS (SELECT source,ARRAY_AGG(STRUCT(snapshot_date,ingested_at) ORDER BY snapshot_date DESC,ingested_at DESC LIMIT 1)[OFFSET(0)] AS latest_row,COUNTIF(snapshot_date=@anchor)>0 AS requested_available,MAX(IF(snapshot_date=@anchor,ingested_at,NULL)) AS requested_ingested_at FROM '+flmTeamTable_('flm_claim_current')+' base GROUP BY source),scoped AS (SELECT *,COUNT(*) OVER(PARTITION BY source,shipment_id) AS duplicate_count FROM '+flmTeamTable_('flm_claim_current')+' WHERE mapped AND snapshot_date=@anchor AND '+flmTeamStationSql_('station')+'),grouped AS (SELECT source,station,group_aging,stage,high_value,feedback,snapshot_date,COUNT(*) AS n,SUM(cogs) AS cogs,COUNTIF(cogs IS NULL) AS missing_cogs,MAX(duplicate_count) AS max_duplicate FROM scoped GROUP BY source,station,group_aging,stage,high_value,feedback,snapshot_date) SELECT TO_JSON_STRING(t) FROM (SELECT \'meta\' AS row_kind,source,latest_row.snapshot_date AS snapshot_date,IF(requested_available,requested_ingested_at,latest_row.ingested_at) AS ingested_at,requested_available FROM latest) t UNION ALL SELECT TO_JSON_STRING(t) FROM (SELECT \'group\' AS row_kind,grouped.* FROM grouped) t',ctx);
      return flmTeamClaimsBuild_(data.filter(r=>r.row_kind==='group'),data.filter(r=>r.row_kind==='meta'),ctx);
    });
  });
  part('lost',()=>{
    const meta=flmTeamMetadata_('flm_lost_current',['d','station','mapped','amt','reason','shipment_id','ingested_at']);out.sources.push(meta);
    return flmTeamCached_('lost',ctx,[meta],request&&request.force===true,()=>{
      const data=flmTeamQuery_('WITH scoped AS (SELECT *,COUNT(*) OVER(PARTITION BY d,station,shipment_id) AS duplicate_count FROM '+flmTeamTable_('flm_lost_current')+' WHERE mapped AND d BETWEEN LEAST(@from,DATE_TRUNC(@closing,MONTH)) AND @closing AND '+flmTeamStationSql_('station')+') SELECT TO_JSON_STRING(t) FROM (SELECT d,station,reason,COUNT(*) AS n,SUM(amt) AS amount,COUNTIF(amt IS NULL) AS missing_amount,MAX(ingested_at) AS ingested_at,MAX(duplicate_count) AS max_duplicate FROM scoped GROUP BY d,station,reason) t',ctx);
      return flmTeamLostBuild_(data,ctx);
    });
  });
  out.limitations=['Công nợ và bồi thường đã thanh toán chưa có nguồn hợp lệ. Trang hiển thị COGS có rủi ro và Lost ghi nhận từ nguồn hiện có.'];
  return out;
}
function flmTeamClaimsBuild_(groups,metadata,ctx){
  const sections={};
  ['urgent','alert'].forEach(source=>{
    const meta=metadata.find(m=>m.source===source),ok=meta&&(String(meta.snapshot_date)===ctx.anchor||meta.requested_available===true);
    const hubs={},total={n:0,cogs:null,knownCogs:0,missingCogs:0,hv:source==='urgent'?0:null,hvCogs:source==='urgent'?0:null,hvKnownCogs:source==='urgent'?0:null,hvMissingCogs:0,pendingFeedback:0,respondedFeedback:0,otherFeedback:0,aging:Object.create(null),stages:Object.create(null)};
    if(ok)groups.filter(r=>r.source===source).forEach(r=>{
      if(Number(r.max_duplicate)>1)throw Error('FLM_DUPLICATE_CLAIM_SHIPMENT');
      if(String(r.snapshot_date)!==ctx.anchor)throw Error('FLM_CLAIM_DATE_MISMATCH');
      const code=ctx.aliases[flmTeamAlias_(r.station)];if(!code)throw Error('FLM_UNAUTHORIZED_SOURCE_HUB');
      const info=ctx.byCode[code]||{},h=hubs[code]||(hubs[code]={hubCode:code,station:info.hubName||code,n:0,knownCogs:0,missingCogs:0,hv:0,hvCogs:0,hvMissingCogs:0,aging:Object.create(null),stages:Object.create(null),feedback:Object.create(null)}),n=Number(r.n),c=flmTeamNum_(r.cogs);
      if(!Number.isSafeInteger(n)||n<1||!Number.isSafeInteger(Number(r.missing_cogs||0))||Number(r.missing_cogs||0)<0||Number(r.missing_cogs||0)>n||c==null&&Number(r.missing_cogs||0)<n)throw Error('FLM_CLAIM_AGGREGATE_INVALID');
      h.n+=n;h.knownCogs+=c||0;h.missingCogs+=Number(r.missing_cogs||0);h.aging[r.group_aging||'Chưa có aging']=(h.aging[r.group_aging||'Chưa có aging']||0)+n;h.stages[r.stage||'UNKNOWN']=(h.stages[r.stage||'UNKNOWN']||0)+n;h.feedback[r.feedback||'Chưa có feedback']=(h.feedback[r.feedback||'Chưa có feedback']||0)+n;
      if(r.high_value===true||r.high_value==='true'){h.hv+=n;h.hvCogs+=c||0;h.hvMissingCogs+=Number(r.missing_cogs||0)}
    });
    const list=Object.keys(hubs).map(k=>{const h=hubs[k];h.cogs=h.missingCogs?null:h.knownCogs;total.n+=h.n;total.knownCogs+=h.knownCogs;total.missingCogs+=h.missingCogs;
      h.pendingFeedback=(h.feedback['Chưa phản hồi']||0)+(h.feedback['Chưa có feedback']||0);h.respondedFeedback=h.feedback['Đã phản hồi']||0;h.otherFeedback=h.n-h.pendingFeedback-h.respondedFeedback;
      total.pendingFeedback+=h.pendingFeedback;total.respondedFeedback+=h.respondedFeedback;total.otherFeedback+=h.otherFeedback;
      ['aging','stages'].forEach(field=>Object.keys(h[field]).forEach(key=>total[field][key]=(total[field][key]||0)+h[field][key]));
      if(source==='urgent'){total.hv+=h.hv;total.hvCogs+=h.hvCogs;total.hvKnownCogs+=h.hvCogs;total.hvMissingCogs+=h.hvMissingCogs;h.hvKnownCogs=h.hvCogs;if(h.hvMissingCogs)h.hvCogs=null}return h}).sort((a,b)=>b.knownCogs-a.knownCogs||a.station.localeCompare(b.station));
    total.cogs=ok&&!total.missingCogs?total.knownCogs:null;
    if(total.hvMissingCogs)total.hvCogs=null;
    sections[source]={status:ok?'OK':'SNAPSHOT_UNAVAILABLE',snapshotDate:ok?ctx.anchor:meta?String(meta.snapshot_date):null,latestSnapshotDate:meta?String(meta.snapshot_date):null,ingestedAt:meta&&meta.ingested_at||null,requestedDate:ctx.anchor,total:ok?total:null,hubs:list,agingOrder:Array.from(new Set(list.flatMap(h=>Object.keys(h.aging)))).sort()};
  });
  return sections;
}
function flmTeamLostBuild_(rows,ctx){
  function empty(){return {n:0,amount:0,knownAmount:0,missingAmount:0}}
  function period(from){return {from:from,to:ctx.closing,total:empty(),hubs:Object.create(null),days:Object.create(null),reasons:Object.create(null)}}
  const month=ctx.closing.slice(0,7)+'-01',periods={l30d:period(ctx.from),mtd:period(month)};let dataAsOf=null,ingestedAt=null;
  rows.forEach(r=>{
    if(Number(r.max_duplicate)>1)throw Error('FLM_DUPLICATE_LOST_DAY_HUB_SHIPMENT');
    const code=ctx.aliases[flmTeamAlias_(r.station)];if(!code)throw Error('FLM_UNAUTHORIZED_SOURCE_HUB');
    const date=flmTeamDay_(r.d),n=Number(r.n),amount=flmTeamNum_(r.amount),missing=Number(r.missing_amount||0);
    if(!Number.isSafeInteger(n)||n<1||!Number.isSafeInteger(missing)||missing<0||missing>n||amount==null&&missing<n)throw Error('FLM_LOST_AGGREGATE_INVALID');
    if(date>ctx.closing||date<(month<ctx.from?month:ctx.from))throw Error('FLM_LOST_DATE_MISMATCH');
    if(!dataAsOf||date>dataAsOf)dataAsOf=date;if(!ingestedAt||r.ingested_at>ingestedAt)ingestedAt=r.ingested_at;
    function add(o){o.n+=n;o.knownAmount+=amount||0;o.missingAmount+=missing}
    Object.keys(periods).forEach(key=>{const p=periods[key];if(date<p.from)return;add(p.total);
      const info=ctx.byCode[code]||{},reason=String(r.reason||'Chưa ghi lý do');
      add(p.hubs[code]||(p.hubs[code]=Object.assign(empty(),{hubCode:code,station:info.hubName||code})));
      add(p.days[date]||(p.days[date]=Object.assign(empty(),{date:date})));
      add(p.reasons[reason]||(p.reasons[reason]=Object.assign(empty(),{reason:reason})));
    });
  });
  Object.keys(periods).forEach(key=>{const p=periods[key];[p.total].concat(Object.values(p.hubs),Object.values(p.days),Object.values(p.reasons)).forEach(o=>o.amount=o.missingAmount?null:o.knownAmount);
    p.hubRows=Object.values(p.hubs).sort((a,b)=>b.knownAmount-a.knownAmount||a.station.localeCompare(b.station));p.series=Object.values(p.days).sort((a,b)=>a.date.localeCompare(b.date));p.reasons=Object.values(p.reasons).sort((a,b)=>b.n-a.n);delete p.hubs;delete p.days;
  });
  const p=periods.l30d;
  return {status:'OK',total:p.total,mtd:periods.mtd.total,dataAsOf:dataAsOf,ingestedAt:ingestedAt,hubRows:p.hubRows,series:p.series,reasons:p.reasons,periods:periods,note:'Số bản ghi phân bổ theo HUB; một shipment có thể thuộc nhiều HUB. Không cộng Prelost, Alert và Lost thành một tổng đơn duy nhất. Ngày không có bản ghi chưa chứng minh nguồn đã đầy đủ.'};
}
