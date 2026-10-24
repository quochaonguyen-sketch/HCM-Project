// Shared pure data transforms: Node local server and Apps Script export.
function d0DeliverySummary_(rows) {
  var groups={};
  var fields=['lm_hub_fleet_assigned_order_qty_td','lm_hub_fleet_delivering_in_system_order_qty_eod','lm_hub_fleet_failed_delivery_order_qty_eod','lm_hub_fleet_delivered_order_qty_eod'];
  rows.forEach(function(r){
    var key=String(r.station_id),g=groups[key];
    if(!g){g=groups[key]={station_id:r.station_id,station_name:r.station_name,hub_code:r.hub_code,zone:r.zone,aom:r.aom||[],sup:r.sup||[],rider_count:0,active_rider_ids:[],active_rider_complete:true};fields.forEach(function(f){g[f]=null})}
    if(r.fetched_at&&(!g.fetched_at||String(r.fetched_at)>String(g.fetched_at)))g.fetched_at=r.fetched_at;
    g.rider_count++;
    var assigned=r.lm_hub_fleet_assigned_order_qty_td;
    if(typeof assigned!=='number'||!isFinite(assigned))g.active_rider_complete=false;
    else if(assigned>0){if(r.driver_id==null||String(r.driver_id).trim()==='')g.active_rider_complete=false;else g.active_rider_ids.push(String(r.driver_id))}
    fields.forEach(function(f){if(typeof r[f]==='number'&&isFinite(r[f]))g[f]=(g[f]===null?0:g[f])+r[f]});
  });
  return Object.keys(groups).map(function(k){return groups[k]});
}
function d0AttendanceHours_(rows,reportDate) {
  var groups={},seen={},dates=[],missing=0;
  rows.forEach(function(r){var date=String(r.date||'').slice(0,10);if(date)dates.push(date);});
  var targetDate=reportDate;
  if(!targetDate||(dates.length&&dates.indexOf(targetDate)===-1))targetDate=dates.slice().sort().pop()||'';
  rows.forEach(function(r){
    var date=String(r.date||'').slice(0,10);
    if(date!==targetDate)return;
    var identity=r.person_key||r.biz_staff_id||r.staff_id;
    if(!identity)return;
    var key=String(r.station_id)+'|'+date+'|'+identity;if(seen[key])return;seen[key]=true;
    var stamp=r.first_clock_in,raw=String(stamp||'').replace(' ','T');
    if(raw&&!/(Z|[+-]\d{2}:?\d{2})$/.test(raw))raw+='+07:00';
    var ms=typeof stamp==='number'?stamp*1000:Date.parse(raw);
    if(stamp===null||stamp===undefined||stamp===''||!isFinite(ms)){missing++;return}
    var hour=new Date(ms+7*3600000).getUTCHours(),day=new Date(ms+7*3600000).toISOString().slice(0,10);
    if(day!==targetDate){missing++;return}
    var groupKey=String(r.station_id)+'|'+hour,g=groups[groupKey];
    if(!g)g=groups[groupKey]={station_id:r.station_id,station_name:r.station_name,hub_code:r.hub_code,hour:hour,clock_ins:0,late_arrivals:0};
    g.clock_ins++;if(r.is_late===true||Number(r.is_late)===1)g.late_arrivals++;
  });
  return {rows:Object.keys(groups).map(function(k){return groups[k]}),date:targetDate||dates.sort().pop()||'',missingClockIns:missing};
}
function d0NormalizeAttendance_(rows,shiftRows,reportDate) {
  var fields=shiftRows?['planned_people','actual_people','actual_fte','actual_bpo','actual_os']:['scheduled_count','present_count','late_count','fte_count','bpo_count','os_count','attendance_pct'];
  fields=fields.concat(['male_count','female_count','unknown_gender_count','avg_work_hours','ot_people','ot_hours']);
  var normalized=rows.map(function(source){var row=Object.assign({},source);fields.forEach(function(key){var value=row[key];row[key]=value==null||String(value).trim()===''?null:Number(String(value).replace(/,/g,''));if(!isFinite(row[key]))row[key]=null});row.event_date_iso=String(row.event_date_iso||'').slice(0,10);if(shiftRows){row.shift_date_iso=String(row.shift_date_iso||row.event_date_iso).slice(0,10);if(!row.shift_start||!row.shift_end){var bounds=d0ShiftBounds_(row.shift_date_iso,row.shift);if(bounds){row.shift_start=row.shift_start||bounds.start;row.shift_end=row.shift_end||bounds.end}}}return row});
  var latest=reportDate||normalized.map(function(r){return r.event_date_iso}).filter(Boolean).sort().pop(),byKey={};
  // Several source rows can belong to the same named shift with different counts.
  // Preserve them: the chart aggregates them, and selecting one would lose staff.
  if(shiftRows){var dayStart=Date.parse(latest+'T00:00:00+07:00'),dayEnd=dayStart+86400000;return normalized.filter(function(r){var start=Date.parse(r.shift_start),end=Date.parse(r.shift_end);return !latest||(isFinite(start)&&isFinite(end)?start<dayEnd&&end>dayStart:r.event_date_iso===latest)})}
  normalized.filter(function(r){return !latest||r.event_date_iso===latest}).forEach(function(r){var key=String(r.station_id||r.hub_code||r.station_name)+(shiftRows?'|'+r.shift+'|'+r.shift_start:'');if(!byKey[key]||String(r.fetched_at||'')>=String(byKey[key].fetched_at||''))byKey[key]=r});
  return Object.keys(byKey).map(function(k){return byKey[k]});
}
function d0ShiftBounds_(date,label){
  var m=/(?:^|\s)(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})(\+1)?$/.exec(String(label||'').trim()),day=Date.parse(date+'T00:00:00Z');
  if(!m||!isFinite(day))return null;
  var sh=Number(m[1]),sm=Number(m[2]),eh=Number(m[3]),em=Number(m[4]);if(sh>23||sm>59||eh>24||em>59||(eh===24&&em!==0))return null;
  var start=sh*60+sm,end=eh*60+em;if((m[5]&&end<1440)||end<=start)end+=1440;
  function stamp(minutes){return new Date(day+minutes*60000).toISOString().slice(0,19)+'+07:00'}
  return {start:stamp(start),end:stamp(end)};
}
function d0SectionSheets_(section) {
  var groups={fm:['FM Order Volume D0'],fmPickup:['FM Pending Pickup Backlog D0'],lm:['Backlog D0','LM Backlog D0','LM Order Volume D0'],hourly:['Throughput Hourly D0'],attendance:['Roster D0','Roster Shifts D0'],delivery:['Delivery Progress D0']};
  if(!section)return [].concat(groups.attendance,groups.lm,groups.fm,groups.delivery,groups.fmPickup,groups.hourly);
  if(!Object.prototype.hasOwnProperty.call(groups,section))throw Error('INVALID_D0_SECTION');
  return groups[section].slice();
}
function d0SnapshotSection_(snapshot,section) {
  if(!section)return snapshot;
  var sheets={},names=d0SectionSheets_(section);
  if(section==='attendance')names.push('Attendance Hours D0');
  names.forEach(function(name){sheets[name]=snapshot.sheets[name]||[]});
  var result=Object.assign({},snapshot,{sheets:sheets,section:section});
  if(section!=='attendance'){delete result.attendanceCapabilities;delete result.attendanceHourlyDate;delete result.attendanceMissingClockIns;}
  return result;
}
function d0SummarySnapshot_(snapshot) {
  var sheets={};
  sheets['Throughput Hourly D0']=d0HourlyRows_(snapshot.sheets['Throughput Hourly D0']||[]);
  // Current report only; a previous-day shift is retained while it overlaps this day.
  ['Roster D0','Roster Shifts D0','Backlog D0','LM Backlog D0','LM Order Volume D0','FM Order Volume D0','FM Pending Pickup Backlog D0','Delivery Progress D0','Order Volume D0','FM_Ontime'].forEach(function(k){sheets[k]=snapshot.sheets[k]||[]});
  var reportDates=[];['Roster D0','Roster Shifts D0','FM Order Volume D0'].forEach(function(k){sheets[k].forEach(function(r){var date=String(r.event_date_iso||r.snapshot_date||'').slice(0,10);if(date)reportDates.push(date)})});
  var reportDate=reportDates.sort().pop();
  sheets['Roster D0']=d0NormalizeAttendance_(sheets['Roster D0'],false);
  sheets['Roster Shifts D0']=d0NormalizeAttendance_(sheets['Roster Shifts D0'],true,reportDate);
  sheets['Delivery Progress D0']=d0DeliverySummary_(sheets['Delivery Progress D0']||[]);
  var dates=[];['Roster D0','Roster Shifts D0','FM Order Volume D0'].forEach(function(k){sheets[k].forEach(function(r){var date=String(r.event_date_iso||r.snapshot_date||'').slice(0,10);if(date)dates.push(date)})});
  var hourly=d0AttendanceHours_(snapshot.sheets['BigQuery Attendance']||[],dates.sort().pop()||'');
  sheets['Attendance Hours D0']=hourly.rows;
  return Object.assign({},snapshot,{sheets:sheets,attendanceCapabilities:{late:(snapshot.sheets['Roster D0']||[]).some(function(r){return Object.prototype.hasOwnProperty.call(r,'late_count')})},attendanceHourlyDate:hourly.date,attendanceMissingClockIns:hourly.missingClockIns,summaryOnly:true,cacheSeconds:60});
}
function d0RiderPage_(rows,page,sort,direction,query) {
  function fold(v){return String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase().trim()}
  var search=fold(query),terms=search.split(/\s+/).filter(Boolean);
  if(terms.length)rows=rows.filter(function(r){var text=fold(r.driver_id)+' '+fold(r.driver_name);return terms.every(function(term){return text.indexOf(term)!==-1})});
  page=Math.max(1,Math.floor(Number(page)||1));var size=20,total=rows.length;
  page=Math.min(page,Math.max(1,Math.ceil(total/size)));
  var fields=['driver_id','driver_name','agency_name','contract_type','fetched_at','hub_code','station_id','station_name','lm_hub_fleet_assigned_order_qty_td','lm_hub_fleet_delivering_in_system_order_qty_eod','lm_hub_fleet_failed_delivery_order_qty_eod','lm_hub_fleet_delivered_order_qty_eod'];
  var allowed=fields.concat('performance');sort=allowed.indexOf(sort)!==-1?sort:'';direction=direction==='desc'?'desc':'asc';
  function value(r){if(sort==='performance'){var assigned=r.lm_hub_fleet_assigned_order_qty_td,delivered=r.lm_hub_fleet_delivered_order_qty_eod;return typeof assigned==='number'&&assigned>0&&typeof delivered==='number'&&isFinite(delivered)?delivered/assigned:null}return r[sort]}
  if(sort)rows=rows.slice().sort(function(a,b){var av=value(a),bv=value(b),am=av===null||av===undefined||av==='',bm=bv===null||bv===undefined||bv==='';if(am||bm)return am===bm?0:am?1:-1;var result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'en',{numeric:true,sensitivity:'base'});return result?(direction==='desc'?-result:result):String(a.driver_id).localeCompare(String(b.driver_id),'en',{numeric:true})});
  return {rows:rows.slice((page-1)*size,page*size).map(function(r){var out={};fields.forEach(function(k){out[k]=r[k]===undefined?null:r[k]});return out}),total:total,page:page,pageSize:size,sort:sort,direction:direction};
}
if(typeof module!=='undefined')module.exports={d0SummarySnapshot_,d0RiderPage_,d0AttendanceHours_,d0NormalizeAttendance_,d0ShiftBounds_,d0SectionSheets_,d0SnapshotSection_};

// Preserve missing hourly observations as null. Zero is a reported observation.
function d0HourlyRows_(rows) {
  var fields=['received','delivered','delivering','assigned','assigning','onhold','packing','packed','lh_packing','lh_packed','transported'];
  var latest='',dedup={};
  rows.forEach(function(r){var date=String(r.grass_date||r.datetime||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>latest)latest=date});
  rows.forEach(function(r){
    var date=String(r.grass_date||r.datetime||'').slice(0,10);if(!latest||date!==latest)return;
    var raw=r.hour,hour=null;
    if(typeof raw==='number'&&isFinite(raw))hour=raw>0&&raw<1?Math.round(raw*24):raw;
    else {var match=/^(\d{1,2})(?::[0-5]\d(?::[0-5]\d)?)?$/.exec(String(raw==null?'':raw).trim());if(match)hour=Number(match[1]);}
    if(hour===null||hour<0||hour>23||hour%1)return;
    var row={station_id:r.station_id,station_name:r.station_name,hub_code:r.hub_code,grass_date:date,hour:hour,fetched_at:r.fetched_at||''};
    fields.forEach(function(field){var key='lm_hub_'+field+'_in_system_order_qty_1h',v=r[key],n=v==null||String(v).trim()===''?null:Number(String(v).replace(/,/g,''));row[key]=n!==null&&isFinite(n)?n:null});
    var key=String(r.hub_code||r.station_id||r.station_name)+'|'+hour,old=dedup[key];
    if(!old||String(row.fetched_at)>=String(old.fetched_at))dedup[key]=row;
  });
  return Object.keys(dedup).map(function(k){return dedup[k]}).filter(function(r){return fields.some(function(f){return r['lm_hub_'+f+'_in_system_order_qty_1h']!==null})}).sort(function(a,b){return a.hour-b.hour||String(a.hub_code||a.station_id).localeCompare(String(b.hub_code||b.station_id))});
}
