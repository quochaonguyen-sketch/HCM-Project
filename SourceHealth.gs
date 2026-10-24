/** Read-only, uncached source freshness checks. ACTIVE describes data freshness,
 * not proof that an upstream job or trigger is running. */
function getSourceHealth() {
  requireAdmin_();
  const now=new Date(),books={},props=PropertiesService.getScriptProperties();
  const specs=[
    {name:'Permission',book:'app',kind:'config'},
    {name:'KPI Result',book:'app',kind:'daily',dates:['As Of']},
    {name:'kpis daily archive',fallback:'KPI Daily',book:'daily',kind:'daily',dates:['KPI Date','Date','Ngày','date_iso']},
    ...['FM vol','LM vol','Correct SOP vol','Deli success vol'].map(name=>({name:name,book:'daily',kind:'daily',dates:['Date']})),
    ...['Rider Prod','sort prod 2'].map(name=>({name:name,book:'daily',kind:'daily',wide:true,dates:['Date']})),
    ...['FM Order Volume D0','LM Backlog D0','LM Order Volume D0','Delivery Progress D0','Roster D0','Roster Shifts D0','Backlog D0','FM Pending Pickup Backlog D0'].map(name=>({name:name,book:'d0',kind:'live',dates:['fetched_at']})),
    {name:'Backlog EOD',book:'d0',kind:'eod',dates:['snapshot_date']},
    {name:'DTC',book:'d0',kind:'daily',dtc:true,dates:['window_end']}
  ];
  function book(key){
    if(!books[key]){
      try{
        let id;
        if(key==='app')books[key]={db:getDb_()};
        else if(key==='daily')books[key]={db:kpiDailyDirectDatabase_()};
        else {id=props.getProperty('D0_DB_SHEET_ID');if(!id)throw Error('Chưa cấu hình D0_DB_SHEET_ID.');books[key]={db:SpreadsheetApp.openById(id)}}
      }catch(err){books[key]={error:String(err.message||err)}}
    }
    if(books[key].error)throw Error(books[key].error);
    return books[key].db;
  }
  const sources=specs.map(spec=>{
    const module=['KPI Result','kpis daily archive'].indexOf(spec.name)>=0?'KPI':spec.name==='DTC'?'DTC':spec.kind==='live'?'D0':'';
    const base={name:spec.name,module:module,group:spec.book,kind:spec.kind,status:'ERROR',expected:spec.kind==='live'?'Cùng ngày · tối đa 120 phút':spec.kind==='config'?'Có dữ liệu cấu hình':'Đủ dữ liệu đến D−1',url:''};
    try{
      const db=book(spec.book);let sheet=db.getSheetByName(spec.name);
      if(!sheet&&spec.fallback)sheet=db.getSheetByName(spec.fallback);
      base.url='https://docs.google.com/spreadsheets/d/'+encodeURIComponent(db.getId())+'/edit'+(sheet?'#gid='+sheet.getSheetId():'');
      if(!sheet)return Object.assign(base,{status:'MISSING',reason:'Không tìm thấy sheet. Kiểm tra tên sheet và ID nguồn.'});
      base.actualSheet=sheet.getName();
      const values=sheet.getDataRange().getValues();
      return Object.assign(base,sourceHealthAssess_(spec.wide?sourceHealthWide_(values):values,spec,now));
    }catch(err){return Object.assign(base,{status:'ERROR',reason:String(err.message||err)})}
  });
  const order={ERROR:0,MISSING:1,EMPTY:2,INACTIVE:3,UNKNOWN:4,ACTIVE:5,CONFIGURED:6};
  sources.sort((a,b)=>order[a.status]-order[b.status]||a.name.localeCompare(b.name));
  return {checkedAt:now.toISOString(),today:sourceHealthDay_(now),timezone:'Asia/Ho_Chi_Minh',modules:sourceHealthSummaries_(sources,now),sources:sources,attention:sources.filter(s=>s.status!=='ACTIVE'&&s.status!=='CONFIGURED').length};
}
function sourceHealthSummaries_(sources,now){
  const today=sourceHealthDay_(now),definitions=[{key:'KPI',expectedLagDays:1,expectedSources:2},{key:'D0',expectedLagDays:0,expectedSources:8},{key:'DTC',expectedLagDays:1,expectedSources:1}];
  return definitions.map(def=>{
    const rows=sources.filter(s=>s.module===def.key),dates=rows.map(s=>s.latestDate).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''))).sort();
    const date=dates[0]||null,lag=date?Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000):null;
    const unknown=Math.max(0,def.expectedSources-dates.length),issues=rows.filter(s=>s.status!=='ACTIVE').length;
    return {key:def.key,expectedLagDays:def.expectedLagDays,date:date,lagDays:lag,state:!dates.length?'unknown':unknown||issues||lag>def.expectedLagDays||lag<0?'warning':'fresh',unknownSources:unknown,issues:issues,sourceNames:rows.map(s=>s.name),details:rows.map(s=>({name:s.name,date:s.latestDate||null,status:s.status,reason:s.reason||''}))};
  });
}
function sourceHealthWide_(values){
  const output=[['Station Name','Date','%Value']];
  let dateRow=-1,columns=[];
  for(let i=0;i<Math.min(20,values.length);i++){
    const dates=values[i].map((v,j)=>j>0&&isFinite(sourceHealthStamp_(v))?j:-1).filter(j=>j>0);
    if(dates.length){dateRow=i;columns=dates;break}
  }
  if(dateRow<0)return [['Station Name','Missing date header'],['','Unknown']];
  // Compact to the latest populated date per HUB; do not expand wide sheets.
  for(let i=dateRow+1;i<values.length;i++){
    const row=values[i];if(!String(row[0]||'').trim())continue;
    let latest=null;
    columns.forEach(j=>{
      const val=row[j],stamp=sourceHealthStamp_(values[dateRow][j]);
      if(val!==''&&val!=null&&isFinite(Number(String(val).replace(/[, %]/g,'')))&&(!latest||stamp>latest.stamp))latest={stamp:stamp,date:values[dateRow][j],value:val};
    });
    if(latest)output.push([row[0],latest.date,latest.value]);
  }
  return output;
}
function sourceHealthDay_(date){return Utilities.formatDate(date,'Asia/Ho_Chi_Minh','yyyy-MM-dd')}
function sourceHealthStamp_(value){
  if(value instanceof Date)return isFinite(+value)?+value:NaN;
  const s=String(value==null?'':value).trim();if(!s)return NaN;
  let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
  const text=m?m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2)+m[4]:s;
  if(!/^\d{4}-\d{2}-\d{2}(?:$|[ T])/.test(text))return NaN;
  const day=Date.parse(text.slice(0,10)+'T00:00:00Z');if(!isFinite(day)||new Date(day).toISOString().slice(0,10)!==text.slice(0,10))return NaN;
  return Date.parse(text.replace(' ','T')+(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)?'':text.length===10?'T00:00:00+07:00':'+07:00'));
}
function sourceHealthAssess_(values,spec,now){
  const norm=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9%]/g,''),headers=(values[0]||[]).map(norm);
  let rows=values.slice(1).filter(r=>r.some(v=>v!==''&&v!=null));
  if(!rows.length)return {status:'EMPTY',rows:0,reason:'Sheet chưa có dữ liệu.'};
  if(spec.kind==='config')return {status:'CONFIGURED',rows:rows.length,reason:'Có cấu hình. Không có lịch cập nhật để đánh giá active/inactive.'};
  let idx=-1;(spec.dates||[]).some(k=>{idx=headers.indexOf(norm(k));return idx>=0});
  if(idx<0)return {status:'UNKNOWN',rows:rows.length,reason:'Thiếu cột '+spec.dates.join(' / ')+'. Không thể xác định độ mới.'};
  if(spec.dtc&&['dtcdays','status'].some(k=>headers.indexOf(k)<0))return {status:'UNKNOWN',rows:rows.length,reason:'DTC thiếu cột dtc_days / status. Không thể xác định dữ liệu đang hiển thị.'};
  if(spec.dtc&&headers.indexOf('reportdate')>=0){
    // The DTC page displays the latest report batch. Historical failed runs
    // must not flag a newer successful report. Its lag still uses input dates.
    const reportIndex=headers.indexOf('reportdate'),reports=rows.map(r=>sourceHealthStamp_(r[reportIndex])).filter(isFinite);
    if(reports.length){const latestReport=reports.reduce((a,b)=>Math.max(a,b),-Infinity);rows=rows.filter(r=>sourceHealthStamp_(r[reportIndex])===latestReport)}
  }
  let hub=headers.indexOf('stationname');if(hub<0)hub=headers.indexOf('hubcode');if(hub<0)hub=headers.indexOf('stationid');
  const groups={},today=sourceHealthDay_(now),expected=sourceHealthDay_(new Date(+now-86400000));
  const metrics=headers.map((h,i)=>h.indexOf('%')===0?i:-1).filter(i=>i>=0);
  let invalid=0,future=0;
  rows.forEach((row,i)=>{
    // An appended date on an otherwise empty KPI row is not fresh data.
    if(spec.kind==='daily'&&metrics.length&&!metrics.some(j=>row[j]!==''&&row[j]!=null&&isFinite(Number(String(row[j]).replace(/[% ,]/g,'')))))return;
    let stamp=sourceHealthStamp_(row[idx]);
    if(spec.dtc){
      const value=row[headers.indexOf('dtcdays')];
      if(String(row[headers.indexOf('status')]).toUpperCase()!=='OK'||value==null||value===''||!isFinite(Number(value))||Number(value)<0){invalid++;return}
      // DTC may be recomputed today from an older delivery window/backlog.
      // Use the older actual input day; never report computed_at as data freshness.
      const backlogIndex=headers.indexOf('backlogfetchedat'),backlogStamp=backlogIndex>=0?sourceHealthStamp_(row[backlogIndex]):NaN;
      if(isFinite(backlogStamp))stamp=Math.min(stamp,sourceHealthStamp_(sourceHealthDay_(new Date(backlogStamp))));
    }
    if(!isFinite(stamp)){invalid++;return}
    if(stamp>+now+300000){future++;return}
    const key=hub>=0?String(row[hub]||'row:'+i):'source';
    if(!groups[key]||groups[key].stamp<stamp)groups[key]={stamp:stamp,row:row,hub:key};
  });
  const items=Object.keys(groups).map(k=>groups[k]);
  if(!items.length)return {status:'ERROR',rows:rows.length,reason:future?'Ngày cập nhật nằm trong tương lai.':'Không có ngày cập nhật hợp lệ.'};
  const latest=Math.max.apply(null,items.map(v=>v.stamp));
  const lateItems=items.filter(v=>spec.kind==='live'?(sourceHealthDay_(new Date(v.stamp))!==today||(+now-v.stamp)/60000>120):sourceHealthDay_(new Date(v.stamp))<expected);
  let late=lateItems.length;
  const statusIdx=headers.indexOf('sourcestatus');
  const staleEod=spec.kind==='eod'&&statusIdx>=0?items.filter(v=>String(v.row[statusIdx]).indexOf('STALE')>=0).length:0;
  const problems=late+invalid+future+staleEod;
  return {status:problems?'INACTIVE':'ACTIVE',rows:rows.length,checkedHubs:hub>=0?items.length:null,lateHubs:late,lateHubNames:hub>=0?lateItems.map(v=>v.hub):[],invalidRows:invalid,futureRows:future,staleEodHubs:staleEod,latestAt:new Date(latest).toISOString(),latestDate:sourceHealthDay_(new Date(latest)),ageMinutes:Math.max(0,Math.floor((+now-latest)/60000)),expectedDate:spec.kind==='live'?today:expected,
    reason:problems?[late?late+' HUB/nhóm chưa đạt tiến độ':'',invalid?invalid+' dòng thiếu/sai ngày':'',future?future+' dòng có ngày tương lai':'',staleEod?staleEod+' HUB EOD dùng nguồn đã quá hạn':''].filter(Boolean).join(' · '):'Dữ liệu đạt tiến độ quy định trong các HUB/nhóm có mặt ở nguồn.'};
}
