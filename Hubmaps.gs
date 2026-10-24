// Read the live frontend workbook only. Check access before opening the sheet.
function getHubMap() {
 const access=requireAccess_();if(access.rank==='NORMAL')throw Error('ACCESS_DENIED');
 const permitted=getPermissionModel_(false).stations.filter(function(h){return access.isAdmin||access.hubCodes.indexOf(h.hubCode)!==-1});
 const id=PropertiesService.getScriptProperties().getProperty('APP_DB_SHEET_ID');
 if(!id)throw Error('Chưa cấu hình database chứa bảng HubMap.');
 const workbook=SpreadsheetApp.openById(id);
 const sheet=workbook.getSheetByName('HubMap')||workbook.getSheetByName('Map Hub')||workbook.getSheetByName('Hub Map');
 const values=sheet?sheet.getDataRange().getValues():[];
 function key(v){return String(v==null?'':v).trim().replace(/\s+/g,' ').toLowerCase()}
 const start=values.findIndex(function(row){const keys=row.map(key);return ['hub code','hub name','lat','long'].every(function(k){return keys.indexOf(k)!==-1})});
 const locationError=!sheet?'Không tìm thấy bảng HubMap trong database.':start<0?'Bảng HubMap cần các cột Hub Code, Hub Name, Lat và Long.':'';
 const header=start<0?[]:values[start].map(key),byCode=Object.create(null),allowed=Object.create(null);
 permitted.forEach(function(h){allowed[key(h.hubCode)]=true});
 function coordinate(v,max){if(v==null||String(v).trim()==='')return null;const n=Number(v);return isFinite(n)&&n!==0&&Math.abs(n)<=max?n:null}
 (start<0?[]:values.slice(start+1)).forEach(function(row){
  function v(name){const i=header.indexOf(key(name));return i<0?'':row[i]}
  function text(name){return String(v(name)==null?'':v(name)).trim()}
  const code=text('Hub Code'),lookup=key(code);if(!code||!allowed[lookup])return;
  const lat=coordinate(v('Lat'),90),lng=coordinate(v('Long'),180);
  byCode[lookup]={code:code,name:text('Hub Name'),lat:lat!==null&&lng!==null?lat:null,lng:lat!==null&&lng!==null?lng:null,
   address:text('Address'),ward:text('Ward (new)'),zone:text('Zone'),type:text('Type'),sqm:text('SQM'),district:text('Dist. (old)')};
 });
 const dtc=hubMapDtcSource_(workbook);
 return {dtcReportDate:dtc.date,dtcSourceSheet:dtc.sheet,dtcError:dtc.error,locationError:locationError,
  hubs:permitted.map(function(h){const r=byCode[key(h.hubCode)];
   const result=Object.assign({lat:null,lng:null},r||{},{code:h.hubCode,name:r&&r.name||h.hubName});
   const data=dtc.byName[hubMapDtcKey_(h.hubName)]||dtc.byName[hubMapDtcKey_(result.name)];
   return Object.assign(result,data||{dtc:null,backlogEod:null,avgDelivered14:null,dtcColor:'unknown',dtcStatus:'NO_RECORD',dtcReportDate:dtc.date});
  })};
}

function hubMapDtcKey_(v){return String(v==null?'':v).trim().toLowerCase().replace(/\s+/g,' ').replace(/(?:\s+hub)+$/,'')}
function hubMapDtcDate_(v){
 if(v instanceof Date&&!isNaN(v.getTime()))return Utilities.formatDate(v,'Asia/Ho_Chi_Minh','yyyy-MM-dd');
 const s=String(v==null?'':v).trim();return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))?s:'';
}
function hubMapDtcNumber_(v){
 if(v==null||String(v).trim()==='')return null;
 let s=String(v).trim();if(s.indexOf(',')!==-1){if(!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s))return null;s=s.replace(/,/g,'')}
 const n=Number(s);return isFinite(n)&&n>=0?n:null;
}
function hubMapDtcSource_(book){
 // Frontend CSV is imported as DTC D0. A backend configured as the frontend
 // may expose the same compatible D0 table instead. Never use mock values here.
 const sheet=book.getSheetByName('DTC D0')||book.getSheetByName('D0');
 const result={date:'',sheet:sheet?sheet.getName():'',error:'',byName:Object.create(null)};
 if(!sheet){result.error='Chưa có sheet DTC D0 trong database front-end.';return result}
 const values=sheet.getDataRange().getValues(),header=(values[0]||[]).map(function(v){return String(v).trim().toLowerCase()}),
  required=['report_date','station_name','backlog_eod','delivered_14d_avg','dtc_days','status','valid_days','expected_days'];
 if(required.some(function(k){return header.indexOf(k)<0})){result.error='DTC D0 thiếu các cột dữ liệu DTC bắt buộc.';return result}
 function cell(row,key){const i=header.indexOf(key);return i<0?'':row[i]}
 values.slice(1).forEach(function(row){const date=hubMapDtcDate_(cell(row,'report_date'));if(date>result.date)result.date=date});
 if(!result.date){result.error='DTC D0 chưa có ngày snapshot hợp lệ.';return result}
 const selected=Object.create(null);
 values.slice(1).forEach(function(row){
  if(hubMapDtcDate_(cell(row,'report_date'))!==result.date)return;
  const name=hubMapDtcKey_(cell(row,'station_name'));if(!name)return;
  const time=Date.parse(String(cell(row,'computed_at')))||0,old=selected[name];
  if(!old||time>old.time)selected[name]={row:row,time:time};
  else if(time===old.time&&JSON.stringify(row)!==JSON.stringify(old.row))old.conflict=true;
 });
 Object.keys(selected).forEach(function(name){
  const item=selected[name],row=item.row,status=item.conflict?'DUPLICATE_CONFLICT':String(cell(row,'status')).trim().toUpperCase(),
   backlog=hubMapDtcNumber_(cell(row,'backlog_eod')),avg=hubMapDtcNumber_(cell(row,'delivered_14d_avg')),value=hubMapDtcNumber_(cell(row,'dtc_days')),
   validDays=hubMapDtcNumber_(cell(row,'valid_days')),expectedDays=hubMapDtcNumber_(cell(row,'expected_days')),
   valid=status==='OK'&&backlog!==null&&avg>0&&value!==null&&validDays===14&&expectedDays===14,
   band=String(cell(row,'dtc_band')).trim().toLowerCase();
  result.byName[name]={dtc:valid?value:null,backlogEod:backlog,avgDelivered14:avg,
   dtcColor:valid?(['green','yellow','red'].indexOf(band)!==-1?band:value<=0.5?'green':value<=1?'yellow':'red'):'unknown',
   dtcStatus:status==='OK'&&!valid?'INVALID_DTC_INPUT':status,dtcReportDate:result.date,
   dtcFetchedAt:String(cell(row,'backlog_fetched_at')||''),dtcComputedAt:String(cell(row,'computed_at')||''),
   dtcValidDays:validDays,dtcExpectedDays:expectedDays,dtcWindowStart:hubMapDtcDate_(cell(row,'window_start')),
   dtcWindowEnd:hubMapDtcDate_(cell(row,'window_end')),dtcMissingDates:String(cell(row,'missing_dates')||'')};
 });
 return result;
}
