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

/** The verified PostgREST projection also defines the D0 sources checked for freshness. */
function d0SupabaseSources_() {
  return {
    'FM Order Volume D0': { table:'fm_order_volume_d0', key:'station_id', fields:'snapshot_date,total_fm_inbound,outbound,picked,pending_outbound,pending_pickup_total,handover,progress_update_at,data_status' },
    'FM Pending Pickup Backlog D0': { table:'fm_pending_pickup_backlog_d0', key:'id', fields:'snapshot_date,pending_pickup_1_2_days,pending_pickup_3_5_days,pending_pickup_gt_5_days,pending_pickup_from_seller_backlog' },
    'Backlog D0': { table:'backlog_d0', key:'station_id', fields:'total_backlog_d_minus_1,to_deliver_1d,to_deliver_2d,to_deliver_3d,to_deliver_4d,to_deliver_5d,to_deliver_6d,to_deliver_gte_7d' },
    'LM Backlog D0': { table:'lm_backlog_d0', key:'station_id', fields:'backlog_d0,lm_hub_fleet_received_in_system_order_qty_td,lm_hub_fleet_delivering_in_system_order_qty_eod,lm_hub_fleet_onhold_in_system_order_qty_eod,lm_hub_fleet_delivered_order_qty_eod,lm_hub_total_driver_qty_eod' },
    'LM Order Volume D0': { table:'lm_order_volume_d0', key:'station_id', fields:'lm_hub_inbounded_order_qty_eod,lm_hub_delivered_order_qty_eod,pending_inbound,update_at_timestamp' },
    'Throughput Hourly D0': { table:'throughput_hourly_d0', key:'id', fields:'grass_date,hour,datetime,data_timestamp,region,'+['received','delivered','delivering','assigned','assigning','onhold','packing','packed','lh_packing','lh_packed','transported'].map(metric=>'lm_hub_'+metric+'_in_system_order_qty_1h').join(',') },
    'Delivery Progress D0': { table:'delivery_progress_d0', key:'id', fields:'agency_name,contract_type,driver_id,driver_name,lm_hub_fleet_assigned_order_qty_td,lm_hub_fleet_delivered_order_qty_eod,lm_hub_fleet_delivering_in_system_order_qty_eod,lm_hub_fleet_failed_delivery_order_qty_eod' },
    'Roster D0': { table:'roster_d0', key:'id', fields:'event_date_iso,scheduled_count,present_count,fte_count,os_count,bpo_count,attendance_pct,male_count,female_count,unknown_gender_count,avg_work_hours,ot_people,ot_hours,classification_status' },
    'Roster Shifts D0': { table:'roster_shifts_d0', key:'id', fields:'event_date_iso,shift_date_iso,shift,planned_people,actual_people,actual_fte,actual_bpo,actual_os,male_count,female_count,unknown_gender_count,avg_work_hours,ot_people,ot_hours,classification_status' }
  };
}

function d0SupabaseConfig_(props) {
  const url=String(props.getProperty('D0_SUPABASE_URL')||'').trim().replace(/\/$/,'');
  const key=String(props.getProperty('D0_SUPABASE_SECRET_KEY')||'').trim();
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)||!/^sb_secret_[\w-]+$/.test(key))throw Error('D0_SUPABASE_CONFIG');
  return {base:url+'/rest/v1/',key:key,deadline:Date.now()+60000,remaining:512};
}

function d0LocalSheets_(props) {
  return !props.getProperty('D0_SUPABASE_URL')&&!props.getProperty('D0_SUPABASE_SECRET_KEY')&&ScriptApp.getScriptId()==='local-only';
}

function d0HubAliasKey_(value) {
  return String(value||'').trim().toLowerCase().replace(/(?:\s+hub)+$/i,'').replace(/\s+/g,' ');
}

function d0HubAliases_(catalog, permission) {
  const codes=new Map(catalog.map(hub=>[normalizeCompare_(hub.code),hub]));
  const owners=new Map(), aliases=new Map();
  (permission.stations||[]).forEach(station=>{
    [station.hubName,station.hubCode].forEach(value=>{
      const alias=d0HubAliasKey_(value);
      if(!alias)return;
      const code=normalizeCompare_(station.hubCode);
      owners.set(alias,owners.has(alias)&&owners.get(alias)!==code?null:code);
    });
  });
  owners.forEach((code,alias)=>{if(codes.has(code))aliases.set(alias,codes.get(code))});
  return aliases;
}

function d0SupabaseStationFilters_(aliases, maxLength) {
  maxLength=maxLength||1750;
  const names=new Set();
  aliases.forEach((hub,alias)=>{
    const original=String(hub.name||'').trim().toLowerCase();
    if(d0HubAliasKey_(hub.name)===alias){
      names.add(alias);
      names.add(original);
    }
  });
  const batches=[];
  [false,true].forEach(exact=>{
    let items=[],length=0;
    function finish(){
      if(items.length)batches.push('station_name='+(exact?'in.':'ilike(any).')+encodeURIComponent((exact?'(':'{')+items.join(',')+(exact?')':'}')));
      items=[];length=0;
    }
    names.forEach(name=>{
      if(name.includes('*')!==exact)return;
      const literal=JSON.stringify(exact?name:name.replace(/[\\%_]/g,'\\$&'));
      const size=encodeURIComponent(literal).length+3;
      if(size>maxLength)throw Error('D0_SUPABASE_SCOPE');
      if(length+size>maxLength)finish();
      items.push(literal);length+=size;
    });
    finish();
  });
  return batches;
}

function d0SupabaseRows_(source, config, aliases, filters, freshnessOnly) {
  const fields=['station_id','station_name','fetched_at'];
  if(source.key==='id')fields.push('id');
  if(!freshnessOnly)fields.push(...source.fields.split(','));
  const rows=[],seen=new Set();
  const limit=500;
  const prefix=config.base+source.table+'?select='+fields.join(',')+'&';
  const suffix='&order='+source.key+'.asc&limit='+limit;
  const reserve=source.key==='id'?300:40;
  // UrlFetch has a 2,082-character URL limit; budget the projection as well as station aliases.
  if(filters.some(filter=>prefix.length+filter.length+suffix.length+reserve>2082)){
    filters=d0SupabaseStationFilters_(aliases,2082-prefix.length-suffix.length-reserve-40);
  }
  for(const filter of filters){
    let cursor=null;
    const batchSeen=new Set();
    while(true){
      if(config.remaining--<=0||Date.now()>=config.deadline)throw Error('D0_SUPABASE_LIMIT');
      const query='?select='+fields.join(',')+'&'+filter+'&order='+source.key+'.asc&limit='+limit+
        (cursor===null?'':'&'+source.key+'=gt.'+encodeURIComponent(cursor));
      if((config.base+source.table+query).length>2082)throw d0SupabaseError_(source,'request_size',0);
      let page;
      for(let attempt=0;attempt<3;attempt++){
        if(config.remaining--<=0||Date.now()>=config.deadline)throw Error('D0_SUPABASE_LIMIT');
        let response;
        try {
          response=UrlFetchApp.fetch(config.base+source.table+query,{
            method:'get',headers:{apikey:config.key},followRedirects:false,muteHttpExceptions:true
          });
        } catch (_) {
          if(attempt===2)throw d0SupabaseError_(source,'transport',0);
          Utilities.sleep(300*(attempt+1));continue;
        }
        if(Date.now()>=config.deadline)throw Error('D0_SUPABASE_LIMIT');
        const status=response.getResponseCode();
        if(status!==200&&status!==206){
          if((status===429||status>=500)&&attempt<2){Utilities.sleep(300*(attempt+1));continue;}
          let code='';
          try { code=JSON.parse(response.getContentText()).code; } catch (_) {}
          throw d0SupabaseError_(source,'http',status,code);
        }
        try { page=JSON.parse(response.getContentText()); } catch (_) { throw d0SupabaseError_(source,'json',status); }
        if(!Array.isArray(page)||page.length>limit)throw d0SupabaseError_(source,'shape',status);
        break;
      }
      if(!page.length)break;
      for(const row of page){
        const primary=row&&row[source.key];
        if(!row||typeof row.station_name!=='string'||!Number.isSafeInteger(row.station_id)||
            (source.key==='id'&&(typeof primary!=='string'||!primary||primary.length>256))||
            fields.some(field=>!Object.prototype.hasOwnProperty.call(row,field))||batchSeen.has(primary)){
          throw d0SupabaseError_(source,'schema',200);
        }
        batchSeen.add(primary);
        cursor=primary;
        const hub=aliases.get(d0HubAliasKey_(row.station_name));
        if(seen.has(primary)||!hub)continue;
        seen.add(primary);
        const mapped={};
        fields.forEach(field=>{if(field!=='id')mapped[field]=row[field]});
        rows.push(Object.assign(mapped,{hub_code:hub.code,zone:hub.zone,aom:hub.aom,sup:hub.sup}));
      }
      if(page.length<limit)break;
    }
  }
  return rows;
}

// Keep public error codes stable; execution logs contain only allowlisted diagnostics.
function d0SupabaseError_(source, kind, status, upstreamCode) {
  const code=status===401||status===403?'D0_SUPABASE_CONFIG':'D0_SUPABASE_UPSTREAM';
  const known=/^(?:PGRST\d{3}|42P01|42703|42501|57014|53300)$/.test(String(upstreamCode||''))?String(upstreamCode):'';
  console.warn(JSON.stringify({code:code,relation:source.table,kind:kind,status:status,upstreamCode:known}));
  return Error(code);
}

function d0ScopeCacheKey_(config, catalog, aliases) {
  // A grant or mapping change must be a cache miss, including changes past the old 32-character prefix.
  const scope=JSON.stringify([config.base,catalog.slice().sort((a,b)=>String(a.code).localeCompare(String(b.code))),
    aliases?Array.from(aliases.entries()).sort((a,b)=>a[0].localeCompare(b[0])):[]]);
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,scope));
}

function d0CacheRead_(key) {
  try {
    const cache=CacheService.getScriptCache(),manifest=cache.get(key);
    if(!manifest)return null;
    const keys=JSON.parse(manifest),chunks=cache.getAll(keys);
    if(!keys.length||keys.some(k=>!chunks[k]))return null;
    return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(keys.map(k=>chunks[k]).join('')))).getDataAsString('UTF-8'));
  } catch (_) { return null; }
}

function d0CacheWrite_(key, value) {
  try {
    const cache=CacheService.getScriptCache();
    const encoded=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(value),'application/json')).getBytes());
    const token=Utilities.getUuid(),keys=[],chunks={};
    for(let i=0;i<encoded.length;i+=85000){const part=key+':'+token+':'+keys.length;keys.push(part);chunks[part]=encoded.slice(i,i+85000);}
    cache.putAll(chunks,60);
    // Publish only the completed generation; eviction or a partial write becomes a miss.
    cache.put(key,JSON.stringify(keys),60);
  } catch (_) {}
}

function d0SupabaseFetchedAt_(value) {
  const raw=String(value||'').trim().replace(' ','T');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw))return null;
  const day=Date.parse(raw.slice(0,10)+'T00:00:00Z');
  if(!isFinite(day)||new Date(day).toISOString().slice(0,10)!==raw.slice(0,10))return null;
  const stamp=Date.parse(raw+(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)?'':'+07:00'));
  if(!isFinite(stamp))return null;
  // Date keeps milliseconds. Preserve the source fraction so later rows and batch equality stay exact.
  const fraction=(/\.\d+/.exec(raw)?.[0]||'.').replace(/0+$/,'').padEnd(4,'0');
  return new Date(stamp+7*3600000).toISOString().slice(0,19)+fraction+'+07:00';
}

function d0SupabaseSnapshotRows_(sheets) {
  const aliases={
    'FM Order Volume D0': {total_fm_inbound:'Total FM Inbound',picked:'Picked',outbound:'Outbound'},
    'Backlog D0': {total_backlog_d_minus_1:'total_backlog D-1'},
    'FM Pending Pickup Backlog D0': {
      pending_pickup_1_2_days:'pending_pickup_from_seller_backlog_1_2_days',
      pending_pickup_3_5_days:'pending_pickup_from_seller_backlog_3_5_days',
      pending_pickup_gt_5_days:'pending_pickup_from_seller_backlog_gt_5_days'
    }
  };
  const lm=['Backlog D0','LM Backlog D0','LM Order Volume D0'];
  const sameDay=lm.concat(['FM Order Volume D0','FM Pending Pickup Backlog D0','Delivery Progress D0']);
  const day=row=>String(row.snapshot_date||row.fetched_at||'').slice(0,10);
  function latestDay(rows) {
    return rows.reduce((latest,row)=>{
      const date=day(row);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('D0_SUPABASE_UPSTREAM');
      return date>latest?date:latest;
    },'');
  }
  Object.keys(sheets).forEach(name=>sheets[name].forEach(row=>{
    row.fetched_at=d0SupabaseFetchedAt_(row.fetched_at);
    if(!row.fetched_at)throw d0SupabaseError_(d0SupabaseSources_()[name],'timestamp',200);
    if(row.snapshot_date&&!/^\d{4}-\d{2}-\d{2}$/.test(String(row.snapshot_date)))throw d0SupabaseError_(d0SupabaseSources_()[name],'date',200);
    Object.keys(aliases[name]||{}).forEach(field=>{
      row[aliases[name][field]]=row[field];
      delete row[field];
    });
  }));
  const lmDay=latestDay(lm.flatMap(name=>sheets[name]||[]));
  sameDay.forEach(name=>{
    if(!sheets[name])return;
    const date=lm.includes(name)?lmDay:latestDay(sheets[name]);
    sheets[name]=sheets[name].filter(row=>day(row)===date);
  });
  if(sheets['Delivery Progress D0']){
    // Riders are upserted by station and rider. Older rows must not inflate the latest batch.
    const latest=new Map();
    sheets['Delivery Progress D0'].forEach(row=>{
      if(!latest.has(row.hub_code)||row.fetched_at>latest.get(row.hub_code))latest.set(row.hub_code,row.fetched_at);
    });
    sheets['Delivery Progress D0']=sheets['Delivery Progress D0'].filter(row=>row.fetched_at===latest.get(row.hub_code));
  }
}

function d0ForecastRows_(rows, catalog, date, source, aliases) {
  const codes=new Map(),byHub=Object.create(null);
  catalog.forEach(hub=>{
    const key=normalizeCompare_(hub.code);
    codes.set(key,codes.has(key)&&codes.get(key)!==hub.code?null:hub.code);
    byHub[hub.code]={fm:null,lm:null};
  });
  const names=aliases||d0HubAliases_(catalog,{stations:catalog.map(hub=>({hubCode:hub.code,hubName:hub.name}))});
  function quantity(value) {
    if(typeof value!=='number'&&typeof value!=='string')return null;
    const text=String(value).trim();
    if(typeof value==='string'&&!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text))return null;
    const amount=Number(text.replace(/,/g,''));
    return Number.isFinite(amount)&&amount>=0?amount:null;
  }
  const matched=new Set(),duplicates=new Set();
  rows.forEach(row=>{
    const explicitCode=String(row.hub_code==null?'':row.hub_code).trim();
    // A row with an explicit foreign code cannot borrow an authorized display name.
    const code=explicitCode?codes.get(normalizeCompare_(explicitCode)):names.get(d0HubAliasKey_(row.hub_name))?.code;
    if(!code||!byHub[code]||duplicates.has(code))return;
    if(matched.has(code)){
      duplicates.add(code);
      matched.delete(code);
      byHub[code]={fm:null,lm:null};
      return;
    }
    matched.add(code);
    byHub[code]={fm:quantity(row.fm_forecast),lm:quantity(row.lm_forecast)};
  });
  return matched.size?d0ForecastTotals_({source:source,date:date,targetDate:date,matchedHubs:matched.size,totalHubs:catalog.length,byHub:byHub}):null;
}

function d0ForecastTotals_(plan) {
  const hubs=Object.values(plan.byHub);
  const total=leg=>hubs.every(h=>h[leg]!=null)?hubs.reduce((sum,h)=>sum+h[leg],0):null;
  return Object.assign(plan,{fmForecast:total('fm'),lmForecast:total('lm')});
}

function d0TodayForecastFromSupabase_(config, catalog, targetDate, force, aliases, readWorkbook) {
  if (!config || !config.base || !targetDate) return null;
  const cacheKey = 'd0_fc_v4:' + targetDate + ':' + d0ScopeCacheKey_(config,catalog,aliases);
  let plan=null;
  if(force){try {CacheService.getScriptCache().remove(cacheKey);} catch (_) {}}
  else plan=d0CacheRead_(cacheKey);
  if(!plan){
    try {
      const res = UrlFetchApp.fetch(config.base + 'forecast_daily?plan_date=eq.' + encodeURIComponent(targetDate) + '&select=hub_name,hub_code,fm_forecast,lm_forecast', {
        method: 'get',
        headers: { apikey: config.key },
        followRedirects: false,
        muteHttpExceptions: true
      });
      if(res.getResponseCode()!==200)return null;
      const rows=JSON.parse(res.getContentText());
      // d0_operations_summary also coalesces missing plan quantities to zero.
      if(!Array.isArray(rows)||!rows.length)return null;
      plan=d0ForecastRows_(rows,catalog,targetDate,'supabase',aliases);
      if(!plan)return null;
      d0CacheWrite_(cacheKey,plan);
    } catch (_) {
      return null;
    }
  }

  const entries=Object.entries(plan.byHub);
  if(!entries.some(([,hub])=>hub.fm===0||hub.lm===0))return plan;
  let workbook=null;
  try {if(readWorkbook)workbook=readWorkbook();} catch (_) {}
  const original=workbook?.date===targetDate?workbook.byHub:null;
  // The seed and table defaults conflate blanks and explicit zero. Without the exact
  // original cell, a legacy zero stays unknown. The cache is only the Supabase result.
  entries.forEach(([code,hub])=>{
    ['fm','lm'].forEach(leg=>{
      if(hub[leg]===0)hub[leg]=original?.[code]?.[leg]??null;
    });
  });
  return d0ForecastTotals_(plan);
}

function d0TodayForecastFromWorkbook_(props, db, catalog, targetDate, force, aliases) {
  const customId=props.getProperty('DTC_FC_SHEET_ID');
  let sheets=[],bestMonth=-1;
  function consider(candidate) {
    try {
      const book=typeof candidate==='string'?SpreadsheetApp.openById(candidate):candidate;
      const found=dtcFindFcSheets_(book);
      const month=Math.max(...found.map(sheet=>dtcFcSheetSortKey_(sheet.getName())));
      if(month>bestMonth||(month===bestMonth&&found.length>sheets.length)){
        sheets=found;bestMonth=month;
      }
    } catch (_) {}
  }
  if(customId)consider(customId);
  if(!sheets.length)[props.getProperty('APP_DB_SHEET_ID'),props.getProperty('D0_DB_SHEET_ID'),db].filter(Boolean).forEach(consider);
  if(!sheets.length)return null;
  const cacheKey='d0_fc_workbook_v2:'+targetDate+':'+d0ScopeCacheKey_({base:sheets.map(s=>s.getParent().getId()+'#'+s.getName()).join('|')},catalog,aliases);
  if(force){try {CacheService.getScriptCache().remove(cacheKey);} catch (_) {}}
  else {const cached=d0CacheRead_(cacheKey);if(cached)return cached;}

  // Read each leg's original cells. The merged DTC matrix fills blank plans with zero.
  const rows=new Map(),foundLegs=new Set();
  sheets.forEach(sheet=>{
    if(foundLegs.size===2)return;
    const values=sheet.getDataRange().getValues();
    if(values.length<2)return;
    let date='';
    values[0].forEach((value,index)=>{
      if(!index)return;
      if(typeof value==='number'&&value>30000&&value<60000)value=new Date(Math.round((value-25569)*86400000));
      date=forecastDateKey_(value)||date;
      if(date!==targetDate)return;
      const tag=String(values[1][index]||'').replace(/[\s#_]/g,'').toLowerCase();
      const leg=tag==='fmforecast'||tag==='forecastfm'?'fm':tag==='lmforecast'||tag==='forecastlm'?'lm':'';
      if(!leg||foundLegs.has(leg))return;
      foundLegs.add(leg);
      values.slice(2).forEach(row=>{
        const name=row[0],key=d0HubAliasKey_(name);
        if(!key)return;
        const entry=rows.get(key)||{hub_name:name};
        const field=leg+'_forecast';
        entry[field]=Object.prototype.hasOwnProperty.call(entry,field)?null:row[index];
        rows.set(key,entry);
      });
    });
  });
  if(!foundLegs.size)return null;
  const result=d0ForecastRows_(Array.from(rows.values()),catalog,targetDate,'workbook',aliases);
  if(result)d0CacheWrite_(cacheKey,result);
  return result;
}

function d0WorkspaceSnapshot_(access, names, force) {
  const props=PropertiesService.getScriptProperties(),permission=getPermissionModel_(false);
  const catalog=deployHubCatalog_(access,permission);
  const aliases=d0HubAliases_(catalog,permission),sheets={};
  const local=d0LocalSheets_(props);
  let db=null,config=null;
  function readSheet(name) {
    const id=props.getProperty('D0_DB_SHEET_ID');
    if(!id)return [];
    if(!db)db=SpreadsheetApp.openById(id);
    return deployReadRows_(db,name,force===true).flatMap(row=>{
      const hub=aliases.get(d0HubAliasKey_(row.hub_code))||aliases.get(d0HubAliasKey_(row.station_name));
      return hub?[Object.assign({},row,{hub_code:hub.code,zone:hub.zone,aom:hub.aom,sup:hub.sup})]:[];
    });
  }
  if(local){
    names.forEach(name=>{sheets[name]=readSheet(name)});
  }else{
    config=d0SupabaseConfig_(props);
    const sources=d0SupabaseSources_(),filters=d0SupabaseStationFilters_(aliases);
    const scopeKey=d0ScopeCacheKey_(config,catalog,aliases);
    names.forEach(name=>{
      if(name==='BigQuery Attendance')return;
      const cacheKey='d0_sb_v2:'+sources[name].table+':'+scopeKey;
      if(force){try {CacheService.getScriptCache().remove(cacheKey);} catch (_) {}}
      else {
        const hit=d0CacheRead_(cacheKey);
        if(Array.isArray(hit)){sheets[name]=hit;return;}
      }
      const rows=d0SupabaseRows_(sources[name],config,aliases,filters,false);
      // Validate source timestamps before caching so invalid data cannot become a warm success.
      d0SupabaseSnapshotRows_({[name]:JSON.parse(JSON.stringify(rows))});
      sheets[name]=rows;
      d0CacheWrite_(cacheKey,rows);
    });
    d0SupabaseSnapshotRows_(sheets);
    if(names.includes('BigQuery Attendance')){
      try { sheets['BigQuery Attendance']=readSheet('BigQuery Attendance'); }
      catch (_) { sheets['BigQuery Attendance']=[]; }
    }
  }
  let todayForecast=null;
  try {
    const lastDate=values=>values.map(value=>String(value||'').slice(0,10)).filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)).sort().pop();
    const sourceDates=name=>lastDate((sheets[name]||[]).map(row=>row.snapshot_date||row.event_date_iso||row.fetched_at));
    const date=sourceDates('FM Order Volume D0')||sourceDates('LM Order Volume D0');
    if(date){
      const readWorkbook=()=>d0TodayForecastFromWorkbook_(props,db,catalog,date,force,aliases);
      todayForecast=d0TodayForecastFromSupabase_(config,catalog,date,force,aliases,readWorkbook);
      if(!todayForecast){
        const result=readWorkbook();
        if(result?.date===date)todayForecast=result;
      }
    }
  } catch (_) {}
  return {sheets:sheets,hubCatalog:catalog,todayForecast:todayForecast,access:toPublicAccess_(access,permission),generatedAt:new Date().toISOString()};
}
