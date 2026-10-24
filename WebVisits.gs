// One record per authorized visit. Google Sheets Date cells are normalized before comparison.
var WEB_VISITS_CFG_={timezone:'Asia/Ho_Chi_Minh',prefix:'WebVisits_',columns:['Day','Session ID','Email','Role','Opened at','Left at']};
function webVisitsDay_(date){return Utilities.formatDate(new Date(date),WEB_VISITS_CFG_.timezone,'yyyy-MM-dd')}
function webVisitsCellDay_(value){if(Object.prototype.toString.call(value)==='[object Date]')return isFinite(+value)?webVisitsDay_(value):'';var text=String(value||'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:isFinite(+new Date(text))?webVisitsDay_(new Date(text)):''}
function webVisitsStamp_(value){if(!value)return '';var date=new Date(value);return isFinite(+date)?date.toISOString():''}
function webVisitsDate_(value){var day=String(value||webVisitsDay_(new Date()));if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!isFinite(+new Date(day+'T12:00:00+07:00'))||webVisitsDay_(new Date(day+'T12:00:00+07:00'))!==day)throw Error('INVALID_VISIT_DATE');return day}
function webVisitsSheet_(day,create){var db=getDb_(),name=WEB_VISITS_CFG_.prefix+day.slice(0,7).replace('-','_'),sh=db.getSheetByName(name);if(!sh&&create){sh=db.insertSheet(name);sh.getRange(1,1,1,6).setValues([WEB_VISITS_CFG_.columns]);sh.setFrozenRows(1)}return sh}
function webVisitsSchema_(sh){var header=sh.getRange(1,1,1,9).getValues()[0];return {legacy:String(header[5])==='Last active at',width:String(header[5])==='Last active at'?9:6}}
function webVisitsRecords_(sh){if(!sh||sh.getLastRow()<2)return [];var schema=webVisitsSchema_(sh);return sh.getRange(2,1,sh.getLastRow()-1,schema.width).getValues().map(function(r,i){return {row:i+2,day:webVisitsCellDay_(r[0]),sessionId:String(r[1]),email:String(r[2]),role:String(r[3]),openedAt:webVisitsStamp_(r[4]),leftAt:webVisitsStamp_(r[schema.legacy?6:5])}})}
function trackWebVisit(payload){
 var access=requireAccess_(),p=payload||{},id=String(p.sessionId||'');if(!/^[a-zA-Z0-9-]{16,80}$/.test(id))throw Error('INVALID_VISIT_SESSION');
 var now=new Date(),today=webVisitsDay_(now),day=p.day?webVisitsDate_(p.day):today,leave=p.event==='leave',lock=LockService.getScriptLock();
 if(!leave)day=today;if(!lock.tryLock(1500))return {tracked:false};
 try{
  var sh=webVisitsSheet_(day,!leave),records=webVisitsRecords_(sh),matches=records.filter(function(r){return r.day===day&&r.sessionId===id});
  if(matches.some(function(r){return r.email!==access.email}))throw Error('VISIT_SESSION_OWNER_MISMATCH');
  if(!matches.length){
   if(leave)return {tracked:false,day:day};
   var stamp=now.toISOString(),schema=webVisitsSchema_(sh);
   sh.appendRow(schema.legacy?[day,id,access.email,access.rank,stamp,'','','','']:[day,id,access.email,access.rank,stamp,'']);
  }else if(leave){
   var schema=webVisitsSchema_(sh),stamp=now.toISOString();
   // Update existing records, including old duplicate rows; never append on navigation or departure.
   matches.forEach(function(r){if(!r.leftAt)sh.getRange(r.row,schema.legacy?7:6,1,1).setValues([[stamp]])});
  }
  return {tracked:true,day:day};
 }finally{lock.releaseLock()}
}
function webVisitsRows_(days){var months={},rows=[],sessions={};days.forEach(function(day){months[day.slice(0,7)]=day});Object.keys(months).forEach(function(month){rows=rows.concat(webVisitsRecords_(webVisitsSheet_(months[month],false)))});
 rows.forEach(function(r){if(days.indexOf(r.day)===-1||!r.email||!r.sessionId)return;var key=r.day+'|'+r.sessionId+'|'+r.email,existing=sessions[key];if(!existing){sessions[key]=r;return}if(r.openedAt&&(!existing.openedAt||r.openedAt<existing.openedAt))existing.openedAt=r.openedAt;if(r.leftAt&&(!existing.leftAt||r.leftAt>existing.leftAt))existing.leftAt=r.leftAt});return Object.keys(sessions).map(function(key){return sessions[key]})}
function webVisitsSummary_(rows){var people={},departures=0,hours=Array.from({length:24},function(_,i){return {hour:i,visits:0}});rows.forEach(function(r){people[r.email]=true;if(r.leftAt)departures++;if(r.openedAt)hours[Number(Utilities.formatDate(new Date(r.openedAt),WEB_VISITS_CFG_.timezone,'HH'))].visits++});return {visits:rows.length,users:Object.keys(people).length,departures:departures,unrecorded:rows.length-departures,hours:hours}}
function getWebVisitReport(date,query,page){
 requireAdmin_();var day=webVisitsDate_(date),now=new Date(),days=[];for(var i=6;i>=0;i--)days.push(webVisitsDay_(new Date(new Date(day+'T12:00:00+07:00').getTime()-i*86400000)));
 var all=webVisitsRows_(days),rows=all.filter(function(r){return r.day===day}),summary=webVisitsSummary_(rows),search=String(query||'').toLowerCase().trim().slice(0,100),filtered=rows.filter(function(r){return !search||(r.email+' '+r.role).toLowerCase().indexOf(search)!==-1}).sort(function(a,b){return b.openedAt.localeCompare(a.openedAt)}),size=25;
 page=Math.max(1,Math.min(Math.ceil(filtered.length/size)||1,Math.floor(Number(page)||1)));
 return {day:day,today:webVisitsDay_(now),timezone:WEB_VISITS_CFG_.timezone,summary:summary,trend:days.map(function(d){var s=webVisitsSummary_(all.filter(function(r){return r.day===d}));return {day:d,visits:s.visits,users:s.users}}),total:filtered.length,page:page,pageSize:size,rows:filtered.slice((page-1)*size,page*size).map(function(r){return {email:r.email,role:r.role,openedAt:r.openedAt,leftAt:r.leftAt,status:r.leftAt?'left':'unrecorded'}}),generatedAt:now.toISOString()};
}
