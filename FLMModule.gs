/** FLM HCM adapters. Read-only: no loaders, owner gates, triggers or sheet copies.
 * Source contracts: FLM_HCM_MODULES_FOR_HAO/source-reference. */
const FLM_TEAM_CFG=Object.freeze({project:'root-opus-497613-d8',dataset:'hubops_pilot',location:'asia-southeast1',version:'flm-team-v10-claims-modal',cacheSeconds:1800,historyCacheSeconds:21600,maxRows:15000});
const FLM_TEAM_VOLUME_FIELDS=Object.freeze(['pickup_request','pickup_done','seller_dts','fm_fwd_in','fm_ret_in','fm_ret_out','lh_arrived','lm_fwd_in','assigned','delivered','lm_ret_in','returned']);
function flmTeamDay_(value){
  const s=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('FLM_DATE_INVALID');return s;
}
function flmTeamShift_(day,n){return new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)}
function flmTeamAlias_(s){return String(s||'').trim().toUpperCase().replace(/\s+/g,' ').replace(/\s+HUB$/,'').replace(/\s*\/\s*/g,'/')}
function flmTeamNum_(v){if(v==null||v==='')return null;const n=Number(v);return isFinite(n)?n:null}
function flmTeamSum_(values){return values.length&&values.every(v=>v!==null&&v!==undefined&&isFinite(v))?values.reduce((a,b)=>a+b,0):null}
function flmTeamRatio_(a,b){return a==null||b==null||b<=0?null:a/b}
function flmMatchHubCode_(raw,ctx){
  if(!raw||!ctx)return null;
  const alias=flmTeamAlias_(raw);
  if(!alias)return null;
  if(ctx.aliases&&ctx.aliases[alias])return ctx.aliases[alias];
  if(ctx.aliases){
    for(const k in ctx.aliases){
      if(k.indexOf(alias)===0||alias.indexOf(k)===0)return ctx.aliases[k];
    }
    const normAlias=alias.replace(/[^A-Z0-9]/g,'');
    if(normAlias.length>=4){
      for(const k in ctx.aliases){
        const normK=k.replace(/[^A-Z0-9]/g,'');
        if(normK.indexOf(normAlias)===0||normAlias.indexOf(normK)===0)return ctx.aliases[k];
      }
    }
    const m=/^(\d{2}-HCM)\s+([A-Z0-9]+)/i.exec(alias);
    if(m){
      const prefix=(m[1]+' '+m[2]).toUpperCase();
      for(const k in ctx.aliases){
        if(k.indexOf(prefix)===0)return ctx.aliases[k];
      }
    }
  }
  return null;
}
function flmMasterHubMap_(){
  const cached=flmCacheGet_('flm:master-hub-map:v1');
  if(cached&&cached.aliases)return cached;
  const stations=(typeof getPermissionModel_==='function'&&getPermissionModel_(false).stations)||[];
  const owners={},byCode={};
  stations.forEach(h=>{
    const code=String(h.hubCode);byCode[code]=h;
    [h.hubName,h.stationName,h.hubCode].filter(Boolean).forEach(name=>{
      const alias=flmTeamAlias_(name);
      if(!owners[alias])owners[alias]=new Set();
      owners[alias].add(code);
    });
  });
  const aliases={};
  Object.keys(owners).forEach(alias=>{
    const matches=Array.from(owners[alias]);
    if(matches.length===1)aliases[alias]=matches[0];
  });
  const res={codes:stations.map(s=>String(s.hubCode)),aliases:aliases,byCode:byCode};
  flmCachePut_('flm:master-hub-map:v1',res,21600);
  return res;
}
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
  const today=Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd'),maxAnchor=flmTeamShift_(today,1);if(day>maxAnchor)throw Error('FLM_FUTURE_ANCHOR');
  const stations=(getPermissionModel_(false).stations||[]),owners={},byCode={};
  stations.forEach(h=>{const code=String(h.hubCode);byCode[code]=h;[h.hubName,h.stationName,h.hubCode].filter(Boolean).forEach(name=>{const alias=flmTeamAlias_(name);if(!owners[alias])owners[alias]=new Set();owners[alias].add(code)})});
  const aliases={},masterAliases={},ambiguous=[];
  Object.keys(owners).forEach(alias=>{const matches=Array.from(owners[alias]);if(matches.length===1){masterAliases[alias]=matches[0];if(codes.includes(matches[0]))aliases[alias]=matches[0];}else if(matches.some(c=>codes.includes(c)))ambiguous.push(alias)});
  const ctx={access:access,scope:{type:scope.type,value:scope.value,label:scope.label,hubCount:codes.length},codes:codes,aliases:aliases,masterAliases:masterAliases,byCode:byCode,anchor:day,from:flmTeamShift_(day,-30),closing:flmTeamShift_(day,-1),to:flmTeamShift_(day,7),warnings:ambiguous.length?[ambiguous.length+' duplicate HUB aliases were excluded from the query.']:[]};
  ctx.params=[{name:'stations',parameterType:{type:'ARRAY',arrayType:{type:'STRING'}},parameterValue:{arrayValues:Object.keys(aliases).map(value=>({value:value}))}},...['from','closing','anchor','to'].map(k=>({name:k,parameterType:{type:'DATE'},parameterValue:{value:k==='anchor'?day:ctx[k]}}))];
  return ctx;
}
function flmTeamTable_(name){return '`'+FLM_TEAM_CFG.project+'.'+FLM_TEAM_CFG.dataset+'.'+name+'`'}
function flmTeamStationSql_(column){return "REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(TRIM("+column+")),r'\\s+',' '),r'\\s+HUB$',''),r'\\s*/\\s*','/') IN UNNEST(@stations)"}

const FLM_LOST_REST_URL='https://aqvcybxcfgicxmzpczgd.supabase.co/rest/v1/lost_orders';
const FLM_LOST_SUMMARY_FIELDS=['ngay_chot','hub','trang_thai_he_thong','last_status_spx','log_loi_cuoi','loai_yeu_cau','cod_cogs','so_tien_den_bu','ly_do','ket_qua'];
const FLM_LOST_DETAIL_FIELDS=FLM_LOST_SUMMARY_FIELDS.concat(['spx_tracking','khu_vuc','thoi_gian_trang_thai_cuoi','rider','co_log_loi','thoi_gian_log_loi','last_user']);

function flmLostHubCode_(raw,aliases){
  const alias=flmTeamAlias_(raw);
  return Object.prototype.hasOwnProperty.call(aliases,alias)?aliases[alias]:null;
}

function flmLostAllowsDetails_(access){
  return ['ROM','ADMIN','SAOM','HUB','LEAD','SUP'].includes(access.rank);
}

function flmLostContext_(page,request){
  try{
    const r=request||{};
    const ctx=flmTeamContext_('compensated',{scopeType:r.scopeType,scopeValue:r.scopeValue,selectedHubCodes:r.selectedHubCodes});
    assertPageAccess_(ctx.access,[page]);
    return ctx;
  }catch(_){throw Error('LOST_ACCESS');}
}

function flmLostStationFilters_(ctx){
  const allowed=new Set(ctx.codes.map(String)),names=new Set();
  Object.keys(ctx.aliases).forEach(alias=>{
    if(!allowed.has(ctx.aliases[alias]))return;
    names.add(alias);
    names.add(alias+' HUB');
    if(alias.includes('/')){
      const spaced=alias.replace(/\//g,' / ');
      names.add(spaced);
      names.add(spaced+' HUB');
    }
  });
  ctx.codes.forEach(code=>{
    const station=ctx.byCode[code]||{};
    [station.hubName,station.stationName,String(code)].filter(Boolean).forEach(name=>{
      if(flmLostHubCode_(name,ctx.aliases)===String(code))names.add(String(name).trim());
    });
  });
  const filters=[];
  // PostgREST treats * as a LIKE wildcard. Use exact matching for literal stars.
  [false,true].forEach(exact=>{
    let batch=[],size=0;
    function finish(){
      if(batch.length)filters.push('&hub='+(exact?'in.':'ilike(any).')+
        encodeURIComponent((exact?'(':'{')+batch.join(',')+(exact?')':'}')));
      batch=[];size=0;
    }
    names.forEach(name=>{
      if(name.includes('*')!==exact)return;
      const literal=JSON.stringify(exact?name:name.replace(/[\\%_]/g,'\\$&'));
      const length=encodeURIComponent(literal).length+3;
      if(length>1200)throw Error('LOST_UPSTREAM');
      if(size+length>1200)finish();
      batch.push(literal);size+=length;
    });
    finish();
  });
  return filters;
}

function flmLostFetch_(ctx,from,to,fields,accept,stationScoped){
  const key=PropertiesService.getScriptProperties().getProperty('SUPABASE_LOST_SECRET_KEY');
  if(typeof key!=='string'||!/^sb_secret_[A-Za-z0-9_-]+$/.test(key))throw Error('LOST_CONFIG');
  const allowed=new Set(ctx.codes),aliases=ctx.aliases,deadline=Date.now()+35000;
  const order=stationScoped?'spx_tracking.asc':'ngay_chot.desc,spx_tracking.asc';
  const query='?select='+fields.join(',')+'&order='+order+'&spx_tracking=neq.'+
    '&ngay_chot=match.'+encodeURIComponent('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')+
    (from?'&ngay_chot=gte.'+from:'')+'&ngay_chot=lte.'+to+'&limit=1000';
  try{
    let remaining=100;
    for(const scope of stationScoped?flmLostStationFilters_(ctx):['']){
      let offset=0,cursor='';
      const seen=new Set();
      while(true){
        if(remaining--<=0||Date.now()>=deadline)throw Error();
        const pageFilter=stationScoped?(cursor?'&spx_tracking=gt.'+encodeURIComponent(cursor):''):'&offset='+offset;
        const response=UrlFetchApp.fetch(FLM_LOST_REST_URL+query+scope+pageFilter,{
          method:'get',headers:{apikey:key},followRedirects:false,muteHttpExceptions:true
        });
        if(Date.now()>=deadline)throw Error();
        const code=response.getResponseCode();
        if(code===401||code===403)return 'LOST_CONFIG';
        if(code!==200&&code!==206)throw Error();
        const rows=JSON.parse(response.getContentText());
        if(!Array.isArray(rows)||rows.length>1000)throw Error();
        if(!rows.length)break;
        for(const row of rows){
          if(!row||typeof row.hub!=='string'||typeof row.ngay_chot!=='string'){
            if(stationScoped)throw Error();
            continue;
          }
          if(stationScoped){
            const id=row.spx_tracking;
            if(typeof id!=='string'||!id.trim()||id.length>200||seen.has(id))throw Error();
            seen.add(id);cursor=id;
          }
          const hubCode=flmLostHubCode_(row.hub,aliases);
          if(!allowed.has(hubCode))continue;
          let date;
          try{date=flmTeamDay_(row.ngay_chot);}catch(_){continue;}
          if(date<'0001-01-01'||date>to||(from&&date<from))continue;
          if(accept(row,hubCode))return;
        }
        offset+=rows.length;
      }
    }
  }catch(_){throw Error('LOST_UPSTREAM');}
}

function flmLostSupabaseStats_(ctx,from){
  const days=new Map();
  const error=flmLostFetch_(ctx,from,ctx.closing,['spx_tracking','ngay_chot','hub','created_at'],(row,hubCode)=>{
    const date=row.ngay_chot,current=days.get(date)||{ids:new Set(),hubs:new Set(),latest:null};
    if(current.ids.has(row.spx_tracking))return;
    current.ids.add(row.spx_tracking);current.hubs.add(hubCode);
    const stamp=Date.parse(row.created_at);
    if(Number.isFinite(stamp)&&(current.latest===null||stamp>current.latest))current.latest=stamp;
    days.set(date,current);
  },true);
  if(error)throw Error(error);
  const dates=Array.from(days.keys()).sort(),latestDate=dates[dates.length-1]||null,day=days.get(latestDate);
  return {dates:dates,latestDate:latestDate,rows:day?day.ids.size:0,reportingHubs:day?day.hubs.size:0,
    latestAt:day&&day.latest!==null?new Date(day.latest).toISOString():null};
}

function flmLostSupabaseHubOrders_(ctx,hubCode){
  const scoped=Object.assign({},ctx,{codes:[hubCode]}),rows=new Map();
  const monthStart=ctx.closing.slice(0,7)+'-01',from=monthStart<ctx.from?monthStart:ctx.from;
  const error=flmLostFetch_(scoped,from,ctx.closing,['spx_tracking','ngay_chot','hub','ly_do','so_tien_den_bu'],row=>{
    if(rows.has(row.spx_tracking))return;
    const amount=row.so_tien_den_bu==null||String(row.so_tien_den_bu).trim()===''?null:flmTeamNum_(row.so_tien_den_bu);
    rows.set(row.spx_tracking,{shipmentId:row.spx_tracking,date:row.ngay_chot,reason:row.ly_do||'Chưa ghi lý do',amount:amount});
  },true);
  if(error)throw Error(error);
  return Array.from(rows.values()).sort((a,b)=>(b.amount||0)-(a.amount||0)||b.date.localeCompare(a.date)).slice(0,1000);
}

function flmLostResult_(get){
  try{return get();}catch(err){
    const code=err&&err.message;
    return {error:['LOST_ACCESS','LOST_RANGE','LOST_CONFIG'].includes(code)?code:'LOST_UPSTREAM'};
  }
}

function flmTeamGetLostSourceStatus(request){
  return flmLostResult_(()=>{
    const module=request&&request.module;
    if(module!=='snapshot'&&module!=='compensated')throw Error('LOST_ACCESS');
    const ctx=flmLostContext_(module==='snapshot'?'dashboard':'compensated',request);
    let latestDate=null;
    const error=flmLostFetch_(ctx,null,ctx.closing,['ngay_chot','hub'],row=>{latestDate=row.ngay_chot;return true;});
    if(error)throw Error(error);
    return {latestDate:latestDate};
  });
}

function flmTeamGetLostReport(request){
  return flmLostResult_(()=>{
    const ctx=flmLostContext_('compensated',request),{from,to}=request||{};
    try{
      if(typeof from!=='string'||typeof to!=='string'||flmTeamDay_(from)<'0001-01-01'||flmTeamDay_(to)>ctx.closing||from>to||Date.parse(to)-Date.parse(from)>30*86400000)throw Error();
    }catch(_){throw Error('LOST_RANGE');}
    const details=flmLostAllowsDetails_(ctx.access),rows=[],totals=details?null:flmLostSummary_(ctx);
    const fields=details?FLM_LOST_DETAIL_FIELDS:FLM_LOST_SUMMARY_FIELDS;
    const error=flmLostFetch_(ctx,from,to,fields,(row,hubCode)=>{
      if(details){
        if(typeof row.spx_tracking!=='string'||!row.spx_tracking.trim())return;
        const item={hubCode:hubCode};
        fields.forEach(field=>{if(Object.prototype.hasOwnProperty.call(row,field))item[field]=row[field];});
        rows.push(item);
      }else totals.add(row,hubCode);
    });
    if(error)throw Error(error);
    return details?{rows:rows}:{summary:totals.result()};
  });
}

function flmLostReasonBucket_(reason){
  // Logs and free-text reasons can contain shipment or staff identifiers.
  const reasonLabels=['Đơn hàng làm mất bởi Rider','Đơn hàng mất tại Hub','Đơn hàng rider Pick chưa bàn giao tại hub','Buyer/Seller chưa nhận hàng','Đơn hàng tranh chấp đối soát','Đền bù D0','Chưa ghi lý do'];
  const group=String(reason||'Chưa ghi lý do').replace(/\s*·.*$/,'').trim();
  return reasonLabels.includes(group)?group:'Lý do khác';
}

function flmLostReportValues_(row){
  // Match flmNormalizeLostRow_ for lost_orders, including raw JSON placeholders.
  let log=row.log_loi_cuoi;
  if(typeof log==='string'){
    let decoded;
    try{decoded=JSON.parse(log);}catch(_){}
    log=decoded&&typeof decoded==='object'&&!Array.isArray(decoded)&&
      ['error','reason','amount','cogs','rider'].some(key=>Object.prototype.hasOwnProperty.call(decoded,key))
      ?decoded:log.trim()?{error:log}:null;
  }
  const positive=value=>Math.max(0,flmTeamNum_(value)||0);
  const money=value=>value!=null&&String(value).trim()?flmTeamNum_(value):null;
  const cogs=money(row.cod_cogs);
  const amount=money(row.so_tien_den_bu)??(positive(log&&log.amount)||positive(cogs)||positive(log&&log.cogs));
  const claimType=String(row.loai_yeu_cau||'Đền bù D0');
  let reason='Chưa ghi lý do';
  if(typeof row.ly_do==='string'&&row.ly_do&&row.ly_do!=='Đền bù'&&row.ly_do!==reason)reason=row.ly_do;
  else if(log&&typeof log.reason==='string'&&log.reason&&log.reason!=='Đền bù')reason=log.reason;
  else if(log&&typeof log.error==='string'&&log.error.trim())reason=log.error.trim();
  else if(claimType!=='Đền bù')reason=claimType;
  return {amount:amount,cogs:cogs,reason:reason};
}

function flmLostSummary_(ctx){
  const hubs=new Map(),days=new Map(),reasons=new Map(),total={n:0,amount:0,knownAmount:0,missingAmount:0};
  ctx.codes.forEach(code=>{
    const h=ctx.byCode[code]||{};
    hubs.set(code,{hubCode:code,station:h.hubName||h.stationName||code,totalOrders:0,totalCogs:0,hvOrders:0,hvCogs:0,fm:0,lm:0,rt:0,eha:0});
  });
  return {
    add(row,code){
      const {amount,cogs,reason}=flmLostReportValues_(row);
      const hv=cogs??amount;
      const reasonLabel=flmLostReasonBucket_(reason);
      reasons.set(reasonLabel,(reasons.get(reasonLabel)||0)+1);
      const status=String(row.last_status_spx||row.trang_thai_he_thong||'').toLowerCase(),rsn=reason.toLowerCase();
      const h=hubs.get(code);
      h.totalOrders++;h.totalCogs+=amount;
      if(hv>=1000000){h.hvOrders++;h.hvCogs+=hv;}
      if(/fm|pickup/.test(status)||rsn.includes('pick'))h.fm++;
      if(/lm|deliver|assign/.test(status))h.lm++;
      if(/return|rt|hoàn/.test(status)||rsn.includes('hoàn'))h.rt++;
      if(status.includes('missing')||String(row.ket_qua||'').toLowerCase().includes('eha')||/missing|tranh chấp/.test(rsn))h.eha++;
      const date=row.ngay_chot,day=days.get(date)||{date:date,n:0,amount:0,knownAmount:0,missingAmount:0};
      days.set(date,day);
      [total,day].forEach(item=>{item.n++;item.amount+=amount;item.knownAmount+=amount;});
    },
    result(){
      return {total:total,hubStats:Array.from(hubs.values()).sort((a,b)=>b.totalOrders-a.totalOrders||b.totalCogs-a.totalCogs),
        series:Array.from(days.values()).sort((a,b)=>a.date.localeCompare(b.date)),
        reasons:Array.from(reasons,([reason,n])=>({reason:reason,n:n})).sort((a,b)=>b.n-a.n)};
    }
  };
}

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
function flmTeamHubHash_(codes){
  const str=(codes||[]).slice().sort().join(',');
  let h=0;for(let i=0;i<str.length;i++)h=(Math.imul(31,h)+str.charCodeAt(i))|0;
  return (h>>>0).toString(36);
}
function flmCacheGet_(key){
  if(typeof L1_REQUEST_CACHE_!=='undefined'&&L1_REQUEST_CACHE_&&L1_REQUEST_CACHE_.has(key)){
    return L1_REQUEST_CACHE_.get(key);
  }
  const cache=typeof CacheService!=='undefined'?CacheService.getScriptCache():null;
  if(!cache)return null;
  try{
    let raw=cache.get(key);
    if(!raw){
      if(typeof getChunkedCacheJson_==='function')return getChunkedCacheJson_(key);
      return null;
    }
    if(raw.indexOf('gz:')===0&&typeof Utilities!=='undefined'){
      raw=Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(raw.slice(3)))).getDataAsString('UTF-8');
    }
    const val=JSON.parse(raw);
    if(typeof L1_REQUEST_CACHE_!=='undefined'&&L1_REQUEST_CACHE_)L1_REQUEST_CACHE_.set(key,val);
    return val;
  }catch(_){return null}
}
function flmCachePut_(key,val,ttlSec){
  const ttl=Math.min(ttlSec||1800,21600);
  if(typeof L1_REQUEST_CACHE_!=='undefined'&&L1_REQUEST_CACHE_)L1_REQUEST_CACHE_.set(key,val);
  const cache=typeof CacheService!=='undefined'?CacheService.getScriptCache():null;
  if(!cache)return;
  try{
    const str=JSON.stringify(val);
    if(typeof Utilities!=='undefined'&&typeof Utilities.gzip==='function'&&str.length>400){
      const gz='gz:'+Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(str,'application/json')).getBytes());
      if(gz.length<95000){cache.put(key,gz,ttl);return;}
    }
    if(str.length<95000){cache.put(key,str,ttl);return;}
    if(typeof putChunkedCacheJson_==='function')putChunkedCacheJson_(key,val,ttl);
  }catch(_){}
}
function flmTeamCached_(kind,ctx,metadata,force,build,options){
  const opts=options||{},ttl=opts.ttlSeconds||FLM_TEAM_CFG.cacheSeconds;
  const signature=JSON.stringify([FLM_TEAM_CFG.version,FLM_TEAM_CFG.project,FLM_TEAM_CFG.dataset,FLM_TEAM_CFG.location,kind,ctx.access.rank==='NORMAL'?'NORMAL':'AUTH',getSecurityVersion_(),ctx.scope,ctx.codes,ctx.anchor,metadata.map(m=>m.revision)]);
  let h=0;for(let i=0;i<signature.length;i++)h=(Math.imul(31,h)+signature.charCodeAt(i))|0;
  const key='flm-team:'+kind+':'+h;
  if(!force&&metadata.every(m=>!!m.revision)){try{
    const v=flmCacheGet_(key);
    if(v&&v.signature===signature&&v.expiresAt>Date.now())return v.data;
  }catch(ignored){}}
  const data=build();try{
    if(opts.cacheIf&&!opts.cacheIf(data))return data;
    const envelope={signature:signature,expiresAt:Date.now()+ttl*1000,data:data};
    flmCachePut_(key,envelope,ttl);
  }catch(ignored){}return data;
}
// Context authorization runs before this lookup. A warm snapshot does not
// inspect BigQuery table metadata or start any query job.
function flmTeamFast_(kind,ctx,force,build){
  const today=Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd'),ttl=ctx.anchor<today?FLM_TEAM_CFG.historyCacheSeconds:FLM_TEAM_CFG.cacheSeconds;
  let built=false;
  const data=flmTeamCached_('fast:'+kind,ctx,[{revision:'ttl-snapshot-v1'}],force,()=>{
    built=true;const result=build();
    const claimsOk=result.claims&&result.claims.status!=='ERROR'&&['urgent','alert'].every(k=>!result.claims[k]||result.claims[k].status!=='ERROR');
    const lostOk=!result.lost||result.lost.status!=='ERROR';
    const ready=kind==='volume'?result.found&&(result.sources||[]).every(s=>!s.error):claimsOk&&lostOk;
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
  const revision=module==='backlog'?'scoped-dates-v1':'scoped-lost-dates-v4:'+Object.keys(contexts).sort().join(',');
  return flmTeamCached_('source-status:'+module,ctx,[{revision:revision}],r.force===true,()=>{
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
      if(module==='compensated'){
        try{
          if(typeof SpreadsheetApp==='undefined')throw Error('SpreadsheetApp is unavailable');
          const ss=SpreadsheetApp.openById(flmTeamLostDbSheetId_());
          const alertSheet=ss.getSheetByName('ALERT_PIVOT')||flmFindSheetByKeyword_(ss,['alert_pivot','alert pivot','alert_summary','[alert]','alert','cần xử lý']);
          const urgentSheet=ss.getSheetByName('URGENT_PIVOT')||flmFindSheetByKeyword_(ss,['urgent_pivot','urgent pivot','prelost_pivot','prelost pivot','[urgent]','urgent','bắt buộc feedback','feedback']);
          if(!alertSheet&&!urgentSheet)throw Error('CLAIM_SHEETS_NOT_FOUND: Cần tab [Alert] hoặc [Urgent]');
          if(urgentSheet){
            const uDateCol=flmFindDateColIdx_(urgentSheet);
            const uInfo=flmSheetDateStats_(urgentSheet,uDateCol);
            sources.push({id:'urgent',label:'Prelost',status:uInfo.dates.length?'AVAILABLE':'EMPTY',latestDate:uInfo.latestDate,latestAt:new Date().toISOString(),dates:uInfo.dates,rows:uInfo.rows,reportingHubs:ctx.codes.length,expectedHubs:ctx.codes.length,expectedDate:today,kind:'snapshot',checkedAt:checkedAt});
          }
          if(alertSheet){
            const aDateCol=flmFindDateColIdx_(alertSheet);
            const aInfo=flmSheetDateStats_(alertSheet,aDateCol);
            sources.push({id:'alert',label:'Alerts',status:aInfo.dates.length?'AVAILABLE':'EMPTY',latestDate:aInfo.latestDate,latestAt:new Date().toISOString(),dates:aInfo.dates,rows:aInfo.rows,reportingHubs:ctx.codes.length,expectedHubs:ctx.codes.length,expectedDate:today,kind:'snapshot',checkedAt:checkedAt});
          }
        }catch(err){
          sources.push(error('urgent','Prelost',err),error('alert','Alerts',err));
        }
      }
      try{
        const lostCtx=contexts.compensated;
        let current;
        try{current=flmLostSupabaseStats_(lostCtx,ctx.from);}catch(_){}
        if(current){
          sources.push(Object.assign({id:'lost',label:'Lost records',status:current.latestDate?'AVAILABLE':'EMPTY',
            expectedHubs:lostCtx.codes.length,expectedDate:today,kind:'records',checkedAt:checkedAt},current));
        }else{
          if(typeof SpreadsheetApp==='undefined')throw Error('SpreadsheetApp is unavailable');
          const ssLost=SpreadsheetApp.openById(flmTeamLostDbSheetId_());
          const info=['LOST_PIVOT','LOST'].reduce((found,name)=>{
            if(found)return found;
            try{
              const sheet=ssLost.getSheetByName(name);
              return sheet?flmLostSheetStats_(sheet,lostCtx,ctx.from):null;
            }catch(_){return null;}
          },null);
          if(!info)throw Error('LOST_UPSTREAM');
          sources.push(Object.assign({id:'lost',label:'Lost records',status:info.latestDate?'AVAILABLE':'EMPTY',latestAt:info.latestDate?checkedAt:null,
            expectedHubs:lostCtx.codes.length,expectedDate:today,kind:'records',checkedAt:checkedAt},info));
        }
      }catch(err){
        sources.push(error('lost','Lost records',err));
      }
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
    const code=flmMatchHubCode_(r.station,ctx);if(!code)return;
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
function flmTeamGetRiskSummary(request){
  const today=Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd');
  const ctx=flmTeamContext_('compensated',Object.assign({},request,{anchorDate:today}));
  assertPageAccess_(ctx.access,['compensated']);
  const key=PropertiesService.getScriptProperties().getProperty('SUPABASE_LOST_SECRET_KEY');
  const configured=typeof key==='string'&&/^sb_secret_[A-Za-z0-9_-]+$/.test(key);
  const result=flmTeamCached_('risk-summary:v1',ctx,[{revision:configured?'supabase':'pivot'}],request&&request.force===true,()=>{
    let sources=null,basis='supabase';
    if(configured){
      try{sources=flmRiskSupabaseSources_(ctx,key)}catch(_){}
    }
    if(!sources){
      basis='pivot';
      let sheets=null;
      try{sheets=SpreadsheetApp.openById(flmTeamLostDbSheetId_()).getSheets()}catch(_){}
      sources=[
        flmRiskPivotSource_(sheets,'alert',['alert_pivot','alert_summary','alert_agg'],ctx),
        flmRiskPivotSource_(sheets,'urgent',['urgent_pivot','prelost_pivot','urgent_summary'],ctx)
      ];
    }
    const checkedAt=new Date().toISOString();
    return {today:today,checkedAt:checkedAt,expiresAt:new Date(Date.parse(checkedAt)+FLM_TEAM_CFG.cacheSeconds*1000).toISOString(),sources:sources,basis:basis};
  });
  return flmLostAllowsDetails_(ctx.access)?Object.assign({},result,{stationAliases:ctx.aliases}):result;
}

function flmRiskSupabaseSources_(ctx,key){
  const allowed=new Set(ctx.codes),batches=[];
  for(const station of Object.keys(ctx.aliases).sort()){
    const quoted=encodeURIComponent(JSON.stringify(station));
    let batch=batches[batches.length-1];
    if(!batch||batch.filter.length+quoted.length+1>1300){
      batch={filter:'',stations:new Set()};
      batches.push(batch);
    }
    if(quoted.length>1300)throw Error('RISK_SUMMARY_SCOPE');
    batch.filter+=(batch.filter?',':'')+quoted;
    batch.stations.add(station);
  }
  const deadline=Date.now()+35000,url=FLM_LOST_REST_URL.replace(/lost_orders$/,'at_risk_daily_summary');
  const grain=['source','risk_day','station'];
  const counts=['order_count','missing_cogs','hv_orders','aging_7','aging_14','aging_21','aging_over_21','missing_aging','missing_feedback'];
  const metrics=grain.concat(counts,['known_cogs','hv_cogs']);
  // Reserve the three initial reads per batch and share a bounded paging allowance.
  let requests=batches.length*3+100;
  function read(batch,source,range,fields,limit,accept){
    const query='?select='+fields.join(',')+'&source=eq.'+source+'&station=in.('+batch.filter+')'+range+
      '&order=risk_day.desc.nullslast,station.asc&limit='+limit;
    let offset=0;
    const seen=new Set();
    for(let page=0;page<100&&requests-- >0&&Date.now()<deadline;page++){
      const response=UrlFetchApp.fetch(url+query+'&offset='+offset,{
        method:'get',headers:{apikey:key},followRedirects:false,muteHttpExceptions:true
      });
      if(Date.now()>=deadline||![200,206].includes(response.getResponseCode()))throw Error('RISK_SUMMARY_UPSTREAM');
      const rows=JSON.parse(response.getContentText());
      if(!Array.isArray(rows)||rows.length>limit)throw Error('RISK_SUMMARY_UPSTREAM');
      if(!rows.length)return;
      for(const row of rows){
        if(!row||Object.keys(row).length!==fields.length||fields.some(field=>!Object.prototype.hasOwnProperty.call(row,field))||
          row.source!==source||typeof row.station!=='string')throw Error('RISK_SUMMARY_UPSTREAM');
        const code=Object.prototype.hasOwnProperty.call(ctx.aliases,row.station)?ctx.aliases[row.station]:null;
        if(!batch.stations.has(row.station)||!allowed.has(code))continue;
        const day=row.risk_day;
        if(day!==null&&(typeof day!=='string'||day<'0001-01-01'||flmTeamDay_(day)!==day))throw Error('RISK_SUMMARY_UPSTREAM');
        const group=JSON.stringify([day,row.station]);
        if(seen.has(group))throw Error('RISK_SUMMARY_UPSTREAM');
        seen.add(group);
        if(accept(row,code))return;
      }
      offset+=rows.length;
    }
    throw Error('RISK_SUMMARY_UPSTREAM');
  }
  function sum(result,key,value,count=true){
    const total=(result[key]||0)+value;
    if(!Number.isFinite(total)||count&&!Number.isSafeInteger(total))throw Error('RISK_SUMMARY_UPSTREAM');
    result[key]=total;
  }
  let latest=null;
  for(const batch of batches)read(batch,'alert','&risk_day=not.is.null',grain,1,row=>{
    if(!row.risk_day)throw Error('RISK_SUMMARY_UPSTREAM');
    if(!latest||row.risk_day>latest)latest=row.risk_day;
    return true;
  });
  return ['alert','urgent'].map(id=>{
    const hubs=new Map(),dates=new Set();
    let invalidDates=0;
    const dated=id==='alert'?(latest?'risk_day.eq.'+latest:''):'risk_day.gte.'+ctx.anchor;
    const range=dated?'&or=('+dated+',risk_day.is.null)':'&risk_day=is.null';
    for(const batch of batches)read(batch,id,range,metrics,1000,(row,code)=>{
      const n=row.order_count,day=row.risk_day;
      if(counts.some(field=>!Number.isSafeInteger(row[field])||row[field]<0||row[field]>n)||n<1||
        !Number.isFinite(row.known_cogs)||!Number.isFinite(row.hv_cogs)||row.hv_cogs<row.hv_orders*1000000||
        (!row.hv_orders&&row.hv_cogs!==0)||row.hv_orders>n-row.missing_cogs||
        row.aging_7+row.aging_14+row.aging_21+row.aging_over_21+row.missing_aging!==n||row.missing_feedback!==n)
        throw Error('RISK_SUMMARY_UPSTREAM');
      if(day===null){
        invalidDates+=n;
        if(!Number.isSafeInteger(invalidDates))throw Error('RISK_SUMMARY_UPSTREAM');
        return;
      }
      if(id==='alert'?day!==latest:day<ctx.anchor)throw Error('RISK_SUMMARY_UPSTREAM');
      dates.add(day);
      const info=ctx.byCode[code]||{};
      if(!hubs.has(code))hubs.set(code,{hubCode:code,station:info.hubName||info.stationName||code,n:0,knownCogs:0,missingCogs:0,
        hvOrders:0,hvCogs:0,missingAging:0,missingFeedback:0,aging:{},stages:{},feedback:{}});
      const h=hubs.get(code);
      for(const [name,field] of Object.entries({n:'order_count',knownCogs:'known_cogs',missingCogs:'missing_cogs',hvOrders:'hv_orders',hvCogs:'hv_cogs',
        missingAging:'missing_aging',missingFeedback:'missing_feedback'})){
        sum(h,name,row[field],field!=='known_cogs'&&field!=='hv_cogs');
      }
      for(const [label,field] of Object.entries({'≤ 7 ngày':'aging_7','8–14 ngày':'aging_14','15–21 ngày':'aging_21','> 21 ngày':'aging_over_21','Chưa xác định':'missing_aging'})){
        if(row[field])sum(h.aging,label,row[field]);
      }
    });
    const hubRows=Array.from(hubs.values());
    for(const h of hubRows){
      if(h.missingCogs===h.n)h.hvOrders=h.hvCogs=null;
    }
    if(id==='alert'&&latest&&!hubs.size)throw Error('RISK_SUMMARY_UPSTREAM');
    return {id:id,status:hubs.size?'OK':invalidDates?'UNAVAILABLE':'EMPTY',dates:Array.from(dates).sort(),hubRows:hubRows,invalidDates:invalidDates};
  });
}

function flmRiskPivotDay_(value){
  if(value instanceof Date)return flmLostSheetDay_(value);
  if(typeof value==='number')return value>30000&&value<60000?new Date((Math.floor(value)-25569)*86400000).toISOString().slice(0,10):null;
  const text=String(value||'').trim();
  if(/^\d{1,2}([/-])\d{1,2}\1\d{4}$/.test(text))return flmLostSheetDay_(text);
  const iso=/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i.exec(text);
  if(!iso||+iso[2]>23||+iso[3]>59||+iso[4]>59)return null;
  try{
    const day=flmTeamDay_(iso[1]);
    let zone=iso[6];
    if(!zone)return day;
    zone=zone.toUpperCase().replace(':','');
    if(zone.length===3)zone+='00';
    const hours=+zone.slice(1,3),minutes=+zone.slice(3);
    if(zone!=='Z'&&(hours>14||minutes>59||(hours===14&&minutes>0)))return null;
    const time=iso[2]+':'+iso[3]+':'+(iso[4]||'00')+'.'+(iso[5]||'').padEnd(3,'0').slice(0,3);
    const stamp=Date.parse(day+'T'+time+zone);
    return Number.isFinite(stamp)?flmTeamDay_(Utilities.formatDate(new Date(stamp),'Asia/Ho_Chi_Minh','yyyy-MM-dd')):null;
  }catch(_){return null}
}

function flmRiskPivotSource_(sheets,id,names,ctx){
  const result={id:id,status:'UNAVAILABLE',dates:[],hubRows:[]};
  if(!sheets){result.status='ERROR';return result}
  const candidates=[];
  for(const sheet of sheets){
    try{
      const priority=names.indexOf(sheet.getName().trim().toLowerCase().replace(/[\s-]+/g,'_'));
      if(priority>=0)candidates.push({sheet,priority});
    }catch(_){result.status='ERROR'}
  }
  candidates.sort((a,b)=>a.priority-b.priority);
  candidate: for(const {sheet} of candidates){
    try{
      const lastRow=sheet.getLastRow(),lastColumn=sheet.getLastColumn();
      if(lastRow<1||lastRow>FLM_TEAM_CFG.maxRows||lastColumn>80)continue;
      const values=sheet.getRange(1,1,lastRow,lastColumn).getValues();
      const keys=values[0].map(h=>String(h||'').trim().normalize('NFC').toLowerCase().replace(/\s+/g,'_'));
      const col=(...aliases)=>aliases.reduce((match,name)=>match>=0?match:keys.indexOf(name),-1);
      const date=id==='urgent'?col('deadline','date','claim_date','ngày'):col('date','claim_date','ngày');
      const station=col('fleet_final_station','station','hub','trạm','hub_code');
      const orders=col('orders','count','records','số_lượng','qty','sl','count_of_spx_tracking','counta_of_spx_tracking','count_of_id','counta_of_id',
        'count_of_spx_shipment_id','counta_of_spx_shipment_id','count_of_shipment_id','counta_of_shipment_id');
      const cogs=col('cogs','sum_of_cogs','sum_cogs','total_cogs','amount','amt','tổng_cogs');
      const aging=col('group_aging','aging','tuổi');
      const stage=col('stage','fleet_final_status','status');
      const feedback=col('feedback','phản_hồi');
      const hv=col('hv','high_value');
      const hvOrders=col('hv_orders','hv_count','high_value_orders','high_value_count','đơn_hv');
      const hvCogs=col('hv_cogs','cogs_hv','high_value_cogs','cogs_đơn_hv');
      if(date<0||station<0||orders<0)continue;
      const allowed=new Set(ctx.codes),hubs=new Map(),dates=new Set();
      const add=(bucket,label,count)=>{if(label)bucket[label]=(bucket[label]||0)+count};
      const label=value=>String(value==null?'':value).trim().slice(0,120);
      const scoped=[];
      let alertDay=null;
      for(let i=1;i<values.length;i++){
        const row=values[i],day=flmRiskPivotDay_(row[date]);
        if(!day||id==='urgent'&&day<ctx.anchor)continue;
        const code=flmLostHubCode_(row[station],ctx.masterAliases);
        if(!allowed.has(code))continue;
        const n=flmTeamNum_(String(row[orders]??'').trim());
        scoped.push({row,day,code,n});
        if(id==='alert'&&Number.isSafeInteger(n)&&n>0&&(!alertDay||day>alertDay))alertDay=day;
      }
      for(const {row,day,code,n} of scoped){
        if(alertDay&&day!==alertDay)continue;
        if(!Number.isSafeInteger(n)||n<0)continue candidate;
        if(n===0)continue;
        const money=cogs<0?null:flmTeamNum_(label(row[cogs]));
        const info=ctx.byCode[code]||{};
        if(!hubs.has(code))hubs.set(code,{hubCode:code,station:info.hubName||info.stationName||code,n:0,knownCogs:0,missingCogs:0,aging:Object.create(null),stages:Object.create(null),feedback:Object.create(null),hvOrders:0,hvCogs:0});
        const h=hubs.get(code);
        h.n+=n;
        if(money==null)h.missingCogs+=n;
        else h.knownCogs+=money;
        const age=aging<0?'':label(row[aging]),ageDays=flmTeamNum_(age);
        add(h.aging,ageDays==null?age:ageDays<=7?'≤ 7 ngày':ageDays<=14?'8–14 ngày':ageDays<=21?'15–21 ngày':'> 21 ngày',n);
        const stageLabel=label(row[stage]);
        add(h.stages,stageLabel,n);
        const flag=label(row[hv]).toLowerCase();
        const flaggedCount=/^(true|1|hv)$/.test(flag)?n:/^(false|0|non[-_ ]hv)$/.test(flag)?0:null;
        const countCell=label(row[hvOrders]),explicitCount=flmTeamNum_(countCell);
        const countValid=Number.isSafeInteger(explicitCount)&&explicitCount>=0&&explicitCount<=n&&
          (flaggedCount==null||explicitCount===flaggedCount);
        const count=countCell?(countValid?explicitCount:null):flaggedCount;
        const amountCell=label(row[hvCogs]);
        let amount=flmTeamNum_(amountCell);
        if(!amountCell&&count===0)amount=0;
        if(!amountCell&&count===n)amount=money;
        const fitsCount=amount===0?count==null||count===0:count!==0&&amount>=(count??1)*1000000;
        const amountValid=amount!=null&&fitsCount&&(!countCell||countValid)&&
          (amount===0||money==null||amount<=money)&&(count!==n||money==null||amount===money);
        const conflicts=count!=null&&money!=null&&money>=0&&(
          money<count*1000000||count===0&&money>=n*1000000||
          amountValid&&count<n&&money-amount>=(n-count)*1000000);
        h.hvOrders=h.hvOrders==null||count==null||conflicts?null:h.hvOrders+count;
        h.hvCogs=h.hvCogs==null||!amountValid||conflicts?null:h.hvCogs+amount;
        const reply=feedback<0?'':label(row[feedback]).toLowerCase();
        if(reply)add(h.feedback,/^(pending|chưa phản hồi|chưa có feedback)$/.test(reply)?'Chưa phản hồi':/^(done|responded|đã phản hồi)$/.test(reply)?'Đã phản hồi':'Khác',n);
        dates.add(day);
      }
      result.status=hubs.size?'OK':'EMPTY';
      result.dates=Array.from(dates).sort();
      result.hubRows=Array.from(hubs.values());
      break;
    }catch(_){result.status='ERROR'}
  }
  return result;
}


function flmTeamGetClaims(request){
  const ctx=flmTeamContext_('compensated',request);
  ctx.force=request&&request.force===true;
  ctx.tab=request&&request.tab;
  const tabKey=!ctx.tab?'all-with-lost:v2':ctx.tab==='lost'||ctx.tab==='all'?ctx.tab+':v2':ctx.tab;
  const data=flmTeamFast_('claims:'+tabKey,ctx,ctx.force,()=>flmTeamReadClaims_(ctx,request));
  return ctx.access.customAccess&&!(ctx.access.allowedPages||[]).includes('compensated')?Object.assign({},data,{claims:{status:'ACCESS_DENIED'}}):data;
}
function flmTeamReadClaims_(ctx,request){
  const out=flmTeamBase_(ctx,[]);
  const tab=request&&request.tab;
  ctx.tab=tab;
  function part(name,run){try{out[name]=run()}catch(err){out[name]={status:'ERROR',error:String(err.message||err)};out.warnings.push(name+': '+String(err.message||err))}}
  let ss=null;
  try{if(typeof SpreadsheetApp!=='undefined')ss=SpreadsheetApp.openById(flmTeamLostDbSheetId_());}catch(err){out.warnings.push('GSHEET_OPEN: '+String(err.message||err));}
  if(!tab||tab==='urgent'||tab==='alert'||tab==='claims'||tab==='risk'||tab==='all'){
    part('claims',()=>{
      let fromSheet=null;
      try{fromSheet=flmTeamClaimsFromSheet_(ctx,ss,tab);}catch(_){}
      if(fromSheet)return fromSheet;
      try{
        const meta=flmTeamMetadata_('flm_claim_current',['snapshot_date','source','station','group_aging','stage','high_value','feedback','n','cogs','missing_cogs','ingested_at']);
        out.sources.push(meta);
        return flmTeamCached_('claims',ctx,[meta],request&&request.force===true,()=>{
          const data=flmTeamQuery_('WITH scoped AS (SELECT *,COUNT(*) OVER(PARTITION BY snapshot_date,source,station,group_aging,stage,high_value,feedback) AS duplicate_count FROM '+flmTeamTable_('flm_claim_current')+' WHERE snapshot_date=@anchor AND '+flmTeamStationSql_('station')+') SELECT TO_JSON_STRING(t) FROM (SELECT snapshot_date,source,station,group_aging,stage,high_value,feedback,SUM(n) AS n,SUM(cogs) AS cogs,SUM(missing_cogs) AS missing_cogs,MAX(ingested_at) AS ingested_at,MAX(duplicate_count) AS max_duplicate FROM scoped GROUP BY snapshot_date,source,station,group_aging,stage,high_value,feedback) t',ctx);
          const metaRows=data.filter(r=>r.row_kind==='meta');
          const groupRows=data.filter(r=>r.row_kind!=='meta');
          const finalMeta=metaRows.length?metaRows:['urgent','alert'].map(s=>({source:s,snapshot_date:ctx.anchor,ingested_at:ctx.anchor+'T08:00:00+07:00'}));
          return flmTeamClaimsBuild_(groupRows.length?groupRows:data,finalMeta,ctx);
        });
      }catch(_){}
      throw Error('Không tìm thấy dữ liệu Claim từ Google Sheet ('+flmTeamLostDbSheetId_()+'). Kiểm tra tab [Alert] hoặc [Urgent].');
    });
  }
  if(!tab||tab==='lost'){
    part('lost',()=>{
      if(request&&request.source==='supabase'){
        let fromSupabase=null;
        try{fromSupabase=flmTeamLostFromSupabase_(ctx,ss);}catch(_){}
        if(fromSupabase)return fromSupabase;
      }
      let fromSheet=null;
      try{fromSheet=flmTeamLostFromSheet_(ctx,ss);}catch(_){}
      if(fromSheet)return fromSheet;
      let fromSupabase=null;
      try{fromSupabase=flmTeamLostFromSupabase_(ctx,ss);}catch(_){}
      if(fromSupabase)return fromSupabase;
      try{
        const meta=flmTeamMetadata_('flm_lost_current',['d','station','mapped','amt','reason','shipment_id','ingested_at']);
        out.sources.push(meta);
        return flmTeamCached_('lost:v2',ctx,[meta],request&&request.force===true,()=>{
          const data=flmTeamQuery_('WITH scoped AS (SELECT *,COUNT(*) OVER(PARTITION BY d,station,shipment_id) AS duplicate_count FROM '+flmTeamTable_('flm_lost_current')+' WHERE mapped AND d BETWEEN LEAST(@from,DATE_TRUNC(@closing,MONTH)) AND @closing AND '+flmTeamStationSql_('station')+') SELECT TO_JSON_STRING(t) FROM (SELECT d,station,reason,COUNT(*) AS n,SUM(amt) AS amount,COUNTIF(amt IS NULL) AS missing_amount,MAX(ingested_at) AS ingested_at,MAX(duplicate_count) AS max_duplicate FROM scoped GROUP BY d,station,reason) t',ctx);
          const lossRates=flmReadLossRateMaster_(ss,ctx.closing,ctx.masterAliases);
          return flmTeamLostBuild_(data,ctx,lossRates);
        });
      }catch(_){}
      throw Error('Không tìm thấy dữ liệu Lost. Kiểm tra nguồn LOST.');
    });
  }
  out.limitations=['Công nợ và bồi thường đã thanh toán chưa có nguồn hợp lệ. Trang hiển thị COGS có rủi ro và Lost ghi nhận từ Google Sheet.'];
  return out;
}
function flmTeamClaimsBuild_(groups,metadata,ctx){
  const sections={};
  const sources=ctx&&ctx.tab==='urgent'?['urgent']:ctx&&ctx.tab==='alert'?['alert']:['urgent','alert'];
  sources.forEach(source=>{
    const meta=metadata.find(m=>m.source===source),
          targetSnap=meta?String(meta.snapshot_date):ctx.anchor,
          ok=meta&&!!meta.snapshot_date;
    const allowed=new Set((ctx.codes||[]).map(String));
    const hubs={},total={n:0,cogs:null,knownCogs:0,missingCogs:0,hv:source==='urgent'?0:null,hvCogs:source==='urgent'?0:null,hvKnownCogs:source==='urgent'?0:null,hvMissingCogs:0,pendingFeedback:0,respondedFeedback:0,otherFeedback:0,aging:Object.create(null),stages:Object.create(null)};
    if(ok)groups.filter(r=>r.source===source).forEach(r=>{
      if(String(r.snapshot_date)!==targetSnap)return;
      const code=r.hubCode||flmMatchHubCode_(r.station,ctx);if(!code||!allowed.has(String(code)))return;
      const info=ctx.byCode[code]||{},h=hubs[code]||(hubs[code]={hubCode:code,station:info.hubName||code,n:0,knownCogs:0,missingCogs:0,hv:0,hvCogs:0,hvMissingCogs:0,aging:Object.create(null),stages:Object.create(null),feedback:Object.create(null)}),n=Number(r.n);let c=flmTeamNum_(r.cogs);
      if(!Number.isSafeInteger(n)||n<1)return;
      const missing=Math.max(0,Math.min(n,Math.round(Number(r.missing_cogs||0))));
      if(c==null)c=0;
      h.n+=n;h.knownCogs+=c||0;h.missingCogs+=missing;h.aging[r.group_aging||'Chưa có aging']=(h.aging[r.group_aging||'Chưa có aging']||0)+n;h.stages[r.stage||'UNKNOWN']=(h.stages[r.stage||'UNKNOWN']||0)+n;h.feedback[r.feedback||'Chưa có feedback']=(h.feedback[r.feedback||'Chưa có feedback']||0)+n;
      if(r.high_value===true||r.high_value==='true'){h.hv+=n;h.hvCogs+=c||0;h.hvMissingCogs+=Number(r.missing_cogs||0)}
    });
    const list=Object.keys(hubs).map(k=>{const h=hubs[k];h.cogs=h.missingCogs?null:h.knownCogs;total.n+=h.n;total.knownCogs+=h.knownCogs;total.missingCogs+=h.missingCogs;
      h.pendingFeedback=(h.feedback['Chưa phản hồi']||0)+(h.feedback['Chưa có feedback']||0);h.respondedFeedback=h.feedback['Đã phản hồi']||0;h.otherFeedback=h.n-h.pendingFeedback-h.respondedFeedback;
      total.pendingFeedback+=h.pendingFeedback;total.respondedFeedback+=h.respondedFeedback;total.otherFeedback+=h.otherFeedback;
      ['aging','stages'].forEach(field=>Object.keys(h[field]).forEach(key=>total[field][key]=(total[field][key]||0)+h[field][key]));
      if(source==='urgent'){total.hv+=h.hv;total.hvCogs+=h.hvCogs;total.hvKnownCogs+=h.hvCogs;total.hvMissingCogs+=h.hvMissingCogs;h.hvKnownCogs=h.hvCogs;if(h.hvMissingCogs)h.hvCogs=null}return h}).sort((a,b)=>b.knownCogs-a.knownCogs||a.station.localeCompare(b.station));
    total.cogs=ok&&!total.missingCogs?total.knownCogs:null;
    if(total.hvMissingCogs)total.hvCogs=null;
    sections[source]={status:ok?'OK':'SNAPSHOT_UNAVAILABLE',snapshotDate:targetSnap,latestSnapshotDate:targetSnap,ingestedAt:meta&&meta.ingested_at||null,requestedDate:ctx.anchor,total:ok?total:null,hubs:list,agingOrder:Array.from(new Set(list.flatMap(h=>Object.keys(h.aging)))).sort()};
  });
  return sections;
}
function flmTeamLostBuild_(rows,ctx,lossRates){
  function empty(){return {n:0,amount:0,knownAmount:0,missingAmount:0}}
  function period(from){return {from:from,to:ctx.closing,total:empty(),hubs:Object.create(null),days:Object.create(null),reasons:Object.create(null)}}
  const month=ctx.closing.slice(0,7)+'-01',periods={l30d:period(ctx.from),mtd:period(month)};let dataAsOf=null,ingestedAt=null;
  const allowed=new Set((ctx.codes||[]).map(String));
  rows.forEach(r=>{
    // Deduplicated in reader; no throw
    const code=flmLostHubCode_(r.station,ctx.aliases);
    if(!allowed.has(code)||r.hubCode!=null&&String(r.hubCode)!==code)return;
    const date=flmTeamDay_(r.d),n=Number(r.n),amount=flmTeamNum_(r.amount),missing=Number(r.missing_amount||0);
    if(!Number.isSafeInteger(n)||n<1||!Number.isSafeInteger(missing)||missing<0||missing>n||amount==null&&missing<n)throw Error('FLM_LOST_AGGREGATE_INVALID');
    if(date>ctx.closing||date<(month<ctx.from?month:ctx.from))throw Error('FLM_LOST_DATE_MISMATCH');
    if(!dataAsOf||date>dataAsOf)dataAsOf=date;if(!ingestedAt||r.ingested_at>ingestedAt)ingestedAt=r.ingested_at;
    function add(o){o.n+=n;o.knownAmount+=amount||0;o.missingAmount+=missing}
    Object.keys(periods).forEach(key=>{const p=periods[key];if(date<p.from)return;add(p.total);
      const info=ctx.byCode[code]||{},reason=flmLostReasonBucket_(r.reason);
      add(p.hubs[code]||(p.hubs[code]=Object.assign(empty(),{hubCode:code,station:info.hubName||code})));
      add(p.days[date]||(p.days[date]=Object.assign(empty(),{date:date})));
      add(p.reasons[reason]||(p.reasons[reason]=Object.assign(empty(),{reason:reason})));
    });
  });
  Object.keys(periods).forEach(key=>{const p=periods[key];[p.total].concat(Object.values(p.hubs),Object.values(p.days),Object.values(p.reasons)).forEach(o=>o.amount=o.missingAmount?null:o.knownAmount);
    Object.values(p.hubs).forEach(h=>{
      const rateInfo=lossRates&&lossRates[h.hubCode];
      h.lossRate=rateInfo?rateInfo.formatted:'—';
      h.lossRateNum=rateInfo?rateInfo.num:null;
    });
    p.hubRows=Object.values(p.hubs).sort((a,b)=>b.knownAmount-a.knownAmount||a.station.localeCompare(b.station));p.series=Object.values(p.days).sort((a,b)=>a.date.localeCompare(b.date));p.reasons=Object.values(p.reasons).sort((a,b)=>b.n-a.n);delete p.hubs;delete p.days;
  });
  const p=periods.l30d;
  return {status:'OK',total:p.total,mtd:periods.mtd.total,dataAsOf:dataAsOf,ingestedAt:ingestedAt,hubRows:p.hubRows,series:p.series,reasons:p.reasons,periods:periods,note:'Số bản ghi phân bổ theo HUB; một shipment có thể thuộc nhiều HUB. Không cộng Prelost, Alert và Lost thành một tổng đơn duy nhất. Ngày không có bản ghi chưa chứng minh nguồn đã đầy đủ.'};
}

function flmTeamLostDbSheetId_(){
  const p=typeof PropertiesService!=='undefined'?PropertiesService.getScriptProperties():null;
  return (p&&p.getProperty('LOST_DB_SHEET_ID'))||'1jjQNjOu-kovQ9IYWffhi-76yQZwqgG67YJ2M86jcpvs';
}

function flmLostSheetKeys_(headers){
  const columns=headers.map(header=>String(header||'').trim().toLowerCase().replace(/\s+/g,'_'));
  return {
    date:columns.findIndex(h=>['d','report_date','date','claim_date','ngay_chot','ngày_chốt','ngày','ngay'].includes(h)),
    station:columns.findIndex(h=>['station','station_name','hub','hub_name','hub_code','fleet_final_station','trạm','tram','tên_hub','mã_hub'].includes(h))
  };
}

function flmLostSheetDay_(raw){
  let day='';
  if(raw instanceof Date)day=Utilities.formatDate(raw,'Asia/Ho_Chi_Minh','yyyy-MM-dd');
  else if(typeof raw==='number'&&raw>30000&&raw<60000)day=Utilities.formatDate(new Date(Math.round((raw-25569)*86400000)),'Asia/Ho_Chi_Minh','yyyy-MM-dd');
  else{
    const value=String(raw||'').trim(),iso=/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/.exec(value);
    const local=/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:$|\s)/.exec(value);
    if(iso)day=iso[1];
    else if(local)day=local[3]+'-'+local[2].padStart(2,'0')+'-'+local[1].padStart(2,'0');
  }
  try{return flmTeamDay_(day);}catch(_){return null;}
}

function flmLostSheetStats_(sheet,ctx,from){
  const length=sheet.getLastRow()-1,width=sheet.getLastColumn();
  if(length<0||width<1)return null;
  const keys=flmLostSheetKeys_(sheet.getRange(1,1,1,width).getValues()[0]);
  if(keys.date<0||keys.station<0)return null;
  if(length===0)return {dates:[],latestDate:null,rows:0,reportingHubs:0};
  const dates=sheet.getRange(2,keys.date+1,length,1).getValues(),stations=sheet.getRange(2,keys.station+1,length,1).getValues();
  if(dates.length!==length||stations.length!==length)return null;
  const found=new Set(),hubs=new Set();
  let latestDate=null,rows=0;
  dates.forEach(([raw],i)=>{
    const code=flmLostHubCode_(stations[i][0],ctx.aliases);
    if(!code)return;
    const date=flmLostSheetDay_(raw);
    if(!date||date<from||date>ctx.closing)return;
    found.add(date);
    if(!latestDate||date>latestDate){latestDate=date;rows=0;hubs.clear();}
    if(date===latestDate){rows++;hubs.add(code);}
  });
  return {dates:Array.from(found).sort(),latestDate:latestDate,rows:rows,reportingHubs:hubs.size};
}

function flmReadLostSheetMaster_(ss,closing,from,aliases){
  const monthStart=closing.slice(0,7)+"-01",minDate=monthStart<from?monthStart:from;
  const pivotSheet=ss.getSheetByName("LOST_PIVOT")||ss.getSheetByName("LOST_AGG")||ss.getSheetByName("LOST_SUMMARY")||flmFindSheetByKeyword_(ss,["lost_pivot","lost pivot","lost_summary","lost_agg"]);
  if(pivotSheet&&pivotSheet.getLastRow()>1){
    const pAll=pivotSheet.getDataRange().getValues();
    if(pAll.length>1){
      const pHeaders=pAll[0].map(h=>String(h||"").trim().toLowerCase());
      const findPCol=(kws,def)=>{const idx=pHeaders.findIndex(h=>kws.some(kw=>h.indexOf(kw)>=0));return idx>=0?idx:def};
      const {date:cDate,station:cStation}=flmLostSheetKeys_(pHeaders);
      if(cDate>=0&&cStation>=0){
        const cReason=findPCol(["reason","lý do"],2),cN=findPCol(["records","count","số lượng","qty","orders"],3),cAmt=findPCol(["amount","cogs","amt","tiền","sum"],4);
        const grouped={};
        for(let i=1;i<pAll.length;i++){
          const row=pAll[i],d=flmLostSheetDay_(row[cDate]);
          if(!d||d<minDate||d>closing)continue;
          const stationRaw=String(row[cStation]||"").trim(),code=flmLostHubCode_(stationRaw,aliases);
          if(!code)continue;
          const reason=cReason>=0&&row[cReason]?String(row[cReason]):"Chưa ghi lý do";
          const n=cN>=0?Number(row[cN])||0:1,amt=cAmt>=0?flmTeamNum_(row[cAmt])||0:0;
          if(!Number.isSafeInteger(n)||n<1)continue;
          const groupKey=JSON.stringify([d,stationRaw,reason]);
          if(!grouped[groupKey])grouped[groupKey]={d:d,hubCode:code,station:stationRaw,reason:reason,n:0,amount:0,missing_amount:0,ingested_at:d+"T23:00:00+07:00",max_duplicate:1};
          grouped[groupKey].n+=n;grouped[groupKey].amount+=amt;
        }
        return Object.values(grouped);
      }
    }
  }
  const sheet=ss.getSheetByName("LOST");
  if(!sheet||sheet.getLastRow()<=1)return null;
  const lastCol=Math.min(sheet.getLastColumn(),15);
  const headers=sheet.getRange(1,1,1,lastCol).getValues()[0].map(h=>String(h||"").trim().toLowerCase());
  const findCol=(kws,def)=>{const idx=headers.findIndex(h=>kws.some(kw=>h.indexOf(kw)>=0));return idx>=0?idx:def};
  const {date:colDate,station:colStation}=flmLostSheetKeys_(headers);
  const colAmt=findCol(["amount","cogs","amt","tiền","tien"],10);
  const colReason=findCol(["reason","lý do","ly do"],6);
  const colShipment=findCol(["shipment","tracking","đơn","don"],5);
  const colIngested=findCol(["ingested"],-1);
  if(colDate<0||colStation<0)return null;
  const numCols=Math.max(colDate,colStation,colAmt,colReason,colShipment,colIngested)+1;
  const lastRow=sheet.getLastRow();
  const grouped={},seenShipments=new Set();
  if(lastRow>=2){
    const chunkValues=sheet.getRange(2,1,lastRow-1,numCols).getValues();
    for(let i=0;i<chunkValues.length;i++){
      const row=chunkValues[i];
      const d=flmLostSheetDay_(row[colDate]);
      if(!d||d<minDate||d>closing)continue;
      const stationRaw=String(row[colStation]||"").trim(),code=flmLostHubCode_(stationRaw,aliases);
      if(!code)continue;
      const shipId=colShipment>=0?String(row[colShipment]||"").trim():"";
      if(shipId&&shipId!=="-"&&shipId.toLowerCase()!=="n/a"&&shipId!=="0"){
        const dupKey=d+"|"+code+"|"+shipId;
        if(seenShipments.has(dupKey))continue;
        seenShipments.add(dupKey);
      }
      const reason=colReason>=0&&row[colReason]?String(row[colReason]):"Chưa ghi lý do";
      const amt=colAmt>=0?flmTeamNum_(row[colAmt]):null,isMissing=amt==null;
      const groupKey=JSON.stringify([d,stationRaw,reason]);
      if(!grouped[groupKey])grouped[groupKey]={d:d,hubCode:code,station:stationRaw,reason:reason,n:0,amount:0,missing_amount:0,ingested_at:d+"T23:00:00+07:00",max_duplicate:1};
      const g=grouped[groupKey];g.n++;if(isMissing)g.missing_amount++;else g.amount+=(amt||0);
    }
  }
  return Object.values(grouped);
}
function flmTeamLostFromSheet_(ctx,ssOptional){
  const masterKey=flmLostMasterKey_(ctx);
  let masterRows=null;
  if(!ctx.force)masterRows=flmCacheGet_(masterKey);
  let ss=ssOptional;
  if(!masterRows||!masterRows.length){
    if(typeof SpreadsheetApp==="undefined")return null;
    if(!ss){try{ss=SpreadsheetApp.openById(flmTeamLostDbSheetId_())}catch(_){return null}}
    if(!ss)return null;
    masterRows=flmReadLostSheetMaster_(ss,ctx.closing,ctx.from,ctx.masterAliases);
    if(masterRows&&masterRows.length)flmCachePut_(masterKey,masterRows,21600);
  }
  if(!masterRows||!masterRows.length)return null;
  if(!ss&&typeof SpreadsheetApp!=="undefined"){try{ss=SpreadsheetApp.openById(flmTeamLostDbSheetId_())}catch(_){} }
  const lossRates=flmReadLossRateMaster_(ss,ctx.closing,ctx.masterAliases);
  return flmTeamLostBuild_(masterRows,ctx,lossRates);
}

function flmTeamLostFromSupabase_(ctx,ssOptional){
  const props=typeof PropertiesService!=='undefined'?PropertiesService.getScriptProperties():null;
  if(!props)return null;
  let key=null;
  try{key=props.getProperty('SUPABASE_LOST_SECRET_KEY');}catch(_){}
  if(!key){
    try{key=props.getProperty('D0_SUPABASE_SECRET_KEY');}catch(_){}
  }
  if(!key){
    try{key=props.getProperty('SUPABASE_KEY');}catch(_){}
  }
  if(typeof key!=='string'||(!/^sb_secret_[A-Za-z0-9_-]+$/.test(key)&&!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)&&!key.startsWith('eyJ')))return null;
  const base=typeof FLM_LOST_REST_URL==='string'?FLM_LOST_REST_URL.replace(/\/lost_orders$/,''):'https://aqvcybxcfgicxmzpczgd.supabase.co/rest/v1';
  const month=ctx.closing.slice(0,7)+'-01',minDate=month<ctx.from?month:ctx.from;
  const cacheKey='flm:lost-sb-pivot:v2:'+getSecurityVersion_()+':'+ctx.closing+':'+minDate;
  let rows=!ctx.force?flmCacheGet_(cacheKey):null;
  if(!rows||!rows.length){
    try{
      const allRows=[];
      const limit=1000;
      for(let offset=0;offset<5000;offset+=limit){
        const targetUrl=base+'/lost_daily_pivot?ngay_chot=gte.'+encodeURIComponent(minDate)+
          '&ngay_chot=lte.'+encodeURIComponent(ctx.closing)+
          '&select=ngay_chot,hub,khu_vuc,tong_so_don,tong_tien_den_bu,don_mat_tai_hub,lam_mat_boi_rider,rider_pick_chua_ban_giao,xa_tai_thieu,ly_do_khac,thoi_diem_cap_nhat'+
          '&order=ngay_chot.desc&limit='+limit+'&offset='+offset;
        const res=UrlFetchApp.fetch(targetUrl,{
          method:'get',
          headers:{apikey:key,Authorization:'Bearer '+key},
          followRedirects:false,
          muteHttpExceptions:true
        });
        if(res.getResponseCode()!==200)break;
        const batch=JSON.parse(res.getContentText());
        if(!Array.isArray(batch)||!batch.length)break;
        allRows.push(...batch);
        if(batch.length<limit)break;
      }
      if(!allRows.length)return null;
      rows=[];
      allRows.forEach(r=>{
        const totalN=Number(r.tong_so_don||0);
        if(!totalN)return;
        const date=String(r.ngay_chot||'').trim();
        if(!date||date<minDate||date>ctx.closing)return;
        const totalAmt=Math.max(0,Number(r.tong_tien_den_bu||0));
        const station=r.hub,updated=r.thoi_diem_cap_nhat||date+'T23:00:00+07:00';
        const reasons=[
          {reason:'Đơn hàng mất tại Hub',n:Number(r.don_mat_tai_hub||0)},
          {reason:'Đơn hàng làm mất bởi Rider',n:Number(r.lam_mat_boi_rider||0)},
          {reason:'Đơn hàng rider Pick chưa bàn giao tại hub',n:Number(r.rider_pick_chua_ban_giao||0)},
          {reason:'Đền bù D0',n:Number(r.xa_tai_thieu||0)},
          {reason:'Lý do khác',n:Number(r.ly_do_khac||0)}
        ].filter(x=>x.n>0);
        const sumN=reasons.reduce((s,x)=>s+x.n,0);
        if(sumN<totalN){
          reasons.push({reason:'Lý do khác',n:totalN-sumN});
        }
        if(!reasons.length){
          rows.push({d:date,station:station,reason:'Chưa ghi lý do',n:totalN,amount:totalAmt,missing_amount:0,ingested_at:updated});
        }else{
          let allocatedAmt=0;
          reasons.forEach((item,idx)=>{
            const itemAmt=Math.max(0,(idx===reasons.length-1)?(totalAmt-allocatedAmt):Math.round(totalAmt*item.n/totalN));
            allocatedAmt+=itemAmt;
            rows.push({d:date,station:station,reason:item.reason,n:item.n,amount:itemAmt,missing_amount:0,ingested_at:updated});
          });
        }
      });
      if(rows.length)flmCachePut_(cacheKey,rows,21600);
    }catch(_){return null;}
  }
  if(!rows||!rows.length)return null;
  let ss=ssOptional;
  if(!ss&&typeof SpreadsheetApp!=='undefined'){
    try{ss=SpreadsheetApp.openById(flmTeamLostDbSheetId_());}catch(_){}
  }
  const lossRates=flmReadLossRateMaster_(ss,ctx.closing,ctx.masterAliases);
  return flmTeamLostBuild_(rows,ctx,lossRates);
}

function flmLostMasterKey_(ctx){return 'flm:lost-master-rows:v4:'+getSecurityVersion_()+':'+ctx.closing+':'+ctx.from}

function flmFormatMonthHeader_(cell){
  if(!cell)return '';
  if(cell instanceof Date){
    try{
      return Utilities.formatDate(cell,'Asia/Ho_Chi_Minh','yyyy-MM');
    }catch(_){
      const y=cell.getFullYear(),m=String(cell.getMonth()+1).padStart(2,'0');
      return y+'-'+m;
    }
  }
  if(typeof cell==='number'&&cell>30000&&cell<60000){
    const d=new Date(Math.round((cell-25569)*86400*1000));
    const y=d.getUTCFullYear(),m=String(d.getUTCMonth()+1).padStart(2,'0');
    return y+'-'+m;
  }
  const s=String(cell).trim();
  if(/^\d{4}-\d{2}/.test(s))return s.slice(0,7);
  const m1=/^(\d{1,2})[\/\-](\d{4})/.exec(s);
  if(m1)return m1[2]+'-'+m1[1].padStart(2,'0');
  const m2=/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(s);
  if(m2)return m2[3]+'-'+m2[2].padStart(2,'0');
  return '';
}

function flmParseLossRateRows_(values,closing,aliases){
  if(!values||values.length<=1)return {};
  const targetMonth=(closing||'').slice(0,7)||'2026-11';
  let monthCols={},monthList=[],headerRowIdx=-1;
  for(let r=0;r<Math.min(5,values.length);r++){
    const row=values[r];
    for(let idx=0;idx<row.length;idx++){
      const m=flmFormatMonthHeader_(row[idx]);
      if(m){
        monthCols[m]=idx;
        monthList.push({month:m,col:idx});
        if(headerRowIdx<0)headerRowIdx=r;
      }
    }
    if(monthList.length>0)break;
  }
  if(monthList.length===0)return {};
  const chosenCol=monthCols[targetMonth]!=null?monthCols[targetMonth]:monthList[0].col;
  const result={};
  for(let r=headerRowIdx+1;r<values.length;r++){
    const row=values[r];
    const stationRaw=String(row[0]||'').trim();
    if(!stationRaw||/^\d{4}-\d{2}$/.test(stationRaw))continue;
    const code=flmLostHubCode_(stationRaw,aliases);
    if(!code)continue;
    let val=row[chosenCol];
    if((val==null||String(val).trim()==='')&&monthList.length>0){
      for(let i=0;i<monthList.length;i++){
        const candidate=row[monthList[i].col];
        if(candidate!=null&&String(candidate).trim()!==''){
          val=candidate;
          break;
        }
      }
    }
    let formatted='—',num=null;
    if(val!=null&&val!==''){
      if(typeof val==='number'){
        const pct=val*100;
        formatted=pct.toFixed(3)+'%';
        num=val;
      }else{
        const s=String(val).trim();
        if(s){
          const n=parseFloat(s.replace('%',''));
          if(!isNaN(n)){
            formatted=s.endsWith('%')?s:(n+'%');
            num=n/100;
          }
        }
      }
    }
    result[code]={formatted:formatted,num:num,station:stationRaw};
  }
  return result;
}

function flmReadLossRateMaster_(ss,closing,aliases){
  const targetMonth=(closing||'').slice(0,7)||'2026-11';
  const cacheKey='flm:loss-rate:v4:'+getSecurityVersion_()+':'+targetMonth;
  const cached=flmCacheGet_(cacheKey);
  if(cached&&Object.keys(cached).length>=10)return cached;
  let values=null;
  if(ss){
    const sheet=ss.getSheetByName('% Loss Rate')||ss.getSheetByName('Loss Rate')||ss.getSheetByName('LOSS_RATE')||flmFindSheetByKeyword_(ss,['% loss rate','loss rate','loss_rate']);
    if(sheet&&sheet.getLastRow()>1){
      try{values=sheet.getDataRange().getValues();}catch(_){}
    }
  }
  let result=null;
  if(values&&values.length>1){
    try{result=flmParseLossRateRows_(values,closing,aliases);}catch(_){}
  }
  if(!result||Object.keys(result).length<10){
    const fbValues=flmGetFallbackLossRateValues_();
    const fbResult=flmParseLossRateRows_(fbValues,closing,aliases);
    result=Object.assign({},fbResult,result||{});
  }
  if(result&&Object.keys(result).length)flmCachePut_(cacheKey,result,21600);
  return result;
}

function flmGetFallbackLossRateValues_(){
  return FLM_FALLBACK_LOSS_RATE_CSV_.trim().split(/\r?\n/).map(l=>l.split(','));
}

const FLM_FALLBACK_LOSS_RATE_CSV_=`Station Name,Loss Rate,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,2026-11,2026-10,2026-09,2026-08,2026-07,2026-06,2026-05,2026-04,2026-03,2026-02,2026-01,2025-12,2025-11,2025-10,2025-09,2025-08,2025-07,2025-06,2025-05,2025-04,2025-03,2025-02,2025-01,2024-12,2024-11,2024-10,2024-09,2024-08,2024-07,2024-06,2024-05,2024-04,2024-03,2024-02,2024-01
50-HCM Thu Duc Hub,0.004%,0.014%,0.009%,0.006%,0.011%,0.018%,0.015%,0.011%,0.023%,0.001%,0.007%,0.012%,0.007%,0.008%,0.004%,0.008%,0.008%,0.009%,0.008%,0.006%,0.007%,0.012%,0.007%,0.006%,0.008%,0.007%,0.004%,0.002%,0.002%,0.001%,0.001%,0.002%,0.002%,0.001%,0.002%
50-HCM Phu Nhuan/Phuong 8 Hub,0.003%,0.005%,0.002%,0.002%,0.003%,0.003%,0.006%,0.003%,0.004%,0.002%,0.001%,0.001%,0.002%,0.004%,0.001%,0.002%,0.001%,0.001%,0.001%,0.002%,0.001%,0.004%,0.003%,0.002%,0.004%,0.004%,0.002%,0.004%,0.002%,0.000%,0.003%,0.001%,0.002%,0.004%,0.001%
51-HCM Go Vap/Pham Van Chieu Hub,0.002%,0.003%,0.003%,0.001%,0.002%,0.001%,0.003%,0.002%,0.002%,0.003%,0.002%,0.000%,0.003%,0.001%,0.001%,0.000%,0.001%,0.002%,0.001%,0.003%,0.003%,0.004%,0.001%,0.002%,0.006%,0.008%,0.002%,0.001%,,,,,,,
51-HCM Binh Tan/Binh Tri Dong B Hub,0.007%,0.012%,0.007%,0.011%,0.004%,0.006%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
50-HCM Tan Phu/Tan Quy Hub,0.001%,0.003%,0.001%,0.002%,0.002%,0.002%,0.003%,0.003%,0.002%,0.003%,0.001%,0.003%,0.004%,0.001%,0.002%,0.001%,0.007%,0.005%,0.003%,0.004%,0.003%,0.004%,0.004%,0.003%,0.003%,0.003%,0.002%,0.002%,0.002%,0.004%,0.005%,0.004%,0.003%,0.006%,0.003%
50-HCM Binh Thanh/VTB Hub,0.003%,0.005%,0.005%,0.005%,0.006%,0.008%,0.008%,0.014%,0.015%,0.007%,0.008%,0.013%,0.009%,0.009%,0.005%,0.005%,0.009%,0.008%,0.004%,0.005%,0.005%,0.006%,0.004%,0.008%,0.006%,0.005%,0.006%,0.004%,0.006%,0.004%,0.002%,0.004%,0.004%,0.005%,0.003%
50-HCM Phu Nhuan/Phuong 4 Hub,0.002%,0.001%,0.001%,0.001%,0.003%,0.005%,0.002%,0.002%,0.001%,0.002%,0.002%,0.002%,0.001%,0.002%,0.003%,0.003%,0.003%,0.003%,0.001%,0.001%,0.001%,0.003%,0.001%,0.002%,0.001%,0.001%,0.001%,0.000%,,0.000%,0.003%,0.003%,0.001%,0.002%,0.002%
50-HCM D6 Hub,0.003%,0.006%,0.005%,0.002%,0.005%,0.010%,0.017%,0.024%,0.014%,0.011%,0.011%,0.023%,0.025%,0.029%,0.025%,0.008%,0.007%,0.007%,0.011%,0.005%,0.008%,0.019%,0.004%,0.005%,0.004%,0.003%,0.004%,0.003%,0.004%,0.002%,0.003%,0.003%,0.002%,0.006%,0.005%
51-HCM D12/Vuon Lai Hub,0.004%,0.004%,0.005%,0.008%,0.012%,0.006%,0.001%,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Tan Phu/Tan Thanh Hub,0.001%,0.002%,0.003%,0.001%,0.002%,0.002%,0.002%,0.004%,0.006%,0.002%,0.002%,0.006%,0.004%,0.002%,0.004%,0.002%,0.002%,0.003%,0.003%,0.004%,0.004%,0.010%,0.002%,,,,,,,,,,,,
51-HCM Hoc Mon/Xuan Thoi Thuong Hub,0.002%,0.010%,0.003%,0.002%,0.002%,0.004%,0.004%,0.002%,0.004%,0.004%,0.003%,0.006%,0.005%,0.005%,0.005%,0.008%,0.007%,0.002%,0.003%,0.005%,0.001%,0.004%,0.004%,0.002%,0.003%,0.003%,0.002%,0.001%,0.002%,0.002%,0.002%,0.001%,0.001%,0.003%,0.000%
50-HCM D9/Man Thien Hub,,0.001%,0.004%,0.001%,0.001%,0.003%,0.006%,0.004%,0.001%,0.001%,0.001%,0.001%,0.001%,0.001%,0.002%,0.002%,0.001%,0.001%,0.001%,0.000%,0.002%,0.001%,0.000%,0.002%,0.004%,0.005%,0.003%,0.002%,0.002%,0.002%,0.001%,0.002%,0.003%,0.002%,0.003%
51-HCM Cu Chi/Binh My Hub,,0.007%,0.003%,0.006%,0.006%,0.005%,0.006%,0.005%,0.004%,0.009%,0.002%,0.008%,0.006%,0.003%,0.005%,0.003%,,,,,,,,,,,,,,,,,,,
51-HCM Tan Binh/Tan Son Hoa Hub,0.002%,0.005%,0.003%,0.002%,0.003%,0.004%,0.004%,0.004%,0.006%,0.003%,0.002%,0.003%,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Tan Phu/Phan Anh Hub,0.006%,0.016%,0.008%,0.003%,0.003%,0.003%,0.006%,0.003%,0.005%,0.001%,0.002%,0.002%,0.001%,0.005%,0.004%,0.003%,0.002%,0.003%,0.002%,0.002%,0.003%,0.006%,0.003%,0.002%,0.004%,0.002%,,,,,,,,,
50-HCM D9/Duong Dinh Hoi Hub,0.002%,0.002%,0.001%,0.001%,0.002%,0.001%,0.003%,0.001%,0.001%,,0.001%,0.001%,0.001%,0.002%,0.003%,0.001%,0.001%,0.002%,0.002%,0.001%,0.002%,0.001%,0.001%,0.002%,0.001%,0.001%,0.002%,0.001%,0.000%,0.000%,0.001%,0.001%,0.001%,0.002%,0.002%
51-HCM Thu Duc/Linh Xuan Hub,0.003%,0.011%,0.005%,0.007%,0.008%,0.007%,0.008%,0.014%,0.014%,0.009%,0.007%,0.012%,0.004%,0.002%,0.002%,0.005%,0.003%,0.002%,0.002%,0.002%,0.001%,0.001%,0.002%,0.001%,0.002%,0.002%,,,,,,,,,
51-HCM Binh Thanh/Phuong 12 Hub,0.004%,0.009%,0.013%,0.011%,0.009%,0.006%,0.010%,0.007%,0.010%,0.017%,0.007%,0.009%,0.007%,0.007%,0.017%,0.004%,0.007%,0.003%,0.001%,0.000%,0.006%,0.007%,0.004%,0.006%,0.004%,0.007%,0.004%,0.002%,0.003%,0.001%,0.002%,0.002%,0.002%,0.004%,0.004%
51-HCM Hoc Mon/Thoi Tam Thon Hub,0.002%,0.002%,0.004%,0.001%,0.001%,0.002%,0.003%,0.003%,0.004%,0.009%,0.005%,0.004%,0.004%,,,,,,,,,,,,,,,,,,,,,,
51-HCM Hoc Mon/Dong Thanh 1 Hub,0.001%,0.003%,0.004%,0.002%,0.002%,0.003%,0.006%,0.002%,0.005%,0.004%,0.001%,0.001%,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Phan Van Khoe CH,,,,0.001%,0.006%,0.003%,0.003%,0.001%,,,,0.002%,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Binh Thanh/Binh Loi Trung Hub,0.002%,0.002%,0.004%,0.002%,0.001%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM PN/Cau Kieu Hub,,0.006%,0.005%,0.003%,0.003%,0.006%,0.005%,0.004%,0.004%,0.003%,0.002%,0.002%,0.002%,0.007%,0.004%,,,,,,,,,,,,,,,,,,,,
51-HCM Cu Chi/Phuoc Hiep Hub,,0.008%,0.005%,0.006%,0.014%,0.012%,0.017%,0.012%,0.010%,0.010%,0.002%,0.011%,0.004%,0.008%,0.017%,0.021%,0.121%,0.003%,0.004%,,0.002%,0.018%,0.005%,0.004%,,,0.003%,0.001%,0.007%,,,,,,
51-HCM D8/Pham The Hien Hub,0.003%,0.001%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Binh Tan/Binh Hung Hoa B Hub,0.004%,0.012%,0.010%,0.010%,0.010%,0.009%,0.011%,0.007%,0.014%,0.006%,0.009%,0.022%,0.011%,0.017%,0.027%,0.013%,0.033%,0.027%,0.017%,0.028%,0.054%,0.200%,0.031%,0.007%,0.005%,0.003%,0.003%,0.002%,0.003%,0.003%,0.002%,0.001%,0.002%,0.005%,0.003%
51-HCM Tan Phu/Phu Tho Hoa Hub,0.001%,0.004%,0.002%,0.004%,0.006%,0.006%,0.006%,0.007%,0.005%,0.008%,0.003%,0.002%,0.003%,0.004%,0.006%,0.004%,0.004%,0.006%,0.003%,0.003%,0.004%,0.008%,0.003%,0.002%,,,,,,,,,,,
51-HCM Go Vap/Le Duc Tho Hub,0.002%,0.007%,0.005%,0.008%,0.006%,0.011%,0.014%,0.014%,0.020%,0.005%,0.005%,0.002%,0.004%,0.005%,0.007%,0.003%,0.003%,0.005%,0.003%,0.001%,0.003%,0.001%,0.002%,0.002%,0.001%,0.001%,0.002%,0.001%,0.000%,,0.001%,0.001%,0.002%,0.001%,0.002%
51-HCM Tan Binh/Truong Chinh Hub,0.004%,0.003%,0.005%,0.005%,0.003%,0.002%,0.001%,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM D7/Dao Tri Hub,0.002%,0.003%,0.003%,0.002%,0.002%,0.003%,0.002%,0.002%,0.003%,0.002%,0.001%,0.001%,0.002%,0.003%,0.001%,0.001%,0.001%,0.001%,0.001%,0.006%,0.003%,0.009%,0.004%,0.001%,0.001%,0.004%,0.006%,0.002%,0.002%,0.001%,0.001%,0.001%,0.002%,0.004%,0.002%
51-HCM D10/Dien Hong Hub,0.001%,0.004%,0.004%,0.006%,0.016%,0.008%,0.010%,0.005%,0.007%,0.004%,0.004%,0.004%,0.003%,0.000%,,,,,,,,,,,,,,,,,,,,,
51-HCM D7/Bui Van Ba Hub,0.003%,0.001%,0.002%,0.003%,0.003%,0.003%,0.003%,0.004%,0.006%,0.003%,0.002%,0.004%,0.003%,0.002%,0.001%,0.001%,0.001%,0.001%,0.002%,0.002%,,,,,,,,,,,,,,,
51-HCM D9/Phuoc Long B Hub,0.003%,0.003%,0.007%,0.006%,0.007%,0.009%,0.013%,0.031%,0.044%,0.008%,0.020%,0.016%,0.009%,0.010%,0.004%,0.005%,0.004%,0.004%,0.002%,0.003%,0.001%,0.006%,0.003%,0.004%,0.004%,0.001%,0.002%,0.001%,0.000%,0.000%,0.002%,0.000%,0.001%,0.002%,0.003%
51-HCM D9/Xa Lo Ha Noi Hub,,0.001%,0.002%,,,,0.001%,0.001%,0.002%,,0.002%,,0.001%,0.001%,,,,,,,,,,,,,,,,,,,,,
51-HCM Binh Tan/Nguyen Thi Tu Hub,0.008%,0.006%,0.006%,0.004%,0.007%,0.008%,0.010%,0.005%,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Thu Duc/Hiep Binh Chanh Hub,0.008%,0.006%,0.007%,0.007%,0.009%,0.015%,0.018%,0.013%,0.008%,0.008%,0.003%,0.009%,0.006%,0.007%,,,,,,,,,,,,,,,,,,,,,
50-HCM D4 Hub,0.003%,0.010%,0.006%,0.009%,0.007%,0.010%,0.012%,0.007%,0.007%,0.003%,0.003%,0.007%,0.003%,0.003%,0.003%,0.006%,0.002%,0.004%,0.003%,0.003%,0.007%,0.007%,0.004%,0.006%,0.009%,0.012%,0.005%,0.004%,0.004%,0.008%,0.011%,0.009%,0.010%,0.007%,0.004%
51-HCM D12/Nguyen Van Qua Hub,0.004%,0.004%,0.003%,0.005%,0.003%,0.003%,0.008%,0.005%,0.004%,0.005%,0.002%,0.004%,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Tan Phu/Tan Thoi Hoa Hub,0.001%,0.005%,0.003%,0.001%,0.002%,0.002%,0.003%,0.003%,0.001%,0.001%,0.001%,0.003%,0.006%,0.001%,,0.000%,0.002%,0.003%,0.001%,0.000%,0.001%,0.002%,0.000%,0.000%,0.001%,0.003%,0.003%,0.001%,,,,,,,
50-HCM Binh Chanh/Phong Phu Hub,0.001%,0.004%,0.003%,0.001%,0.003%,0.002%,0.001%,0.002%,0.001%,0.001%,0.003%,0.006%,0.004%,0.002%,0.006%,0.004%,0.002%,0.003%,0.000%,0.001%,0.001%,0.002%,0.000%,,0.001%,0.000%,0.001%,0.001%,,0.000%,0.002%,0.001%,0.001%,0.002%,0.001%
51-HCM D12/Thoi An Hub,0.001%,0.001%,0.001%,0.000%,0.001%,0.002%,0.001%,0.001%,0.001%,0.000%,0.000%,0.001%,0.000%,0.001%,0.000%,0.000%,0.000%,0.000%,0.000%,,,0.000%,0.000%,0.000%,0.001%,0.001%,0.000%,0.000%,0.001%,0.000%,0.000%,0.001%,,0.002%,0.003%
51-HCM Binh Chanh/Tan Quy Tay Hub,0.002%,0.005%,0.002%,0.002%,0.004%,0.001%,0.008%,0.004%,0.009%,0.002%,0.003%,0.001%,,,,,,,,,,,,,,,,,,,,,,,
50-HCM D8 Hub,0.004%,0.007%,0.007%,0.009%,0.006%,0.005%,0.005%,0.004%,0.008%,0.006%,0.004%,0.006%,0.009%,0.007%,0.007%,0.007%,0.006%,0.004%,0.004%,0.003%,0.003%,0.007%,0.006%,0.004%,0.003%,0.004%,0.002%,0.001%,0.001%,0.002%,0.008%,0.004%,0.002%,0.002%,0.002%
51-HCM Tan Phu/Le Trong Tan Hub,0.005%,0.005%,0.006%,0.004%,0.005%,0.012%,0.008%,0.009%,0.011%,0.005%,0.007%,0.004%,0.006%,0.006%,0.003%,0.003%,0.006%,0.003%,0.010%,0.010%,0.005%,0.009%,0.005%,0.005%,0.003%,0.002%,0.002%,0.002%,0.004%,0.002%,0.002%,0.002%,0.003%,0.004%,0.002%
51-HCM Tan Binh/Phuong 14 Hub,0.003%,0.006%,0.009%,0.003%,0.002%,0.013%,0.010%,0.005%,0.018%,0.002%,0.004%,0.002%,0.003%,0.002%,0.004%,0.002%,0.002%,0.001%,0.002%,0.002%,0.001%,0.003%,0.000%,0.001%,0.002%,0.001%,0.000%,,,,,,,,
51-HCM Binh Chanh/Tran Van Giau Hub,,0.002%,0.003%,0.005%,0.003%,0.003%,0.003%,0.002%,0.004%,0.002%,0.002%,0.006%,0.006%,0.010%,0.023%,0.007%,0.017%,0.009%,0.004%,0.011%,0.021%,0.020%,,,,,,,,,,,,,
50-HCM D11 Hub,0.008%,0.009%,0.008%,0.005%,0.008%,0.008%,0.011%,0.009%,0.008%,0.005%,0.004%,0.004%,0.006%,0.011%,0.004%,0.004%,0.005%,0.003%,0.004%,0.003%,0.003%,0.006%,0.003%,0.003%,0.003%,0.003%,0.002%,0.001%,0.001%,0.001%,0.005%,0.002%,0.003%,0.006%,0.002%
51-HCM Hoc Mon/Tan Thoi Nhi Hub,,0.004%,0.002%,0.003%,0.003%,0.001%,0.002%,0.005%,0.002%,0.002%,0.003%,0.004%,0.000%,0.001%,0.001%,0.004%,0.010%,0.029%,0.015%,0.022%,0.019%,0.042%,0.004%,0.008%,0.004%,0.007%,0.001%,0.005%,0.001%,0.001%,0.001%,,,,
51-HCM D7/Tan Kieng Hub,0.002%,0.003%,0.004%,0.003%,0.004%,0.005%,0.003%,0.004%,0.003%,0.001%,0.002%,0.002%,0.002%,0.001%,0.003%,0.001%,0.001%,0.001%,0.003%,0.001%,0.003%,0.003%,0.000%,0.003%,0.002%,0.005%,0.004%,,0.001%,,,,,,
51-HCM D12/Thanh Xuan Hub,0.017%,0.004%,0.006%,0.015%,0.006%,0.006%,0.008%,0.009%,0.015%,0.003%,0.003%,0.005%,0.004%,0.005%,0.003%,0.004%,0.001%,0.004%,0.001%,0.005%,0.001%,0.002%,0.001%,0.001%,0.001%,0.001%,0.001%,0.000%,,,,,,,
50-HCM D2/An Phu Hub,0.005%,0.003%,0.004%,0.005%,0.005%,0.003%,0.004%,0.004%,0.006%,0.002%,0.002%,0.005%,0.003%,0.003%,0.002%,0.002%,0.002%,0.002%,0.003%,0.005%,0.003%,0.004%,0.002%,0.001%,0.002%,0.001%,0.001%,0.001%,,,,,0.005%,0.003%,0.003%
51-HCM D8/Ben Binh Dong Hub,0.001%,0.002%,0.002%,0.001%,0.001%,0.000%,0.001%,0.003%,0.003%,0.004%,0.004%,0.005%,0.006%,,,,,,,,,,,,,,,,,,,,,,
50-HCM Binh Chanh/Vinh Loc Hub,0.009%,0.020%,0.014%,0.015%,0.023%,0.148%,0.123%,0.389%,0.211%,0.017%,0.012%,0.011%,0.014%,0.015%,0.007%,0.007%,0.014%,0.014%,0.009%,0.013%,0.047%,0.043%,0.014%,0.038%,0.010%,0.007%,0.010%,0.006%,0.004%,0.004%,0.003%,0.008%,0.004%,0.003%,0.001%
52-HCM SDD-01 Hub,0.002%,0.009%,0.004%,0.004%,0.005%,0.012%,0.012%,0.010%,0.009%,0.010%,0.011%,0.020%,0.010%,0.019%,0.010%,,,,,,,,,,,,,,,,,,,,
51-HCM Cu Chi/Tan Phu Trung Hub,0.001%,0.000%,,0.001%,0.002%,0.001%,0.001%,0.001%,0.003%,0.001%,0.001%,0.004%,0.002%,0.002%,0.002%,0.003%,0.004%,0.003%,0.002%,0.004%,0.001%,0.002%,0.001%,0.001%,0.003%,0.002%,0.002%,0.002%,0.001%,0.001%,,,,,
51-HCM D8/Tung Thien Vuong Hub,0.005%,0.006%,0.008%,0.010%,0.007%,0.010%,0.020%,0.022%,0.016%,0.005%,0.007%,0.013%,0.003%,0.018%,0.004%,0.002%,0.002%,0.002%,0.002%,0.002%,0.005%,0.004%,0.004%,0.001%,0.005%,,,,,,,,,,
51-HCM D9/Phu Huu Hub,,0.001%,0.001%,,0.003%,0.002%,0.006%,0.032%,0.015%,0.012%,0.010%,0.016%,0.011%,0.004%,0.008%,0.003%,0.003%,0.003%,0.002%,0.001%,0.004%,0.005%,0.001%,0.011%,0.003%,0.003%,0.004%,0.002%,0.001%,0.002%,0.002%,0.001%,0.000%,0.003%,0.001%
51-HCM Thu Duc/Binh Chieu Hub,0.004%,0.004%,0.008%,0.005%,0.010%,0.004%,0.017%,0.005%,0.005%,0.002%,0.004%,0.006%,0.006%,0.006%,0.004%,0.026%,0.007%,0.017%,0.013%,0.010%,0.004%,0.004%,0.008%,0.004%,0.004%,0.004%,0.005%,0.001%,0.000%,0.000%,0.001%,0.001%,0.001%,0.001%,0.000%
51-HCM Nha Be/Phu Xuan Hub,0.001%,0.004%,0.006%,0.003%,0.017%,0.139%,0.052%,0.019%,0.021%,0.004%,0.007%,0.003%,0.002%,0.005%,0.001%,0.001%,0.002%,0.003%,0.006%,0.004%,0.001%,0.004%,0.004%,,,,,,,,,,,,
50-HCM Thu Duc/Linh Trung Hub,0.004%,0.008%,0.003%,0.004%,0.004%,0.009%,0.005%,0.016%,0.015%,0.007%,0.009%,0.011%,0.012%,0.008%,0.006%,0.005%,0.008%,0.008%,0.002%,0.002%,0.002%,0.001%,0.002%,0.004%,0.001%,0.002%,0.003%,0.000%,0.000%,0.000%,0.001%,0.001%,0.001%,0.000%,0.000%
51-HCM D6/Kinh Duong Vuong Hub,0.002%,0.005%,0.008%,0.009%,0.008%,0.007%,0.006%,0.003%,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Nha Be/Hiep Phuoc Hub,0.005%,0.004%,0.005%,0.003%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Hoc Mon/Xuan Thoi Son Hub,0.001%,0.005%,0.003%,0.003%,0.002%,0.003%,0.004%,0.002%,0.004%,0.002%,0.006%,0.005%,0.006%,0.006%,0.006%,,,,,,,,,,,,,,,,,,,,
51-HCM D9/Lien Phuong Hub,0.003%,0.004%,0.003%,0.002%,0.004%,0.000%,0.002%,0.002%,,,,,,,,,,,,,,,,,,,,,,,,,,,
50-HCM Can Gio Hub,0.045%,0.019%,0.018%,0.002%,0.010%,0.001%,,,,,,,,0.002%,,,,,,,,,,,0.002%,,,,,,,,,,0.002%
51-HCM D12/Thanh Loc Hub,0.004%,0.007%,0.006%,0.008%,0.007%,0.010%,0.016%,0.026%,0.036%,0.005%,0.050%,0.024%,0.005%,0.004%,0.002%,0.001%,0.000%,0.001%,0.002%,0.001%,0.001%,0.001%,0.002%,0.001%,0.001%,0.001%,0.001%,0.002%,0.001%,0.001%,0.002%,0.001%,0.001%,0.004%,0.001%
50-HCM Binh Tan Hub,0.002%,0.004%,0.004%,0.003%,0.002%,0.003%,0.006%,0.003%,0.003%,0.001%,0.003%,0.005%,0.006%,0.018%,0.006%,0.005%,0.013%,0.007%,0.003%,0.003%,0.015%,0.106%,0.064%,0.019%,0.007%,0.007%,0.004%,0.004%,0.004%,0.003%,0.003%,0.003%,0.002%,0.004%,0.003%
51-HCM Binh Chanh/Tan Vinh Loc Hub,0.009%,0.007%,0.004%,0.007%,0.005%,0.014%,0.018%,0.089%,0.212%,0.034%,0.161%,0.070%,0.002%,,,,,,,,,,,,,,,,,,,,,,
51-HCM Thu Duc/Linh Dong Hub,0.006%,0.012%,0.004%,0.006%,0.005%,0.005%,0.006%,0.005%,0.008%,0.004%,0.005%,0.012%,0.009%,0.019%,0.010%,0.008%,0.006%,0.008%,0.005%,0.005%,0.008%,0.007%,0.002%,0.003%,0.004%,0.005%,0.003%,0.001%,,,,,,,
51-HCM Go Vap/Nguyen Van Khoi Hub,0.004%,0.002%,0.001%,0.001%,0.000%,0.001%,0.002%,0.001%,0.002%,0.000%,0.001%,0.001%,0.001%,0.001%,,,,,,,,,,,,,,,,,,,,,
51-HCM D9/Long Binh Hub,0.001%,0.004%,0.005%,0.003%,0.007%,0.004%,0.005%,0.005%,0.009%,0.009%,0.006%,0.012%,0.008%,0.014%,0.020%,0.011%,0.009%,0.007%,0.004%,0.004%,0.015%,0.031%,0.005%,0.007%,0.016%,0.006%,,,,,,,,,
51-HCM D12/Le Thi Rieng Hub,0.001%,0.000%,0.000%,0.001%,,0.000%,0.000%,0.000%,0.000%,0.001%,,0.001%,0.000%,,0.000%,0.000%,0.001%,0.001%,0.001%,0.000%,0.000%,0.000%,0.000%,0.000%,0.001%,,,,,,,,,,
50-HCM Tan Binh/Bach Dang Hub,0.004%,0.004%,0.004%,0.004%,0.006%,0.008%,0.014%,0.014%,0.018%,0.005%,0.006%,0.005%,0.003%,0.003%,0.003%,0.002%,0.002%,0.001%,0.001%,0.000%,0.001%,0.001%,0.001%,0.001%,0.000%,0.002%,0.002%,0.001%,0.000%,0.001%,0.001%,0.001%,0.001%,0.002%,0.001%
51-HCM Binh Thanh/Binh Quoi Hub,0.008%,0.017%,0.017%,0.010%,0.011%,0.003%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM D7/Nguyen Van Linh Hub,0.002%,0.005%,0.006%,0.001%,0.004%,0.003%,0.003%,0.001%,0.006%,0.004%,0.001%,0.006%,0.004%,0.006%,0.011%,0.004%,0.005%,0.005%,0.001%,0.001%,0.002%,0.003%,0.005%,0.006%,0.009%,0.005%,0.004%,0.011%,0.001%,,,,,,
51-HCM Can Gio/Binh Khanh Hub,0.006%,0.008%,0.006%,0.008%,0.006%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM D11/Phuong 15 Hub,,0.009%,0.002%,0.005%,0.008%,0.011%,0.002%,0.002%,0.006%,,0.001%,,0.001%,,0.001%,0.002%,0.003%,0.002%,,,0.001%,0.002%,0.001%,,,,,,,,,,,,
51-HCM Cu Chi/Tan An Hoi Hub,,0.001%,0.001%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM D10/Hoa Hung Hub,0.008%,0.009%,0.010%,0.009%,0.009%,0.005%,0.004%,0.002%,0.020%,0.006%,0.002%,0.003%,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Go Vap/Phuong 17 Hub,0.002%,0.003%,0.003%,0.001%,0.001%,0.003%,0.001%,0.002%,0.001%,0.001%,0.001%,0.001%,0.003%,0.001%,0.001%,0.001%,0.001%,0.001%,0.002%,0.000%,0.002%,0.004%,0.001%,0.002%,0.003%,,,,,,,,,,
50-HCM Binh Tan/Tan Tao A Hub,,,,6.977%,0.018%,0.033%,0.010%,0.009%,0.020%,0.002%,0.004%,0.005%,0.004%,0.003%,0.010%,0.002%,0.001%,,0.001%,0.001%,0.001%,0.002%,0.001%,0.001%,0.001%,0.002%,0.001%,0.001%,0.000%,0.001%,0.000%,,0.000%,,0.001%
51-HCM Tan Phu/Son Ky Hub,0.004%,0.004%,0.003%,0.005%,0.018%,0.011%,0.005%,0.006%,0.009%,0.002%,0.003%,0.003%,0.003%,0.002%,0.004%,0.002%,0.002%,0.006%,0.004%,0.002%,,,,,,,,,,,,,,,
53-HCM Bulky DC,,0.002%,0.002%,,0.002%,0.001%,0.002%,0.003%,0.003%,0.004%,0.001%,0.008%,0.002%,,,,,,,,,,,,,,,,,,,,,,
51-HCM Binh Tan/Binh Tri Dong A Hub,0.005%,0.007%,0.004%,0.020%,0.005%,0.026%,0.020%,0.015%,0.029%,0.008%,0.010%,0.022%,0.015%,0.022%,0.023%,0.021%,0.020%,0.019%,0.011%,0.012%,0.031%,0.028%,0.008%,0.011%,0.009%,0.017%,0.013%,0.004%,0.004%,0.005%,0.004%,0.004%,0.002%,0.009%,0.007%
51-HCM D8/Bui Minh Truc Hub,0.005%,0.010%,0.010%,0.005%,0.009%,0.007%,0.005%,0.005%,0.007%,0.002%,0.003%,0.004%,0.003%,0.003%,0.002%,0.002%,0.003%,0.002%,0.003%,0.004%,0.003%,0.007%,0.003%,0.003%,0.006%,0.002%,0.007%,0.004%,0.003%,0.001%,,,,,
50-HCM Cu Chi Hub,0.003%,0.001%,0.002%,0.001%,0.001%,0.000%,0.005%,0.002%,0.003%,0.002%,0.002%,0.004%,0.002%,0.003%,0.003%,0.003%,0.001%,0.006%,0.004%,0.003%,0.008%,0.008%,0.008%,0.012%,0.004%,0.002%,0.001%,0.001%,0.003%,0.002%,0.005%,0.001%,0.001%,0.000%,0.001%
50-HCM Nha Be Hub,0.001%,0.002%,0.002%,0.003%,0.005%,0.004%,0.002%,0.004%,0.003%,0.003%,0.000%,0.002%,0.001%,0.003%,0.002%,0.003%,0.011%,0.018%,0.004%,0.005%,0.004%,0.003%,0.003%,0.003%,0.002%,0.001%,0.001%,0.001%,0.001%,0.000%,0.001%,0.003%,0.003%,0.005%,0.002%
51-HCM Thu Duc/Ngo Chi Quoc Hub,0.008%,0.011%,0.009%,0.040%,0.013%,0.013%,0.044%,0.050%,0.054%,0.015%,0.011%,0.029%,0.071%,0.073%,0.029%,0.017%,0.020%,0.015%,0.009%,0.012%,0.004%,0.007%,0.001%,,,,,,,,,,,,
51-HCM Tan Binh/Tan Son Nhat Hub,0.004%,0.005%,0.004%,0.004%,0.003%,0.004%,0.003%,0.005%,0.004%,0.001%,0.001%,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Phu Nhuan/Phan Xich Long Hub,0.006%,0.002%,0.003%,0.001%,0.002%,0.004%,0.001%,0.003%,0.002%,,0.002%,0.003%,0.003%,0.005%,0.001%,0.002%,0.004%,0.005%,0.002%,0.003%,0.002%,0.005%,0.002%,0.001%,0.003%,0.002%,,,,,,,,,
51-HCM Tan Phu/Tan Son Nhi Hub,0.001%,0.001%,0.002%,0.003%,0.002%,0.000%,0.003%,0.001%,0.001%,0.005%,0.000%,0.001%,0.002%,0.001%,0.003%,0.001%,0.005%,0.004%,0.001%,,,,,,,,,,,,,,,,
51-HCM D9/Tang Nhon Phu B Hub,0.001%,0.001%,0.001%,,0.000%,0.001%,0.001%,0.001%,0.001%,,0.002%,0.001%,0.002%,0.001%,0.003%,0.004%,0.003%,,,,,,0.001%,,,,,,,,,,,,
51-HCM Le Hong Phong 02 CH,0.003%,0.001%,,0.001%,0.002%,,0.006%,0.008%,0.002%,0.002%,,0.003%,,,,,,,,,,,,,,,,,,,,,,,
50-HCM Binh Chanh/Le Minh Xuan Hub,0.004%,0.006%,0.002%,0.002%,0.004%,0.006%,0.003%,0.020%,0.018%,,0.009%,0.020%,0.011%,0.011%,0.017%,0.005%,0.010%,0.004%,0.005%,0.003%,0.009%,0.024%,0.024%,0.015%,0.003%,0.003%,0.003%,0.002%,0.003%,,0.006%,,0.003%,0.052%,0.003%
51-HCM D2/Thao Dien Hub,0.009%,0.028%,0.004%,0.006%,0.005%,0.003%,0.004%,0.004%,0.004%,0.005%,0.003%,0.002%,,0.003%,0.002%,0.001%,,,,,,,,,,,,,,,,,,,
51-HCM Binh Chanh/Binh Hung Hub,0.004%,0.003%,0.004%,0.003%,0.003%,0.004%,0.003%,0.003%,0.005%,0.004%,0.003%,0.003%,0.006%,0.005%,0.003%,0.004%,0.007%,0.003%,0.002%,0.001%,0.002%,0.005%,0.002%,0.001%,0.001%,0.001%,0.000%,0.001%,0.002%,0.002%,,,,,
51-HCM Binh Thanh/Phan Van Tri Hub,0.001%,0.002%,0.003%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
50-HCM Thu Duc/Hiep Binh Phuoc Hub,0.002%,0.002%,0.003%,0.003%,0.004%,0.004%,0.005%,0.004%,0.008%,0.004%,0.003%,0.013%,0.007%,0.004%,0.004%,0.007%,0.011%,0.030%,0.024%,0.018%,0.033%,0.051%,0.013%,0.009%,0.007%,0.004%,0.002%,0.001%,0.000%,0.001%,0.001%,0.001%,0.001%,0.003%,0.002%
50-HCM Binh Chanh/Tan Tuc Hub,0.002%,0.002%,0.002%,0.003%,0.004%,0.004%,0.005%,0.004%,0.006%,0.005%,0.002%,0.007%,0.005%,0.006%,0.005%,0.002%,0.002%,0.003%,0.001%,0.001%,0.002%,0.006%,0.005%,0.012%,0.011%,0.005%,0.006%,0.002%,0.002%,0.002%,0.001%,,0.002%,0.006%,0.003%
50-HCM D9/Truong Thanh Hub,0.001%,0.000%,0.002%,0.001%,0.001%,0.001%,0.001%,0.000%,0.003%,0.002%,0.000%,0.003%,0.004%,0.002%,0.003%,0.002%,0.002%,0.002%,0.001%,0.001%,0.003%,0.005%,0.001%,0.001%,0.003%,0.002%,0.002%,0.001%,0.005%,0.002%,0.002%,0.017%,0.001%,0.003%,0.004%
51-HCM Go Vap/Phan Huy Ich Hub,0.003%,0.005%,0.006%,0.007%,0.007%,0.008%,0.008%,0.006%,0.013%,0.005%,0.003%,0.006%,0.007%,0.005%,0.005%,0.004%,0.004%,0.003%,0.002%,0.002%,0.002%,0.004%,0.003%,0.002%,0.002%,0.001%,0.001%,0.001%,0.002%,0.002%,0.002%,0.002%,0.001%,0.004%,0.001%
51-HCM D2/Cat Lai Hub,0.003%,0.003%,0.006%,0.001%,0.002%,0.003%,0.004%,0.002%,0.002%,0.001%,0.001%,0.002%,0.003%,0.001%,0.002%,0.000%,0.003%,0.002%,0.000%,0.002%,0.000%,0.001%,0.002%,0.001%,0.002%,0.002%,0.003%,0.000%,0.001%,0.001%,0.002%,0.002%,0.001%,0.002%,0.001%
51-HCM Cu Chi/Trung Lap Thuong Hub,0.003%,0.002%,0.001%,,,0.002%,0.001%,0.003%,0.005%,0.002%,0.002%,0.001%,0.001%,0.001%,0.003%,0.004%,,0.004%,,0.002%,0.007%,0.017%,0.002%,0.009%,0.002%,0.003%,,0.012%,0.004%,0.002%,,,,0.002%,
51-HCM D10/Truong Son Hub,0.006%,0.012%,0.010%,0.003%,0.008%,0.008%,0.005%,0.006%,0.006%,0.000%,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Tan Phu/Kenh Tan Hoa Hub,0.003%,0.004%,0.004%,0.003%,0.003%,0.006%,0.003%,0.001%,0.004%,0.004%,0.008%,0.004%,0.004%,0.012%,0.007%,0.003%,0.003%,,,,,,,,,,,,,,,,,,
51-HCM Bay Hien/Tai Thiet Hub,0.001%,0.002%,0.002%,0.001%,0.003%,0.004%,0.002%,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Go Vap/Phuong 15 Hub,0.003%,0.002%,0.001%,0.008%,0.001%,0.000%,0.001%,0.001%,0.001%,0.000%,0.000%,0.001%,0.001%,0.001%,0.002%,0.002%,0.001%,,,,,,,,,,,,,,,,,,
51-HCM D8/Phu Dinh Hub,0.001%,0.005%,0.002%,0.002%,0.003%,0.003%,0.003%,0.001%,0.001%,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM D9/Nguyen Van Tang Hub,0.004%,0.005%,0.005%,0.006%,0.005%,0.006%,0.006%,0.005%,0.021%,0.015%,0.004%,0.006%,0.011%,0.002%,0.002%,0.002%,0.003%,0.004%,0.003%,0.004%,0.003%,0.004%,0.002%,0.001%,0.004%,0.006%,0.008%,0.023%,0.007%,,,,,,
51-HCM Cu Chi/Tan Thanh Dong Hub,,0.004%,0.002%,0.002%,0.002%,0.003%,0.005%,0.003%,0.003%,0.004%,0.004%,0.005%,0.002%,0.001%,,0.002%,0.006%,0.007%,0.004%,0.002%,0.009%,0.058%,0.020%,0.010%,0.006%,0.024%,0.002%,0.009%,0.003%,0.001%,0.002%,0.002%,0.009%,0.027%,0.002%
51-HCM Tan Binh/Bay Hien Hub,0.006%,0.002%,0.003%,0.002%,0.001%,0.004%,0.003%,0.004%,0.002%,0.000%,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM D9/Hoang Huu Nam Hub,0.004%,0.002%,0.001%,0.002%,0.004%,0.004%,0.010%,0.003%,0.006%,0.001%,0.001%,0.005%,0.001%,0.004%,0.001%,0.002%,0.002%,0.003%,0.002%,0.003%,0.007%,0.004%,0.006%,0.002%,0.002%,0.004%,,0.002%,0.002%,,,,,,
51-HCM D11/Binh Thoi Hub,0.004%,0.003%,0.003%,0.005%,0.003%,0.004%,0.004%,0.003%,0.007%,0.001%,0.002%,0.006%,0.004%,0.004%,,,,,,,,,,,,,,,,,,,,,
51-HCM D3/Nhieu Loc Hub,0.006%,0.010%,0.005%,0.003%,0.014%,0.008%,0.003%,0.007%,0.003%,,0.001%,0.001%,,,,,,,,,,,,,,,,,,,,,,,
50-HCM D12/Trung My Tay Hub,0.002%,0.002%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Hoc Mon/Nguyen Thi Soc Hub,,0.001%,0.003%,0.002%,0.001%,0.002%,0.002%,0.001%,0.002%,0.007%,0.001%,0.004%,0.004%,0.003%,0.005%,0.004%,0.005%,0.002%,0.002%,0.002%,0.002%,0.004%,0.003%,0.000%,,,,,,,,,,,
50-HCM D12/An Suong Hub,0.005%,0.004%,0.004%,0.004%,0.003%,0.004%,0.003%,0.002%,0.002%,0.004%,0.002%,0.001%,0.003%,0.003%,0.004%,0.004%,0.002%,0.001%,0.002%,0.004%,0.002%,0.008%,0.003%,0.005%,0.003%,0.003%,0.004%,0.003%,0.003%,0.002%,0.002%,0.003%,0.003%,0.004%,0.005%
51-HCM D12/Dong Hung Thuan Hub,,,0.001%,0.000%,0.001%,0.002%,0.003%,0.001%,0.000%,0.004%,0.005%,0.002%,0.005%,0.005%,0.003%,0.002%,0.003%,0.002%,0.001%,0.003%,0.001%,0.003%,0.002%,,,,,,,,,,,,
51-HCM Phu Nhuan/Truong Sa Hub,0.002%,0.001%,0.001%,0.002%,0.003%,0.002%,0.003%,0.002%,0.005%,0.007%,0.003%,0.001%,0.001%,0.006%,0.001%,0.001%,0.001%,0.003%,0.001%,0.002%,0.001%,0.003%,0.004%,0.001%,0.003%,,,,,,,,,,
51-HCM Nha Be/Phuoc Kien Hub,0.019%,0.040%,0.048%,0.025%,0.017%,0.016%,0.028%,0.029%,0.033%,0.006%,0.011%,0.015%,0.005%,0.008%,0.003%,0.003%,0.006%,0.003%,0.005%,0.003%,0.005%,0.006%,0.004%,0.004%,0.002%,0.009%,0.013%,0.003%,0.002%,0.001%,0.000%,,,,0.006%
51-HCM Go Vap/Phuong 5 Hub,0.005%,0.006%,0.002%,0.001%,0.003%,0.002%,0.001%,0.002%,0.023%,0.004%,0.003%,0.008%,0.007%,0.004%,0.005%,,,,,,,,,,,,,,,,,,,,
51-HCM D7/Huynh Tan Phat Hub,,0.002%,0.004%,0.003%,0.001%,0.004%,0.003%,0.002%,0.002%,0.002%,0.002%,0.004%,0.003%,0.002%,0.004%,0.002%,0.004%,0.003%,0.002%,0.003%,0.002%,0.006%,0.002%,0.003%,0.002%,0.003%,0.005%,,,,,,,,
51-HCM Binh Chanh/Vinh Loc A Hub,0.004%,0.007%,0.004%,0.009%,0.006%,0.007%,0.004%,0.009%,0.008%,0.002%,0.007%,0.057%,0.069%,0.016%,0.007%,0.004%,0.004%,0.004%,0.004%,0.005%,0.008%,0.004%,0.001%,0.002%,0.002%,0.004%,0.002%,0.001%,0.001%,0.003%,0.002%,0.004%,0.002%,0.002%,0.002%
50-HCM Binh Tan/An Lac Hub,0.008%,0.013%,0.027%,0.012%,0.010%,0.064%,0.022%,0.022%,0.034%,0.022%,0.008%,0.014%,0.011%,0.012%,0.011%,0.012%,0.017%,0.012%,0.005%,0.005%,0.006%,0.015%,0.006%,0.005%,0.007%,0.003%,0.004%,0.002%,0.004%,0.002%,0.002%,0.003%,0.002%,0.003%,0.002%
51-HCM D12/Le Van Khuong Hub,0.004%,0.004%,0.004%,0.003%,0.005%,0.009%,0.007%,0.007%,0.010%,0.012%,0.008%,0.008%,0.009%,0.009%,0.005%,0.003%,0.002%,0.002%,,0.002%,0.002%,0.002%,0.002%,0.001%,0.000%,,,,,,,,,,
50-HCM D2 Hub,0.001%,0.000%,0.001%,0.001%,0.002%,0.001%,0.000%,0.001%,0.001%,,0.000%,0.001%,0.001%,,0.001%,,0.000%,0.001%,0.000%,,,0.001%,0.001%,0.001%,0.000%,0.002%,0.001%,0.012%,0.001%,,0.003%,,0.001%,0.001%,0.000%
51-HCM D3/Ban Co Hub,0.005%,0.004%,0.003%,0.002%,0.001%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
53-HCM Bulky 02 DC,0.005%,0.004%,0.001%,,0.001%,0.001%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM D9/Long Truong Hub,,0.003%,0.003%,0.002%,0.002%,0.002%,0.000%,0.001%,0.003%,0.005%,0.005%,0.011%,,,,,,,,,,,,,,,,,,,,,,,
54-HCM FM 01 Hub,0.002%,0.007%,0.009%,0.002%,0.001%,0.001%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM D8/KDC Binh Hung Hub,0.010%,0.009%,0.010%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM Hoc Mon/Thi Tran Hub,0.001%,0.006%,0.002%,0.001%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
51-HCM D2/An Khanh Hub,0.002%,0.002%,0.003%,0.002%,0.004%,0.002%,0.001%,0.000%,0.002%,0.002%,0.001%,0.001%,0.001%,0.002%,0.001%,0.003%,0.001%,0.003%,0.001%,0.001%,,0.003%,0.004%,0.003%,0.003%,0.007%,0.003%,0.001%,0.001%,,,,,,
50-HCM D7 Hub,0.005%,0.012%,0.008%,0.008%,0.010%,0.008%,0.011%,0.016%,0.016%,0.005%,0.003%,0.006%,0.006%,0.003%,0.003%,0.002%,0.003%,0.002%,0.001%,0.002%,0.002%,0.005%,0.004%,0.002%,0.001%,0.001%,0.001%,0.001%,0.002%,0.002%,0.001%,0.002%,0.002%,0.003%,0.002%
51-HCM D6/Phuong 10 Hub,,,,21.429%,0.005%,0.011%,0.007%,0.011%,0.013%,0.010%,0.011%,0.020%,0.014%,0.011%,0.015%,0.014%,0.007%,0.003%,0.006%,0.008%,0.007%,0.009%,0.006%,0.005%,0.004%,0.002%,0.002%,0.002%,0.002%,0.001%,0.001%,0.001%,,,
51-HCM Le Hong Phong CH,,,,,0.003%,0.003%,0.001%,0.002%,0.004%,,0.004%,,0.013%,0.010%,,,,,,,,,,,,,,,,,,,,,
50-HCM Go Vap/Quang Trung Hub,,,,0.004%,0.003%,0.003%,0.004%,0.004%,0.005%,0.005%,0.003%,0.005%,0.004%,0.004%,0.004%,0.003%,0.004%,0.003%,0.003%,0.004%,0.005%,0.007%,0.004%,0.005%,0.006%,0.006%,0.006%,0.005%,0.005%,0.004%,0.002%,0.005%,0.008%,0.011%,0.009%
50-HCM Binh Thanh Hub,,,,,0.026%,0.028%,0.029%,0.022%,0.018%,0.008%,0.015%,0.017%,0.010%,0.014%,0.008%,0.008%,0.011%,0.007%,0.003%,0.008%,0.009%,0.004%,0.003%,0.005%,0.007%,0.003%,0.005%,0.002%,0.002%,0.003%,0.002%,0.001%,0.002%,0.001%,0.003%
51-HCM D12/Thanh Loc 02 Hub,,,,,,266.667%,0.005%,0.011%,0.070%,0.108%,0.188%,0.090%,0.001%,,,,,,,,,,,,,,,,,,,,,,`;

function flmFindSheetByKeyword_(ss,keywords){
  if(!ss)return null;
  const sheets=ss.getSheets();
  for(let i=0;i<sheets.length;i++){
    const name=sheets[i].getName().toLowerCase();
    for(let j=0;j<keywords.length;j++){
      if(name.indexOf(keywords[j].toLowerCase())>=0)return sheets[i];
    }
  }
  return null;
}
function flmFindDateColIdx_(sheet){
  if(!sheet||sheet.getLastRow()<1)return 0;
  const headers=sheet.getRange(1,1,1,Math.min(sheet.getLastColumn(),15)).getValues()[0].map(h=>String(h||'').trim().toLowerCase());
  const idx=headers.findIndex(h=>['date','ngày','deadline','report_date','d'].some(kw=>h.indexOf(kw)>=0));
  return idx>=0?idx:0;
}
function flmSheetDateStats_(sheet,colDateIdx){
  const lastRow=sheet.getLastRow();
  if(lastRow<=1)return {dates:[],latestDate:null,rows:0};
  const cacheKey='flm:sheet_date_stats:v3:'+sheet.getName()+':'+lastRow+':'+colDateIdx;
  const cached=flmCacheGet_(cacheKey);
  if(cached&&cached.dates)return cached;
  const dateSet=new Set();let latest='',validRows=0;
  const chunkValues=sheet.getRange(2,colDateIdx+1,lastRow-1,1).getValues();
  for(let i=0;i<chunkValues.length;i++){
    const raw=chunkValues[i][0];if(raw==null||raw==='')continue;
      let d='';
      if(raw instanceof Date){
        d=Utilities.formatDate(raw,'Asia/Ho_Chi_Minh','yyyy-MM-dd');
      }else if(typeof raw==='number'&&raw>30000&&raw<60000){
        const dt=new Date(Math.round((raw-25569)*86400*1000));
        d=Utilities.formatDate(dt,'Asia/Ho_Chi_Minh','yyyy-MM-dd');
      }else{
        const s=String(raw||'').trim();
        if(/^\d{4}-\d{2}-\d{2}/.test(s))d=s.slice(0,10);
        else{
          const m=/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(s);
          if(m)d=m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
        }
      }
      if(/^\d{4}-\d{2}-\d{2}$/.test(d)){dateSet.add(d);if(d>latest)latest=d;validRows++;}
  }
  const dates=Array.from(dateSet).sort();
  const res={dates:dates,latestDate:latest||null,rows:validRows};
  flmCachePut_(cacheKey,res,3600);
  return res;
}
function flmReadClaimsSheetMaster_(ss,anchor,masterMap,tabKey){
  const isAll=!tabKey||tabKey==='all'||tabKey==='claims'||tabKey==='risk';
  const alertPivot=(isAll||tabKey==='alert')?(ss.getSheetByName('ALERT_PIVOT')||flmFindSheetByKeyword_(ss,['alert_pivot','alert pivot','alert_summary','alert_agg'])):null;
  const urgentPivot=(isAll||tabKey==='urgent')?(ss.getSheetByName('URGENT_PIVOT')||flmFindSheetByKeyword_(ss,['urgent_pivot','urgent pivot','prelost_pivot','prelost pivot','urgent_summary'])):null;
  const alertSheet=(isAll||tabKey==='alert')&&!alertPivot&&flmFindSheetByKeyword_(ss,['[alert]','cần xử lý']);
  const urgentSheet=(isAll||tabKey==='urgent')&&!urgentPivot&&flmFindSheetByKeyword_(ss,['[urgent]','bắt buộc feedback']);
  if(!alertSheet&&!urgentSheet&&!alertPivot&&!urgentPivot)return null;
  const metadata=[],groups=[];
  function processPivotSheet(sheet,source){
    if(!sheet||sheet.getLastRow()<=1)return false;
    const allValues=sheet.getDataRange().getValues();
    if(allValues.length<=1)return false;
    const firstVal=allValues[0][0];
    const hasHeader=!(firstVal instanceof Date)&&!/^\d{4}-\d{2}-\d{2}/.test(String(firstVal||'').trim());
    const startIdx=hasHeader?1:0;
    const headers=hasHeader?allValues[0].map(h=>String(h||'').trim().toLowerCase()):[];
    const findCol=(kws,def)=>{if(!headers.length)return def;const idx=headers.findIndex(h=>kws.some(kw=>h.indexOf(kw)>=0));return idx>=0?idx:def};
    const cDate=findCol(['date','ngày','deadline'],0);
    const cStation=findCol(['station','hub','trạm','fleet_final_station'],1);
    const cAging=findCol(['aging','tuổi'],2);
    const cStage=findCol(['stage','status','yêu cầu'],3);
    const cFb=findCol(['feedback','phản hồi'],-1);
    const cHv=findCol(['hv','high_value','high value'],-1);
    const cN=findCol(['orders','count','records','số lượng','qty','sl'],4);
    const cCogs=findCol(['cogs','amount','amt','tiền','sum'],5);

    const dateSet=new Set();let latestDate='';
    const rowDates=new Array(allValues.length);
    for(let i=startIdx;i<allValues.length;i++){
      const rawDate=allValues[i][cDate];let d='';
      if(rawDate instanceof Date)d=Utilities.formatDate(rawDate,'Asia/Ho_Chi_Minh','yyyy-MM-dd');
      else if(typeof rawDate==='number'&&rawDate>30000&&rawDate<60000){
        d=Utilities.formatDate(new Date(Math.round((rawDate-25569)*86400*1000)),'Asia/Ho_Chi_Minh','yyyy-MM-dd');
      }else{
        const s=String(rawDate||'').trim();
        if(/^\d{4}-\d{2}-\d{2}/.test(s))d=s.slice(0,10);
        else{
          const m=/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(s);
          if(m)d=m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
        }
      }
      rowDates[i]=d;
      if(/^\d{4}-\d{2}-\d{2}$/.test(d)){dateSet.add(d);if(d>latestDate)latestDate=d;}
    }
    const targetDate=dateSet.has(anchor)?anchor:latestDate;
    if(!targetDate)return false;
    metadata.push({row_kind:'meta',source:source,snapshot_date:targetDate,ingested_at:targetDate+'T23:00:00+07:00',requested_available:true});
    const grouped={};
    for(let i=startIdx;i<allValues.length;i++){
      if(rowDates[i]!==targetDate)continue;
      const row=allValues[i];
      const stationRaw=String(row[cStation]||'').trim(),code=flmMatchHubCode_(stationRaw,masterMap);
      if(!code)continue;
      const n=Math.round(Number(cN>=0?row[cN]:1));
      if(!Number.isSafeInteger(n)||n<1)continue;
      const agingVal=cAging>=0?row[cAging]:null;let groupAging='Chưa có aging';
      if(agingVal!=null&&agingVal!==''){const nDays=Number(agingVal);groupAging=isFinite(nDays)?(nDays<=3?'0-3 days':nDays<=7?'4-7 days':nDays<=14?'8-14 days':'>14 days'):String(agingVal);}
      const stage=cStage>=0&&row[cStage]?String(row[cStage]).trim():'UNKNOWN';
      const cogsVal=cCogs>=0?row[cCogs]:null,cogsNum=flmTeamNum_(cogsVal),isMissing=cogsVal==null||String(cogsVal).trim()==='';
      const hvVal=cHv>=0?String(row[cHv]||'').toLowerCase():'';
      const isHv=cHv>=0?(hvVal==='hv'||hvVal==='true'||hvVal==='1'):((cogsNum!=null&&cogsNum>=1000000)||stage.indexOf('GTC')>=0);
      const fbRaw=cFb>=0&&row[cFb]?String(row[cFb]).trim():'',feedback=!fbRaw?'Chưa phản hồi':/done|xác nhận|chuyển|đối soát/i.test(fbRaw)?'Đã phản hồi':fbRaw;
      const groupKey=stationRaw+'|'+groupAging+'|'+stage+'|'+isHv+'|'+feedback;
      if(!grouped[groupKey])grouped[groupKey]={row_kind:'group',source:source,hubCode:code,station:stationRaw,group_aging:groupAging,stage:stage,high_value:isHv,feedback:feedback,snapshot_date:targetDate,n:0,cogs:0,missing_cogs:0,max_duplicate:1};
      const g=grouped[groupKey];g.n+=n;if(isMissing)g.missing_cogs+=n;else g.cogs+=(cogsNum||0);
    }
    Object.values(grouped).forEach(g=>{groups.push(g);});
    return true;
  }
  function processSheet(sheet,source,colDateIdx,colStationIdx,colShipIdx,colAgingIdx,colCogsIdx,colStageIdx,colFbIdx){
    if(!sheet||sheet.getLastRow()<=1)return;
    const lastCol=Math.min(sheet.getLastColumn(),15);
    const headers=sheet.getRange(1,1,1,lastCol).getValues()[0].map(h=>String(h||'').trim().toLowerCase());
    const findCol=(kws,def)=>{if(!headers.length)return def;const idx=headers.findIndex(h=>kws.some(kw=>h.indexOf(kw)>=0));return idx>=0?idx:def};
    const cDate=findCol(['date','deadline'],colDateIdx),cStation=findCol(['fleet_final_station','station','hub'],colStationIdx),cShip=findCol(['spx_shipment_id','shipment_id'],colShipIdx),cAging=findCol(['aging'],colAgingIdx),cCogs=findCol(['cogs','amt'],colCogsIdx),cStage=findCol(['fleet_final_status','yêu cầu','stage'],colStageIdx),cFb=findCol(['phản hồi','feedback'],colFbIdx);
    const numCols=Math.max(cDate,cStation,cShip,cAging,cCogs,cStage,cFb)+1;
    const stats=flmSheetDateStats_(sheet,cDate);
    const targetDate=(stats.dates||[]).indexOf(anchor)>=0?anchor:stats.latestDate;
    if(!targetDate)return;
    metadata.push({row_kind:'meta',source:source,snapshot_date:targetDate,ingested_at:targetDate?targetDate+'T23:00:00+07:00':null,requested_available:true});
    const lastRow=sheet.getLastRow(),CHUNK_SIZE=500;
    const grouped={},seenShipments=new Set();let maxDup=1;
    function processRow(row){
      const rawDate=row[cDate];let d='';
      if(rawDate instanceof Date)d=Utilities.formatDate(rawDate,'Asia/Ho_Chi_Minh','yyyy-MM-dd');
      else if(typeof rawDate==='number'&&rawDate>30000&&rawDate<60000){const dt=new Date(Math.round((rawDate-25569)*86400*1000));d=Utilities.formatDate(dt,'Asia/Ho_Chi_Minh','yyyy-MM-dd');}
      else d=String(rawDate||'').slice(0,10);
      if(d!==targetDate)return d;
      const stationRaw=String(row[cStation]||'').trim(),code=flmMatchHubCode_(stationRaw,masterMap);
      if(!code)return d;
      const shipId=cShip>=0?String(row[cShip]||'').trim():'';
      const isValidShipId=shipId&&shipId!=='-'&&shipId.toLowerCase()!=='n/a'&&shipId!=='0';
      if(isValidShipId){
        const dupKey=source+'|'+targetDate+'|'+code+'|'+shipId;
        if(seenShipments.has(dupKey)) return d;
        seenShipments.add(dupKey);
      }
      const agingVal=cAging>=0?row[cAging]:null;let groupAging='Chưa có aging';
      if(agingVal!=null&&agingVal!==''){const nDays=Number(agingVal);groupAging=isFinite(nDays)?(nDays<=3?'0-3 days':nDays<=7?'4-7 days':nDays<=14?'8-14 days':'>14 days'):String(agingVal);}
      const stage=cStage>=0&&row[cStage]?String(row[cStage]).trim():'UNKNOWN',cogsVal=cCogs>=0?row[cCogs]:null,cogsNum=flmTeamNum_(cogsVal),isMissing=cogsVal==null||String(cogsVal).trim()==='';
      const isHv=(cogsNum!=null&&cogsNum>=1000000)||stage.indexOf('GTC')>=0;
      const fbRaw=cFb>=0&&row[cFb]?String(row[cFb]).trim():'',feedback=!fbRaw?'Chưa phản hồi':/done|xác nhận|chuyển|đối soát/i.test(fbRaw)?'Đã phản hồi':fbRaw;
      const groupKey=stationRaw+'|'+groupAging+'|'+stage+'|'+isHv+'|'+feedback;
      if(!grouped[groupKey])grouped[groupKey]={row_kind:'group',source:source,hubCode:code,station:stationRaw,group_aging:groupAging,stage:stage,high_value:isHv,feedback:feedback,snapshot_date:targetDate,n:0,cogs:0,missing_cogs:0,max_duplicate:1};
      const g=grouped[groupKey];g.n++;if(isMissing)g.missing_cogs++;else g.cogs+=(cogsNum||0);
      return d;
    }
    if(lastRow>=2){
      const allRows=sheet.getRange(2,1,lastRow-1,numCols).getValues();
      for(let i=0;i<allRows.length;i++)processRow(allRows[i]);
    }
    Object.values(grouped).forEach(g=>{g.max_duplicate=maxDup;groups.push(g);});
  }
  function flmIsPivotSheet_(sheet){
    if(!sheet||sheet.getLastRow()<=1)return false;
    const lastCol=Math.min(sheet.getLastColumn(),15);
    const headers=sheet.getRange(1,1,1,lastCol).getValues()[0].map(h=>String(h||'').trim().toLowerCase());
    return headers.some(h=>['orders','records','count','số lượng','qty','sl'].some(kw=>h.indexOf(kw)>=0));
  }
  let alertDone=false;
  if(alertPivot)alertDone=processPivotSheet(alertPivot,'alert');
  if(!alertDone&&alertSheet){
    if(flmIsPivotSheet_(alertSheet))alertDone=processPivotSheet(alertSheet,'alert');
    else processSheet(alertSheet,'alert',0,3,2,4,5,7,-1);
  }
  let urgentDone=false;
  if(urgentPivot)urgentDone=processPivotSheet(urgentPivot,'urgent');
  if(!urgentDone&&urgentSheet){
    if(flmIsPivotSheet_(urgentSheet))urgentDone=processPivotSheet(urgentSheet,'urgent');
    else processSheet(urgentSheet,'urgent',0,3,2,4,5,7,-1);
  }
  return {metadata:metadata,groups:groups};
}
function flmTeamClaimsFromSheet_(ctx,ssOptional,requestedTab){
  const tabKey=requestedTab||ctx.tab||'all';
  const masterKey='flm:claims-master:v3:'+ctx.anchor+':'+tabKey;
  let master=null;
  if(!ctx.force)master=flmCacheGet_(masterKey);
  if(!master||!master.groups||!master.groups.length){
    if(typeof SpreadsheetApp==='undefined')return null;
    let ss=ssOptional;
    if(!ss){try{ss=SpreadsheetApp.openById(flmTeamLostDbSheetId_())}catch(err){throw Error('CANNOT_OPEN_GSHEET ('+flmTeamLostDbSheetId_()+'): '+String(err.message||err));}}
    if(!ss)return null;
    const masterMap=flmMasterHubMap_();
    master=flmReadClaimsSheetMaster_(ss,ctx.anchor,masterMap,tabKey);
    if(master&&master.groups&&master.groups.length)flmCachePut_(masterKey,master,3600);
  }
  if(!master||!master.metadata||!master.metadata.length)return null;
  return flmTeamClaimsBuild_(master.groups,master.metadata,ctx);
}

function flmTeamGetHubOrders(request){
  const r=request||{};
  const hubCode=String(r.hubCode||'').trim();
  if(!hubCode)throw Error('FLM_HUB_CODE_REQUIRED');
  const ctx=flmTeamContext_('compensated',r);
  const allowed=new Set((ctx.codes||[]).map(String));
  if(!allowed.has(hubCode))throw Error('HUB_ACCESS_DENIED');
  const info=ctx.byCode[hubCode]||{};
  const stationName=info.hubName||info.stationName||hubCode;
  const masterMap=flmMasterHubMap_();
  const allowLost=flmLostAllowsDetails_(ctx.access)&&(!ctx.access.customAccess||(ctx.access.allowedPages||[]).includes('compensated'));

  const cacheKey=allowLost?'flm:hub-orders:v6:'+getSecurityVersion_()+':'+ctx.anchor+':'+hubCode:'flm:hub-orders:v3:'+ctx.anchor+':'+hubCode+':false';
  if(!r.force){
    const cached=flmCacheGet_(cacheKey);
    if(cached)return cached;
  }
  
  let ss=null;
  try{if(typeof SpreadsheetApp!=='undefined')ss=SpreadsheetApp.openById(flmTeamLostDbSheetId_());}catch(_){}
  
  const lostList=[];
  const urgentList=[];
  const alertList=[];
  let supabaseLostComplete=false,lostComplete=false;
  if(allowLost){
    try{
      const scopedLost=flmLostSupabaseHubOrders_(ctx,hubCode);
      lostList.push(...scopedLost);
      supabaseLostComplete=lostComplete=true;
    }catch(_){}
  }
  
  if(ss){
    if(allowLost&&!supabaseLostComplete)try{
      const lostSheet=ss.getSheetByName('LOST');
      if(lostSheet&&lostSheet.getLastRow()>0&&lostSheet.getLastColumn()>0){
        const lastCol=Math.min(lostSheet.getLastColumn(),15);
        const headers=lostSheet.getRange(1,1,1,lastCol).getValues()[0].map(h=>String(h||'').trim().toLowerCase());
        const findCol=(kws,def)=>{const idx=headers.findIndex(h=>kws.some(kw=>h.indexOf(kw)>=0));return idx>=0?idx:def};
        const {date:cDate,station:cStation}=flmLostSheetKeys_(headers);
        const cAmt=findCol(['amount','cogs','amt','tiền','tien'],10);
        const cReason=findCol(['reason','lý do','ly do'],6);
        const cShip=findCol(['shipment_id','spx_tracking','shipment','tracking','mã đơn','ma_don'],-1);
        
        const lastRow=lostSheet.getLastRow();
        const numCols=Math.max(cDate,cStation,cAmt,cReason,cShip)+1;
        const monthStart=ctx.closing.slice(0,7)+'-01',minDate=monthStart<ctx.from?monthStart:ctx.from;
        
        if(cDate>=0&&cStation>=0&&cShip>=0){
          const chunkValues=lastRow===1?[]:lostSheet.getRange(2,1,lastRow-1,numCols).getValues();
          if(chunkValues.length!==lastRow-1)throw Error('LOST_UPSTREAM');
          const fallbackRows=[];
          for(let i=0;i<chunkValues.length;i++){
            const row=chunkValues[i];
            const d=flmLostSheetDay_(row[cDate]);
            if(!d||d<minDate||d>ctx.closing)continue;
            const stationRaw=String(row[cStation]||'').trim();
            const code=flmLostHubCode_(stationRaw,ctx.aliases);
            if(code!==hubCode)continue;
            const shipId=String(row[cShip]||'').trim()||'—';
            const reason=cReason>=0&&row[cReason]?String(row[cReason]):'Chưa ghi lý do';
            const amt=cAmt>=0?flmTeamNum_(row[cAmt]):null;
            fallbackRows.push({shipmentId:shipId,date:d,reason:reason,amount:amt});
            if(fallbackRows.length>=1000)break;
          }
          lostList.push(...fallbackRows);
          lostComplete=true;
        }
      }
    }catch(_){}
    
    function readClaimOrders(sheetKeywords,list){
      try{
        const sheet=flmFindSheetByKeyword_(ss,sheetKeywords);
        if(!sheet||sheet.getLastRow()<=1)return;
        const lastCol=Math.min(sheet.getLastColumn(),15);
        const headers=sheet.getRange(1,1,1,lastCol).getValues()[0].map(h=>String(h||'').trim().toLowerCase());
        const findCol=(kws,def)=>{const idx=headers.findIndex(h=>kws.some(kw=>h.indexOf(kw)>=0));return idx>=0?idx:def};
        const cDate=findCol(['date','deadline','ngày'],0);
        const cStation=findCol(['fleet_final_station','station','hub','trạm'],1);
        const cShip=findCol(['spx_shipment_id','shipment_id','tracking','mã đơn','đơn'],-1);
        const cAging=findCol(['aging','tuổi'],2);
        const cCogs=findCol(['cogs','amt','amount','tiền'],3);
        const cStage=findCol(['fleet_final_status','yêu cầu','stage','status'],4);
        const cFb=findCol(['phản hồi','feedback'],-1);
        const cHv=findCol(['hv','high_value','high value'],-1);
        
        const lastRow=sheet.getLastRow();
        const numCols=Math.max(cDate,cStation,cShip,cAging,cCogs,cStage,cFb,cHv)+1;
        
        if(lastRow>=2){
          const chunkValues=sheet.getRange(2,1,lastRow-1,numCols).getValues();
          for(let i=0;i<chunkValues.length;i++){
            const row=chunkValues[i];
            const stationRaw=String(row[cStation]||'').trim();
            const code=flmMatchHubCode_(stationRaw,masterMap);
            if(code!==hubCode)continue;
            const rawDate=row[cDate];let d='';
            if(rawDate instanceof Date)d=Utilities.formatDate(rawDate,'Asia/Ho_Chi_Minh','yyyy-MM-dd');
            else if(typeof rawDate==='number'&&rawDate>30000&&rawDate<60000){
              d=Utilities.formatDate(new Date(Math.round((rawDate-25569)*86400*1000)),'Asia/Ho_Chi_Minh','yyyy-MM-dd');
            }else d=String(rawDate||'').slice(0,10);
            const shipId=cShip>=0?String(row[cShip]||'').trim():'—';
            const agingVal=cAging>=0?row[cAging]:null;let groupAging='Chưa có aging';
            if(agingVal!=null&&agingVal!==''){const nDays=Number(agingVal);groupAging=isFinite(nDays)?(nDays<=3?'0-3 days':nDays<=7?'4-7 days':nDays<=14?'8-14 days':'>14 days'):String(agingVal);}
            const stage=cStage>=0&&row[cStage]?String(row[cStage]).trim():'UNKNOWN';
            const cogsVal=cCogs>=0?row[cCogs]:null,cogsNum=flmTeamNum_(cogsVal);
            const isHv=cHv>=0?String(row[cHv]||'').toLowerCase()==='hv'||row[cHv]===true:((cogsNum!=null&&cogsNum>=1000000)||stage.indexOf('GTC')>=0);
            const fbRaw=cFb>=0&&row[cFb]?String(row[cFb]).trim():'',feedback=!fbRaw?'Chưa phản hồi':/done|xác nhận|chuyển|đối soát/i.test(fbRaw)?'Đã phản hồi':fbRaw;
            list.push({shipmentId:shipId,date:d,aging:groupAging,stage:stage,cogs:cogsNum,highValue:isHv,feedback:feedback});
            if(list.length>=500)break;
          }
        }
      }catch(_){}
    }
    
    readClaimOrders(['[urgent]','urgent','prelost'],urgentList);
    readClaimOrders(['[alert]','alert','cần xử lý'],alertList);
  }
  
  // Fallback 1: check cached master rows for lost
  if(allowLost&&!supabaseLostComplete&&lostList.length===0){
    try{
      const masterRows=flmCacheGet_(flmLostMasterKey_(ctx));
      if(masterRows&&masterRows.length){
        const fallbackRows=[];
        masterRows.forEach(r=>{
          if(r.hubCode===hubCode&&flmLostHubCode_(r.station,ctx.aliases)===hubCode){
            fallbackRows.push({shipmentId:'—',date:r.d,reason:r.reason+(r.n>1?' ('+r.n+' đơn)':''),amount:r.amount,count:r.n});
          }
        });
        if(fallbackRows.length){lostList.push(...fallbackRows);lostComplete=true;}
      }
    }catch(_){}
  }
  
  // Fallback 2: BigQuery / Mock
  if(allowLost&&!supabaseLostComplete&&lostList.length===0){
    try{
      const bqSql='SELECT TO_JSON_STRING(t) FROM (SELECT shipment_id, d, amt, reason, station FROM '+flmTeamTable_('flm_lost_current')+' WHERE mapped AND d BETWEEN @from AND @closing AND '+flmTeamStationSql_('station')+' ORDER BY d DESC LIMIT 1000) t';
      const aliases=Object.keys(ctx.aliases).filter(alias=>ctx.aliases[alias]===hubCode);
      const params=ctx.params.map(p=>p.name==='stations'?Object.assign({},p,{parameterValue:{arrayValues:aliases.map(value=>({value:value}))}}):p);
      const bqRows=flmTeamQuery_(bqSql,Object.assign({},ctx,{params:params})),fallbackRows=[];
      bqRows.forEach(r=>{
        const code=flmLostHubCode_(r.station,ctx.aliases);
        const date=flmLostSheetDay_(r.d);
        if(code===hubCode&&date&&date>=ctx.from&&date<=ctx.closing){
          fallbackRows.push({shipmentId:r.shipment_id||'—',date:date,reason:r.reason||'Chưa ghi lý do',amount:r.amount??r.amt});
        }
      });
      lostList.push(...fallbackRows);
      lostComplete=true;
    }catch(_){}
  }
  if(allowLost&&!lostComplete)throw Error('LOST_UPSTREAM');
  
  if(urgentList.length===0&&alertList.length===0){
    try{
      const claimSql='SELECT TO_JSON_STRING(t) FROM (SELECT source, station, shipment_id, snapshot_date, group_aging, stage, cogs, high_value, feedback FROM '+flmTeamTable_('flm_claim_current')+' WHERE snapshot_date = @anchor AND '+flmTeamStationSql_('station')+' LIMIT 1000) t';
      const cRows=flmTeamQuery_(claimSql,ctx);
      cRows.forEach(r=>{
        const code=flmMatchHubCode_(r.station,masterMap);
        if(code===hubCode){
          const item={shipmentId:r.shipment_id||('SPX'+String(hubCode).replace(/\D/g,'')+(r.snapshot_date||'').replace(/-/g,'')),date:r.snapshot_date||ctx.anchor,aging:r.group_aging||'0-3 days',stage:r.stage||'UNKNOWN',cogs:r.cogs||0,highValue:!!r.high_value,feedback:r.feedback||'Chưa phản hồi'};
          if(r.source==='urgent')urgentList.push(item);
          else if(r.source==='alert')alertList.push(item);
        }
      });
    }catch(_){}
  }
  
  lostList.sort((a,b)=>(b.amount||0)-(a.amount||0)||(b.date||'').localeCompare(a.date||''));
  urgentList.sort((a,b)=>(b.cogs||0)-(a.cogs||0)||(b.date||'').localeCompare(a.date||''));
  alertList.sort((a,b)=>(b.cogs||0)-(a.cogs||0)||(b.date||'').localeCompare(a.date||''));
  
  const result={
    ok:true,
    hubCode:hubCode,
    hubName:stationName,
    asOf:ctx.anchor,
    closingDate:ctx.closing,
    lost:lostList,
    urgent:urgentList,
    alert:alertList
  };
  flmCachePut_(cacheKey,result,3600);
  return result;
}

function flmBenchmarkPing(){
  return { ok: true, timestamp: Date.now() };
}
