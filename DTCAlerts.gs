// Recorded DTC stays unchanged. Forecasts use explicit FC inputs and fixed capacity.
function dtcAlertRows_(rows,catalog){
  function key(v){return String(v||'').trim().toLowerCase().replace(/(?:\s+hub)+$/i,'').replace(/\s+/g,' ')}
  function number(v){return v===null||v===undefined||String(v).trim()===''||!isFinite(Number(v))?null:Number(v)}
  const byName={},byCode={};catalog.forEach(function(h){byName[key(h.name)]=h;byCode[key(h.code)]=h});
  let latest='';const matched=[];
  rows.forEach(function(r){const h=byCode[key(r.hub_code)]||byName[key(r.station_name)],date=String(r.report_date||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;latest=date>latest?date:latest;if(h)matched.push({row:r,hub:h,date:date})});
  const groups={};matched.forEach(function(item){const r=item.row,h=item.hub;
    if(!groups[h.code])groups[h.code]={code:h.code,name:h.name,zone:h.zone||'',aoms:h.aom||[],sups:h.sup||[],points:{}};
    const value=number(r.dtc_days),valid=String(r.status||'').toUpperCase()==='OK'&&value!==null&&value>=0;
    const p={date:item.date,value:valid?value:null,backlog:number(r.backlog_eod),average:number(r.delivered_14d_avg),kind:'actual',sourceStatus:String(r.status||''),validDays:number(r.valid_days),expectedDays:number(r.expected_days),computedAt:String(r.computed_at||''),windowStart:String(r.window_start||'').slice(0,10),windowEnd:String(r.window_end||'').slice(0,10)};
    const prior=groups[h.code].points[item.date];if(!prior||p.computedAt>=prior.computedAt)groups[h.code].points[item.date]=p;
  });
  return {source:'Backend · DTC',reportDate:latest,hubs:catalog.map(function(h){const g=groups[h.code]||{code:h.code,name:h.name,zone:h.zone||'',aoms:h.aom||[],sups:h.sup||[],points:{}},series=Object.keys(g.points).sort().slice(-30).map(function(d){return g.points[d]}),current=g.points[latest]||null,previous=series.filter(function(p){return p.date<latest&&p.value!==null}).pop()||null;delete g.points;g.series=series;g.current=current;g.today=current?current.value:null;g.yesterday=previous?previous.value:null;g.previousDate=previous?previous.date:'';g.risk=g.today===null?-1:g.today;g.status=g.today===null?'unknown':g.today>1?'overloaded':g.today>=0.5?'watch':'normal';return g})};
}
function getDtcAlerts(forceRefresh){
  const access=requireAccess_(['alerts']);if(access.rank==='NORMAL')throw Error('ACCESS_DENIED');
  const id=PropertiesService.getScriptProperties().getProperty('D0_DB_SHEET_ID');if(!id)throw Error('D0_DB_SHEET_ID is not configured.');
  const db=SpreadsheetApp.openById(id);if(!db.getSheetByName('DTC'))throw Error('Backend sheet DTC was not found.');
  const force=allowHeavyForceRefresh_(access,'dtc-alerts',forceRefresh===true);
  const catalog=deployHubCatalog_(access,getPermissionModel_(false)),actual=dtcAlertRows_(deployReadRows_(db,'DTC',force),catalog),today=Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd');
  try{const source=dtcAlertReadFc_(db,force);return dtcAlertForecast_(actual,source.values,catalog,today,{source:'Backend · FC · #LM Forecast',checkedAt:source.checkedAt})}
  catch(err){return Object.assign({},actual,{forecast:{status:'ERROR',message:'LM Forecast could not be read. Check the FC sheet and its two header rows.',dates:[],today:today,source:'Backend · FC · #LM Forecast'},hubs:actual.hubs.map(h=>Object.assign({},h,{forecast:[]}))})}
}
function dtcAlertReadFc_(db,force){
  const props=PropertiesService.getScriptProperties(),id=props.getProperty('DTC_FC_SHEET_ID'),sheetName=props.getProperty('DTC_FC_SHEET_NAME')||'FC',source=id?SpreadsheetApp.openById(id):db,key='dtc-lm-fc-v1:'+source.getId()+':'+sheetName;
  if(!force)try{const cached=CacheService.getScriptCache().get(key);if(cached)return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(cached))).getDataAsString('UTF-8'))}catch(ignored){}
  const sheet=source.getSheetByName(sheetName);if(!sheet)throw Error('DTC_FC_SHEET_NOT_FOUND');const result={values:sheet.getDataRange().getValues().map(row=>row.map(v=>v instanceof Date?Utilities.formatDate(v,'Asia/Ho_Chi_Minh','yyyy-MM-dd'):v)),checkedAt:new Date().toISOString()};
  // Cache raw cells privately; catalog filtering happens on every authorized request.
  try{const value=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(result),'application/json')).getBytes());if(value.length<90000)CacheService.getScriptCache().put(key,value,300)}catch(ignored){}return result;
}
function dtcAlertFc_(values,catalog){
  if(!Array.isArray(values)||values.length<2)throw Error('DTC_FC_HEADERS_MISSING');
  function key(v){return String(v||'').trim().toLowerCase().replace(/(?:\s+hub)+$/i,'').replace(/\s+/g,' ')}
  function date(v){let s=v instanceof Date?Utilities.formatDate(v,'Asia/Ho_Chi_Minh','yyyy-MM-dd'):String(v||'').trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '';const d=new Date(s+'T00:00:00Z');return isFinite(+d)&&d.toISOString().slice(0,10)===s?s:''}
  function number(v){if(v==null||String(v).trim()==='')return null;const text=String(v).trim();if(typeof v!=='number'&&!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text))return null;const n=typeof v==='number'?v:Number(text.replace(/,/g,''));return isFinite(n)&&n>=0?n:null}
  const aliases={},ambiguous=new Set();catalog.forEach(h=>[h.code,h.name].forEach(v=>{const k=key(v);if(aliases[k]&&aliases[k]!==h.code)ambiguous.add(k);else aliases[k]=h.code}));
  let current='';const columns=[],seen=new Set();values[0].forEach((v,i)=>{const d=date(v);if(d)current=d;if(String(values[1][i]||'').replace(/\s+/g,'').toLowerCase()==='#lmforecast'){if(!current||seen.has(current))throw Error('DTC_FC_DATE_HEADERS_INVALID');seen.add(current);columns.push({index:i,date:current})}});if(!columns.length)throw Error('DTC_LM_FORECAST_COLUMN_MISSING');
  const byHub={},duplicates=new Set();values.slice(2).forEach(row=>{const k=key(row[0]),code=!ambiguous.has(k)&&aliases[k];if(!code)return;const hub=byHub[code]||(byHub[code]={});columns.forEach(c=>{const id=code+'|'+c.date;if(Object.prototype.hasOwnProperty.call(hub,c.date)){duplicates.add(id);hub[c.date]=null}else hub[c.date]=number(row[c.index])})});
  return {dates:columns.map(c=>c.date).sort(),byHub:byHub,duplicateValues:duplicates.size};
}
function dtcAlertForecast_(actual,values,catalog,today,metadata){
  const fc=dtcAlertFc_(values,catalog),shift=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),baseline=actual.reportDate,last=fc.dates.slice(-1)[0],dates=fc.dates.filter(d=>d>=today&&d>baseline),mapped=catalog.filter(h=>fc.byHub[h.code]).length;
  const forecast=Object.assign({status:dates.length?'OK':'NO_FUTURE_DATES',dates:dates,today:today,baselineDate:baseline,to:last,matchedHubs:mapped,expectedHubs:catalog.length,method:'ROLLING_EOD',formula:'Projected EOD backlog = max(previous backlog + LM Forecast − fixed 14-day average deliveries, 0). Projected DTC = projected EOD backlog / fixed capacity.',capacityAssumption:'Delivery capacity stays at the latest valid 14-day average. No extra staffing or capacity increase is assumed.'},metadata||{});
  const hubs=actual.hubs.map(h=>{
    const c=h.current||{},capacity=c.average,valid=c.sourceStatus==='OK'&&c.value!=null&&typeof c.backlog==='number'&&c.backlog>=0&&typeof capacity==='number'&&capacity>0,points=[],inputs=fc.byHub[h.code]||{};let backlog=valid?c.backlog:null,missingDate='',previousDtc=valid?c.value:null;
    if(!baseline||last<=baseline)return Object.assign({},h,{forecast:points});
    // Include every intervening day from the actual EOD; never skip missing FC.
    for(let day=shift(baseline,1),count=0;day<=last&&count<370;day=shift(day,1),count++){
      const qty=Object.prototype.hasOwnProperty.call(inputs,day)?inputs[day]:null,start=backlog;let status=!valid?'BASELINE_UNAVAILABLE':missingDate?'MISSING_PRIOR_FORECAST':qty==null?'FORECAST_MISSING':'OK';
      if(valid&&!missingDate&&qty==null)missingDate=day;backlog=status==='OK'?Math.max(0,start+qty-capacity):null;const value=backlog==null?null:backlog/capacity;
      points.push({date:day,kind:'forecast',value:value,backlog:backlog,startBacklog:start,lmForecast:qty,average:valid?capacity:null,previousDtc:previousDtc,baselineDate:baseline,baselineBacklog:c.backlog==null?null:c.backlog,sourceStatus:status,missingDate:missingDate,validDays:c.validDays,expectedDays:c.expectedDays});previousDtc=value;
    }return Object.assign({},h,{forecast:points});
  });return Object.assign({},actual,{hubs:hubs,forecast:forecast});
}
