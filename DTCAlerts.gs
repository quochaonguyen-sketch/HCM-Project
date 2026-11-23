// Recorded DTC stays unchanged. Forecasts use explicit FC inputs and fixed capacity.
function dtcAlertRows_(rows,catalog){
  function key(v){return String(v||'').trim().toLowerCase().replace(/(?:\s+hub)+$/i,'').replace(/\s+/g,' ')}
  function number(v){return v===null||v===undefined||String(v).trim()===''||!isFinite(Number(v))?null:Number(v)}
  const byName={},byCode={};catalog.forEach(function(h){byName[key(h.name)]=h;byCode[key(h.code)]=h});
  let latest='';const matched=[];
  rows.forEach(function(r){
    const h=byCode[key(r.hub_code)]||byName[key(r.station_name)];
    let date='';
    if(r.report_date instanceof Date)date=Utilities.formatDate(r.report_date,'Asia/Ho_Chi_Minh','yyyy-MM-dd');
    else if(typeof r.report_date==='number'&&r.report_date>30000&&r.report_date<60000){
      date=Utilities.formatDate(new Date(Math.round((r.report_date-25569)*86400*1000)),'Asia/Ho_Chi_Minh','yyyy-MM-dd');
    }else{
      const s=String(r.report_date||'').trim();
      if(/^\d{4}-\d{2}-\d{2}/.test(s))date=s.slice(0,10);
      else{
        const m=/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(s);
        if(m)date=m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
      }
    }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
    latest=date>latest?date:latest;
    if(h)matched.push({row:r,hub:h,date:date});
  });
  const groups={};matched.forEach(function(item){const r=item.row,h=item.hub;
    if(!groups[h.code])groups[h.code]={code:h.code,name:h.name,zone:h.zone||'',aoms:h.aom||[],sups:h.sup||[],points:{}};
    const value=number(r.dtc_days),valid=String(r.status||'').toUpperCase()==='OK'&&value!==null&&value>=0;
    const p={date:item.date,value:valid?value:null,backlog:number(r.backlog_eod),average:number(r.delivered_14d_avg),kind:'actual',sourceStatus:String(r.status||''),validDays:number(r.valid_days),expectedDays:number(r.expected_days),computedAt:String(r.computed_at||''),windowStart:String(r.window_start||'').slice(0,10),windowEnd:String(r.window_end||'').slice(0,10)};
    const prior=groups[h.code].points[item.date];if(!prior||p.computedAt>=prior.computedAt)groups[h.code].points[item.date]=p;
  });
  return {source:'Backend · DTC',reportDate:latest,hubs:catalog.map(function(h){const g=groups[h.code]||{code:h.code,name:h.name,zone:h.zone||'',aoms:h.aom||[],sups:h.sup||[],points:{}},series=Object.keys(g.points).sort().slice(-30).map(function(d){return g.points[d]}),current=g.points[latest]||null,previous=series.filter(function(p){return p.date<latest&&p.value!==null}).pop()||null;delete g.points;g.series=series;g.current=current;g.today=current?current.value:null;g.yesterday=previous?previous.value:null;g.previousDate=previous?previous.date:'';g.risk=g.today===null?-1:g.today;g.status=g.today===null?'unknown':g.today>1?'overloaded':g.today>=0.5?'watch':'normal';return g})};
}
function getDtcAlertDb_(){
  const props=PropertiesService.getScriptProperties();
  const ids=[props.getProperty('D0_DB_SHEET_ID'),props.getProperty('APP_DB_SHEET_ID')].filter(Boolean);
  if(!ids.length)throw Error('D0_DB_SHEET_ID / APP_DB_SHEET_ID is not configured.');
  for(let i=0;i<ids.length;i++){
    try{
      const db=SpreadsheetApp.openById(ids[i]);
      const sheet=db.getSheetByName('DTC D0')||db.getSheetByName('DTC')||db.getSheetByName('D0');
      if(sheet&&sheet.getLastRow()>1)return {db:db,sheetName:sheet.getName()};
    }catch(_){}
  }
  throw Error('Backend sheet DTC D0 / DTC was not found in D0 or App database.');
}
function getDtcAlerts(forceRefresh){
  const access=requireAccess_(['alerts']);if(access.rank==='NORMAL')throw Error('ACCESS_DENIED');
  const target=getDtcAlertDb_(),db=target.db,sheetName=target.sheetName;
  const force=allowHeavyForceRefresh_(access,'dtc-alerts',forceRefresh===true);
  const catalog=deployHubCatalog_(access,getPermissionModel_(false)),actual=dtcAlertRows_(deployReadRows_(db,sheetName,force),catalog),today=Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd');
  try{const source=dtcAlertReadFc_(db,force);return dtcAlertForecast_(actual,source.values,catalog,today,{source:'Backend · FC · #LM Forecast',checkedAt:source.checkedAt})}
  catch(err){return Object.assign({},actual,{forecast:{status:'ERROR',message:'LM Forecast could not be read. Check the FC sheet and its two header rows.',dates:[],today:today,source:'Backend · FC · #LM Forecast'},hubs:actual.hubs.map(h=>Object.assign({},h,{forecast:[]}))})}
}
function dtcFcSheetSortKey_(name){
  const m=String(name||'').match(/(?:T|M|\b)\s*(\d{1,2})(?:[\/\-_](\d{2,4})|(\d{2}))/i);
  if(m){
    let month=Number(m[1]),year=Number(m[2]||m[3]);
    if(year<100)year+=2000;
    return year*100+month;
  }
  return 0;
}
function dtcFindFcSheets_(source){
  if(!source)return [];
  const allSheets=typeof source.getSheets==='function'?source.getSheets():[];
  const fcRegex=/^FC(?:$|[\s_\-\/])/i;
  const matching=allSheets.filter(sh=>fcRegex.test(sh.getName().trim()));
  if(matching.length){
    // If versioned monthly sheets (FC T... or FC ...) are present, skip static unversioned 'FC'
    const versioned=matching.filter(sh=>dtcFcSheetSortKey_(sh.getName())>0);
    const pool=versioned.length?versioned:matching;
    return pool.sort((a,b)=>dtcFcSheetSortKey_(a.getName())-dtcFcSheetSortKey_(b.getName()));
  }
  const props=typeof PropertiesService!=='undefined'?PropertiesService.getScriptProperties():null;
  const customName=props&&props.getProperty('DTC_FC_SHEET_NAME');
  if(customName&&typeof source.getSheetByName==='function'){
    const sh=source.getSheetByName(customName);
    if(sh)return [sh];
  }
  if(typeof source.getSheetByName==='function'){
    const def=source.getSheetByName('FC');
    if(def)return [def];
  }
  return [];
}
function dtcMergeFcSheets_(sheetsData){
  if(!sheetsData||!sheetsData.length)return [];
  if(sheetsData.length===1)return sheetsData[0];

  function parseD(v){
    if(!v)return '';
    if(v instanceof Date)return Utilities.formatDate(v,'Asia/Ho_Chi_Minh','yyyy-MM-dd');
    if(typeof v==='object'&&v&&v.$date)return String(v.$date).slice(0,10);
    if(typeof v==='number'&&v>30000&&v<60000){
      return Utilities.formatDate(new Date(Math.round((v-25569)*86400*1000)),'Asia/Ho_Chi_Minh','yyyy-MM-dd');
    }
    const s=String(v).trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
    const m=/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(s);
    if(m)return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
    return '';
  }
  function normK(v){
    return String(v||'').trim().toLowerCase().replace(/(?:\s+hub)+$/i,'').replace(/\s+/g,' ');
  }

  const dateCols=[];
  const seenDatesWithLeg=new Set();
  const hubNamesMap=new Map();
  const hubDataBySheet=[];

  sheetsData.forEach((rows,sIdx)=>{
    if(!rows||rows.length<2)return;
    const row0=rows[0],row1=rows[1];
    let currentDate='';
    for(let c=0;c<row0.length;c++){
      const d=parseD(row0[c]);
      if(d)currentDate=d;
      if(!currentDate)continue;
      const header=String(row1[c]||'').replace(/[\s#_]/g,'').toLowerCase();
      const isLm=header==='lmforecast'||header==='forecastlm';
      const isFm=header==='fmforecast'||header==='forecastfm';
      if(!isLm&&!isFm)continue;
      const leg=isLm?'#LM Forecast':'#FM Forecast';
      const uKey=currentDate+'|'+leg;
      if(!seenDatesWithLeg.has(uKey)){
        seenDatesWithLeg.add(uKey);
        dateCols.push({date:currentDate,leg:leg,isLm:isLm,sheetIdx:sIdx,colIdx:c});
      }
    }
    const hubMap=new Map();
    for(let r=2;r<rows.length;r++){
      const name=String(rows[r][0]||'').trim();
      if(!name)continue;
      const k=normK(name);
      if(!hubNamesMap.has(k))hubNamesMap.set(k,name);
      hubMap.set(k,rows[r]);
    }
    hubDataBySheet[sIdx]=hubMap;
  });

  dateCols.sort((a,b)=>{
    if(a.date!==b.date)return a.date<b.date?-1:1;
    return a.isLm?1:-1;
  });

  const headerRow0=['Hub Name'],headerRow1=[''];
  dateCols.forEach(col=>{
    headerRow0.push(col.date);
    headerRow1.push(col.leg);
  });

  const mergedRows=[headerRow0,headerRow1];
  const sortedKeys=Array.from(hubNamesMap.keys()).sort();

  sortedKeys.forEach(k=>{
    const displayName=hubNamesMap.get(k);
    const row=[displayName];
    dateCols.forEach(col=>{
      const sMap=hubDataBySheet[col.sheetIdx];
      const sourceRow=sMap?sMap.get(k):null;
      const val=sourceRow?sourceRow[col.colIdx]:null;
      row.push(val!=null&&val!==''?val:0);
    });
    mergedRows.push(row);
  });

  return mergedRows;
}
function dtcAlertReadFcFromSupabase_(props,force){
  const url=String(props.getProperty('D0_SUPABASE_URL')||props.getProperty('SUPABASE_URL')||'').trim().replace(/\/$/,'');
  const key=String(props.getProperty('D0_SUPABASE_SECRET_KEY')||props.getProperty('SUPABASE_LOST_SECRET_KEY')||props.getProperty('SUPABASE_KEY')||'').trim();
  if(!url||!key)return null;
  const cacheKey='dtc-fc-supabase-v1';
  if(!force)try{
    const cached=CacheService.getScriptCache().get(cacheKey);
    if(cached)return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(cached))).getDataAsString('UTF-8'));
  }catch(_){}

  try{
    let rows=[],offset=0;
    while(true){
      const res=UrlFetchApp.fetch(url+'/rest/v1/forecast_daily?select=plan_date,hub_name,hub_code,fm_forecast,lm_forecast&order=plan_date.desc,hub_name.asc&limit=1000&offset='+offset,{
        method:'get',
        headers:{apikey:key,Authorization:'Bearer '+key},
        muteHttpExceptions:true
      });
      if(res.getResponseCode()!==200)break;
      const batch=JSON.parse(res.getContentText());
      if(!Array.isArray(batch)||!batch.length)break;
      rows.push(...batch);
      if(batch.length<1000)break;
      offset+=1000;
    }
    if(!rows.length)return null;

    const dateSet=new Set();
    const byHub=new Map();
    rows.forEach(function(r){
      const d=String(r.plan_date||'').slice(0,10);
      if(d)dateSet.add(d);
      const name=String(r.hub_name||r.hub_code||'').trim();
      if(!name)return;
      if(!byHub.has(name))byHub.set(name,new Map());
      byHub.get(name).set(d,{fm:Number(r.fm_forecast)||0,lm:Number(r.lm_forecast)||0});
    });

    const dates=Array.from(dateSet).sort().reverse();
    if(!dates.length)return null;

    const row0=['Hub Name'];
    const row1=[''];
    dates.forEach(function(d){
      row0.push(d,'');
      row1.push('#FM Forecast','#LM Forecast');
    });

    const matrix=[row0,row1];
    byHub.forEach(function(data,hubName){
      const hubRow=[hubName];
      dates.forEach(function(d){
        const val=data.get(d)||{fm:0,lm:0};
        hubRow.push(val.fm,val.lm);
      });
      matrix.push(hubRow);
    });

    const result={values:matrix,sheetNames:['Supabase:forecast_daily'],checkedAt:new Date().toISOString()};
    try{
      const val=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(result),'application/json')).getBytes());
      if(val.length<90000)CacheService.getScriptCache().put(cacheKey,val,300);
    }catch(_){}
    return result;
  }catch(_){
    return null;
  }
}

function dtcAlertReadFc_(db,force){
  const props=PropertiesService.getScriptProperties();
  try{
    const supa=dtcAlertReadFcFromSupabase_(props,force);
    if(supa&&supa.values&&supa.values.length>2)return supa;
  }catch(_){}

  const customId=props.getProperty('DTC_FC_SHEET_ID');
  const appId=props.getProperty('APP_DB_SHEET_ID');
  const d0Id=props.getProperty('D0_DB_SHEET_ID');
  const candidateIds=[customId,appId,d0Id].filter(Boolean);

  let source=null,sheets=[];
  if(customId){
    try{
      const candidate=SpreadsheetApp.openById(customId);
      const found=dtcFindFcSheets_(candidate);
      if(found.length){source=candidate;sheets=found;}
    }catch(_){}
  }

  if(!sheets.length){
    let bestSource=null,bestSheets=[],bestMaxKey=-1;
    const pool=candidateIds.slice();
    if(db)pool.push(db);
    pool.forEach(item=>{
      try{
        const candidate=typeof item==='string'?SpreadsheetApp.openById(item):item;
        if(!candidate)return;
        const found=dtcFindFcSheets_(candidate);
        if(!found.length)return;
        const maxKey=Math.max(...found.map(s=>dtcFcSheetSortKey_(s.getName())));
        if(maxKey>bestMaxKey||(maxKey===bestMaxKey&&found.length>bestSheets.length)){
          bestMaxKey=maxKey;
          bestSheets=found;
          bestSource=candidate;
        }
      }catch(_){}
    });
    if(bestSheets.length){
      source=bestSource;
      sheets=bestSheets;
    }
  }

  if(!sheets.length)throw Error('DTC_FC_SHEET_NOT_FOUND');

  const sheetNames=sheets.map(s=>s.getName());
  const key='dtc-lm-fc-v2:'+(source?source.getId():'db')+':'+sheetNames.join('+');
  if(!force)try{
    const cached=CacheService.getScriptCache().get(key);
    if(cached)return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(cached))).getDataAsString('UTF-8'));
  }catch(ignored){}

  const sheetsData=sheets.map(sh=>{
    return sh.getDataRange().getValues().map(row=>row.map(v=>{
      if(v instanceof Date)return Utilities.formatDate(v,'Asia/Ho_Chi_Minh','yyyy-MM-dd');
      return v;
    }));
  });

  const mergedValues=dtcMergeFcSheets_(sheetsData);
  const result={values:mergedValues,sheetNames:sheetNames,checkedAt:new Date().toISOString()};

  try{
    const value=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(result),'application/json')).getBytes());
    if(value.length<90000)CacheService.getScriptCache().put(key,value,300);
  }catch(ignored){}
  return result;
}
function dtcAlertFc_(values,catalog){
  if(!Array.isArray(values)||values.length<2)throw Error('DTC_FC_HEADERS_MISSING');
  function key(v){return String(v||'').trim().toLowerCase().replace(/(?:\s+hub)+$/i,'').replace(/\s+/g,' ')}
  function date(v){
    if(!v)return '';
    if(v instanceof Date)return Utilities.formatDate(v,'Asia/Ho_Chi_Minh','yyyy-MM-dd');
    if(typeof v==='object'&&v&&v.$date)return String(v.$date).slice(0,10);
    if(typeof v==='number'&&v>30000&&v<60000){
      return Utilities.formatDate(new Date(Math.round((v-25569)*86400*1000)),'Asia/Ho_Chi_Minh','yyyy-MM-dd');
    }
    let s=String(v||'').trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s.slice(0,10);
    const m=/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(s);
    if(m)return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
    const d=new Date(s+'T00:00:00Z');
    return isFinite(+d)&&d.toISOString().slice(0,10)===s?s:'';
  }
  function number(v){if(v==null||String(v).trim()==='')return null;const text=String(v).trim();if(typeof v!=='number'&&!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text))return null;const n=typeof v==='number'?v:Number(text.replace(/,/g,''));return isFinite(n)&&n>=0?n:null}
  const aliases={},ambiguous=new Set();catalog.forEach(h=>[h.code,h.name].forEach(v=>{const k=key(v);if(aliases[k]&&aliases[k]!==h.code)ambiguous.add(k);else aliases[k]=h.code}));
  let current='';const columns=[],seen=new Set();
  values[0].forEach((v,i)=>{
    const d=date(v);
    if(d)current=d;
    const tag=String(values[1][i]||'').replace(/[\s#_]/g,'').toLowerCase();
    if(tag==='lmforecast'||tag==='forecastlm'){
      if(!current||seen.has(current))throw Error('DTC_FC_DATE_HEADERS_INVALID');
      seen.add(current);
      columns.push({index:i,date:current});
    }
  });
  if(!columns.length)throw Error('DTC_LM_FORECAST_COLUMN_MISSING');
  const byHub={},duplicates=new Set();
  values.slice(2).forEach(row=>{
    const k=key(row[0]),code=!ambiguous.has(k)&&aliases[k];
    if(!code)return;
    const hub=byHub[code]||(byHub[code]={});
    columns.forEach(c=>{
      const id=code+'|'+c.date;
      const num=number(row[c.index]);
      if(Object.prototype.hasOwnProperty.call(hub,c.date)){
        if(hub[c.date]!==num&&hub[c.date]!==null&&num!==null){
          duplicates.add(id);
          hub[c.date]=null;
        }else if(hub[c.date]===null&&num!==null){
          hub[c.date]=num;
        }
      }else{
        hub[c.date]=num;
      }
    });
  });
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

function dtcExtractTodayForecast_(fcValues, catalog, targetDate) {
  if (!fcValues || fcValues.length < 2) return null;
  const row0 = fcValues[0], row1 = fcValues[1];
  function parseD(v) {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
    if (typeof v === 'object' && v && v.$date) return String(v.$date).slice(0, 10);
    if (typeof v === 'number' && v > 30000 && v < 60000) {
      return Utilities.formatDate(new Date(Math.round((v - 25569) * 86400 * 1000)), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
    }
    let s = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 10);
    const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(s);
    if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    return '';
  }

  let foundDate = '', fmCol = -1, lmCol = -1, curDate = '', latestDate = '';
  for (let c = 1; c < row0.length; c++) {
    const d = parseD(row0[c]);
    if (d) { curDate = d; if (!latestDate || d > latestDate) latestDate = d; }
    if (curDate && curDate === targetDate) {
      foundDate = curDate;
      const tag = String(row1[c] || '').replace(/[\s#_]/g, '').toLowerCase();
      if (tag === 'fmforecast' || tag === 'forecastfm') fmCol = c;
      if (tag === 'lmforecast' || tag === 'forecastlm') lmCol = c;
    }
  }

  if (!foundDate && latestDate) {
    foundDate = latestDate;
    curDate = '';
    for (let c = 1; c < row0.length; c++) {
      const d = parseD(row0[c]);
      if (d) curDate = d;
      if (curDate === foundDate) {
        const tag = String(row1[c] || '').replace(/[\s#_]/g, '').toLowerCase();
        if (tag === 'fmforecast' || tag === 'forecastfm') fmCol = c;
        if (tag === 'lmforecast' || tag === 'forecastlm') lmCol = c;
      }
    }
  }

  function key(v) { return String(v || '').trim().toLowerCase().replace(/(?:\s+hub)+$/i, '').replace(/\s+/g, ' '); }
  const aliases = {};
  const byHub = {};
  (catalog || []).forEach(h => {
    aliases[key(h.code)] = h.code;
    aliases[key(h.name)] = h.code;
    byHub[h.code] = { fm: 0, lm: 0 };
  });
  let totalFm = 0, totalLm = 0, matched = 0;
  for (let r = 2; r < fcValues.length; r++) {
    const k = key(fcValues[r][0]);
    const code = aliases[k];
    if (!code) continue;
    matched++;
    const fm = fmCol >= 0 && typeof fcValues[r][fmCol] === 'number' ? fcValues[r][fmCol] : Number(String(fcValues[r][fmCol] || '').replace(/,/g, '')) || 0;
    const lm = lmCol >= 0 && typeof fcValues[r][lmCol] === 'number' ? fcValues[r][lmCol] : Number(String(fcValues[r][lmCol] || '').replace(/,/g, '')) || 0;
    byHub[code] = { fm: fm, lm: lm };
    totalFm += fm;
    totalLm += lm;
  }

  return {
    date: foundDate,
    targetDate: targetDate,
    fmForecast: totalFm,
    lmForecast: totalLm,
    matchedHubs: matched,
    totalHubs: (catalog || []).length,
    byHub: byHub
  };
}
