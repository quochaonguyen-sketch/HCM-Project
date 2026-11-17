/** Rider/FTE master data from the configured Google Sheets backend. */
var FLMP_API = Object.freeze({version:'flmp-sheets-3', ttl:21600, sheets:{RIDER:'riders',FTE:'staff',BPO:'bpo'}, cacheSheet:'_People Resource Cache', chunkSize:45000});

function FLMP_station_(v){return String(v==null?'':v).trim().replace(/\s+/g,' ').toUpperCase().replace(/\s+HUB$/,'').replace(/\s*\/\s*/g,'/');}
function FLMP_stationSql_(){return "REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(TRIM(station)),r'\\s+',' '),r'\\s+HUB$',''),r'\\s*/\\s*','/')";}
function FLMP_digest_(s){
  if (typeof Utilities !== 'undefined' && Utilities.computeDigest && Utilities.DigestAlgorithm && Utilities.DigestAlgorithm.SHA_256) {
    var charset = (Utilities.Charset && Utilities.Charset.UTF_8) || undefined;
    var digest = charset ? Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, charset) : Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s);
    return digest.map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
  }
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function FLMP_context_(request, details) {
  var r = request || {}, module = String(r.module || '');
  if (!Object.prototype.hasOwnProperty.call(FLMP_API.sheets, module)) throw Error('PEOPLE_INVALID_MODULE');
  // Host MUST authenticate module + requested scope BEFORE any cache or source read.
  var c = FLMP_HostContext_(module, r);
  if (!c || typeof c.user !== 'string' || !c.user.trim() || !c.securityVersion || !Array.isArray(c.stations) || !c.stations.length || c.stations.length > 2000) {
    throw Error('PEOPLE_INVALID_HOST_CONTEXT');
  }
  // This value is server-derived in HostBridge, NEVER copied from request/client.
  if (details && c.allowEmployeeDetails !== true) throw Error('PEOPLE_DETAILS_FORBIDDEN');
  var day = String(c.anchor || ''), from = String(c.from || '');
  [day, from].forEach(function(x) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x) || !isFinite(Date.parse(x + 'T00:00:00Z')) || new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) !== x) {
      throw Error('PEOPLE_DATE_INVALID');
    }
  });
  var today = typeof Utilities !== 'undefined' && Utilities.formatDate ? Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd') : new Date().toISOString().slice(0, 10);
  if (day > today || from > day || (Date.parse(day) - Date.parse(from)) / 86400000 > 366) throw Error('PEOPLE_PERIOD_INVALID');
  var stations = Array.from(new Set(c.stations.map(FLMP_station_))).sort();
  if (stations.some(function(x) { return !x; })) throw Error('PEOPLE_STATION_INVALID');
  return {
    module: module,
    user: c.user.trim(),
    securityVersion: String(c.securityVersion),
    stations: stations,
    canonicalStations: c.canonicalStations,
    aliases: c.aliases,
    access: c.access,
    anchor: day,
    from: from,
    scope: c.scope || null,
    canViewEmployeeDetails: c.allowEmployeeDetails === true
  };
}

function FLMP_HostContext_(module, request) {
  var r = request || {};
  var pageKey = module === 'RIDER' ? 'pickup' : 'fte';
  var access = requireAccess_(['dashboard', pageKey]);
  if (access.rank === 'NORMAL') throw Error('MODULE_ACCESS_DENIED');
  var scope = assertScopeAccess_(access, r.scopeType, r.scopeValue);
  var allowed = new Set(scope.hubCodes.map(String));
  var requested = r.selectedHubCodes == null ? [] : r.selectedHubCodes;
  if (!Array.isArray(requested) || requested.length > 500) throw Error('FLM_HUB_SELECTION_INVALID');
  requested.forEach(function(h) {
    if (!allowed.has(String(h))) throw Error('HUB_ACCESS_DENIED');
  });
  var codes = (requested.length ? Array.from(new Set(requested.map(String))) : Array.from(allowed)).sort();
  if (!codes.length) throw Error('FLM_EMPTY_SCOPE');

  var day = flmTeamDay_(r.anchorDate || Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd'));
  var today = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  if (day > today) throw Error('FLM_FUTURE_ANCHOR');
  var from = flmTeamShift_(day, -30);

  var stations = (getPermissionModel_(false).stations || []), owners = {}, byCode = {};
  stations.forEach(function(h) {
    var code = String(h.hubCode);
    if (!byCode[code]) byCode[code] = h;
    [h.hubName, h.stationName, h.hubCode].filter(Boolean).forEach(function(name) {
      var alias = flmTeamAlias_(name);
      if (!owners[alias]) owners[alias] = new Set();
      owners[alias].add(code);
    });
  });

  var aliases = {};
  Object.keys(owners).forEach(function(alias) {
    var matches = Array.from(owners[alias]);
    if (matches.length === 1 && codes.indexOf(matches[0]) >= 0) {
      aliases[alias] = matches[0];
    }
  });

  var canonicalStations = codes.map(function(code) {
    var h = byCode[code];
    var rawName = (h && h.hubName) ? h.hubName : (h && h.stationName ? h.stationName : code);
    var cleanName = rawName.replace(/\s+Hub$/i, '').trim();
    return {
      hubCode: code,
      station: cleanName,
      rawName: rawName
    };
  });

  var securityVersion = typeof getSecurityVersion_ === 'function' ? String(getSecurityVersion_()) : 'v1';
  var allowEmployeeDetails = false;
  if (access && access.rank && access.rank !== 'NORMAL') {
    if (['OPERATIONS_VIEWER','HUB_VIEWER'].indexOf(access.permissionProfile || access.profile || access.role) === -1) {
      allowEmployeeDetails = true;
    }
  }

  return {
    access: access,
    user: access.email,
    securityVersion: securityVersion,
    stations: canonicalStations.map(function(s) { return s.station; }),
    canonicalStations: canonicalStations,
    aliases: aliases,
    anchor: day,
    from: from,
    scope: { type: scope.type, value: scope.value, label: scope.label, hubCount: codes.length },
    allowEmployeeDetails: allowEmployeeDetails
  };
}


function FLMP_bpoRows_(values) {
  var headers=(values[0]||[]).map(FLMPC.norm), columns={}, byId=Object.create(null);
  ['Vendor','Mã CTV','Loại CTV','Địa điểm','Họ và tên','Ngày làm gần nhất','Số ngày chưa phát sinh công','Tag'].forEach(function(name){
    var key=FLMPC.norm(name), index=headers.indexOf(key);
    if(index<0||headers.lastIndexOf(key)!==index)throw Error('PEOPLE_SHEET_SCHEMA_INVALID: bpo / '+name);
    columns[name]=index;
  });
  values.slice(1).forEach(function(row,index){
    if(row.every(function(value){return value===''||value==null;}))return;
    function cell(name){return String(row[columns[name]]==null?'':row[columns[name]]).trim();}
    var id=cell('Mã CTV');
    if(!id||id.charAt(0)==='#')throw Error('PEOPLE_ID_MISSING: bpo row '+(index+2));
    var activity=FLMPC.date(row[columns['Ngày làm gần nhất']]), idle=cell('Số ngày chưa phát sinh công'), issues=[];
    if(activity.invalid||!activity.value)issues.push('ACTIVITY_DATE_INVALID_OR_MISSING');
    if(!/^\d+$/.test(idle)||!Number.isSafeInteger(Number(idle)))issues.push('INACTIVE_DAYS_INVALID_OR_MISSING');
    if(!cell('Họ và tên'))issues.push('NAME_MISSING');
    if(!cell('Địa điểm'))issues.push('STATION_MISSING');
    var record={module:'BPO',employee_id:id,employee_name:cell('Họ và tên'),station:cell('Địa điểm'),vendor:cell('Vendor'),contract_type:cell('Loại CTV'),
      last_activity_date:activity.value||null,inactive_days:/^\d+$/.test(idle)&&Number.isSafeInteger(Number(idle))?Number(idle):null,
      tag:cell('Tag'),quality:issues.length?'UNKNOWN':'VALID',issues:issues.join('|')};
    var previous=byId[id];
    if(previous){
      if(FLMPC.norm(previous.employee_name)!==FLMPC.norm(record.employee_name))throw Error('PEOPLE_DUPLICATE_ID_CONFLICT: bpo row '+(index+2));
      if(previous.last_activity_date===record.last_activity_date&&JSON.stringify(previous)!==JSON.stringify(record))throw Error('PEOPLE_DUPLICATE_ID_CONFLICT: bpo row '+(index+2));
      if((previous.last_activity_date||'')>=(record.last_activity_date||''))return;
    }
    byId[id]=record;
  });
  var records=Object.keys(byId).sort().map(function(id){return byId[id];});
  if(!records.length)throw Error('PEOPLE_SOURCE_EMPTY: bpo');
  return records;
}

function FLMP_sourceRows_(values, module) {
  if (module === 'BPO') return FLMP_bpoRows_(values);
  var headers = (values[0] || []).map(FLMPC.norm), columns = {};
  ['Staff ID/ Rider ID','Họ tên','Ngày nhận việc','Nơi làm việc','Ngày nghỉ việc','Vị trí'].forEach(function(name) {
    var key = FLMPC.norm(name), index = headers.indexOf(key);
    if (index < 0 || headers.lastIndexOf(key) !== index) throw Error('PEOPLE_SHEET_SCHEMA_INVALID: ' + FLMP_API.sheets[module] + ' / ' + name);
    columns[name] = index;
  });
  var byId = Object.create(null);
  values.slice(1).forEach(function(row, index) {
    if (row.every(function(value) { return value === '' || value == null; })) return;
    var position = String(row[columns['Vị trí']] || '').trim();
    if (module === 'FTE' && /\brider\b/.test(FLMPC.norm(position))) return;
    var id = String(row[columns['Staff ID/ Rider ID']] == null ? '' : row[columns['Staff ID/ Rider ID']]).trim();
    if (!id || id.charAt(0) === '#') throw Error('PEOPLE_ID_MISSING: ' + FLMP_API.sheets[module] + ' row ' + (index + 2));
    var join = FLMPC.date(row[columns['Ngày nhận việc']]), exit = FLMPC.date(row[columns['Ngày nghỉ việc']]);
    var name = String(row[columns['Họ tên']] || '').trim(), station = String(row[columns['Nơi làm việc']] || '').trim();
    var issues = [];
    if (join.invalid || !join.value) issues.push('JOIN_DATE_INVALID_OR_MISSING');
    if (exit.invalid) issues.push('EXIT_DATE_INVALID');
    if (join.value && exit.value && exit.value < join.value) issues.push('EXIT_BEFORE_JOIN');
    if (!name) issues.push('NAME_MISSING');
    if (!station) issues.push('STATION_MISSING');
    var record = {module:module, employee_id:id, employee_name:name, station:station, position:position,
      contract_type:String(row[headers.indexOf(FLMPC.norm('Loại nhân viên'))] || '').trim(), email:String(row[headers.indexOf('email')] || '').trim(),
      join_date:join.value || null, last_work_date:exit.value || null, quality:issues.length?'UNKNOWN':'VALID', issues:issues.join('|')};
    if (Object.prototype.hasOwnProperty.call(byId,id) && JSON.stringify(byId[id]) !== JSON.stringify(record)) throw Error('PEOPLE_DUPLICATE_ID_CONFLICT: ' + FLMP_API.sheets[module] + ' row ' + (index + 2));
    byId[id] = record;
  });
  var records = Object.keys(byId).sort().map(function(id) { return byId[id]; });
  if (!records.length) throw Error('PEOPLE_SOURCE_EMPTY: ' + FLMP_API.sheets[module]);
  return records;
}

function FLMP_readDailyCache_(sheet, row, module, day, databaseId) {
  if (!sheet || sheet.getLastRow() < row) return null;
  var cells = sheet.getRange(row,1,1,sheet.getLastColumn()).getValues()[0];
  if (cells[0] !== module || cells[1] !== day) return null;
  try {
    var json = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(cells.slice(4).join('')))).getDataAsString('UTF-8');
    var snapshot = JSON.parse(json);
    if (snapshot.version !== FLMP_API.version || snapshot.databaseId !== databaseId || snapshot.module !== module || snapshot.day !== day || snapshot.revision !== cells[2] || !Array.isArray(snapshot.records)) return null;
    if (snapshot.revision !== FLMP_digest_(JSON.stringify([databaseId,module,day,snapshot.records]))) return null;
    return snapshot;
  } catch (_) { return null; }
}

function FLMP_writeDailyCache_(db, sheet, row, snapshot) {
  if (!sheet) {
    sheet = db.insertSheet(FLMP_API.cacheSheet);
    sheet.getRange(1,1,1,5).setValues([['MODULE','DAY','REVISION','LOADED_AT','JSON_GZIP_BASE64_CHUNKS']]);
    sheet.hideSheet();
  }
  var encoded = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(snapshot),'application/json')).getBytes());
  var cells = [snapshot.module,snapshot.day,snapshot.revision,snapshot.loadedAt];
  for (var i=0; i<encoded.length; i+=FLMP_API.chunkSize) cells.push(encoded.slice(i,i+FLMP_API.chunkSize));
  var width = Math.max(cells.length,sheet.getLastColumn());
  while (cells.length < width) cells.push('');
  sheet.getRange(row,1,1,width).setValues([cells]);
  SpreadsheetApp.flush();
}

function FLMP_snapshot_(module, force) {
  var databaseId = PropertiesService.getScriptProperties().getProperty('D0_DB_SHEET_ID');
  if (!databaseId) throw Error('D0_DB_SHEET_ID is not configured.');
  var day = Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','yyyy-MM-dd');
  var key = FLMP_API.version + ':' + databaseId + ':' + module + ':' + day;
  var cached = force ? null : getChunkedCacheJson_(key);
  if (cached) return cached;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw Error('PEOPLE_REFRESH_BUSY: dữ liệu nhân sự đang được làm mới, vui lòng thử lại.');
  try {
    cached = force ? null : getChunkedCacheJson_(key);
    if (cached) return cached;
    var db = SpreadsheetApp.openById(databaseId), cacheSheet = db.getSheetByName(FLMP_API.cacheSheet), cacheRow = module === 'RIDER' ? 2 : module === 'FTE' ? 3 : 4;
    var snapshot = force ? null : FLMP_readDailyCache_(cacheSheet,cacheRow,module,day,databaseId);
    if (!snapshot) {
      var source = db.getSheetByName(FLMP_API.sheets[module]);
      if (!source) throw Error('PEOPLE_SHEET_MISSING: ' + FLMP_API.sheets[module] + ' trong Google Sheet backend.');
      var values = source.getRange(1,1,Math.max(1,source.getLastRow()),Math.max(1,source.getLastColumn())).getValues();
      var records = FLMP_sourceRows_(values,module);
      snapshot = {version:FLMP_API.version, databaseId:databaseId, module:module, day:day, loadedAt:new Date().toISOString(),
        revision:FLMP_digest_(JSON.stringify([databaseId,module,day,records])), records:records, persistentCache:true};
      try { FLMP_writeDailyCache_(db,cacheSheet,cacheRow,snapshot); }
      catch (_) { snapshot.persistentCache = false; }
    }
    putChunkedCacheJson_(key,snapshot,FLMP_API.ttl);
    return snapshot;
  } finally { lock.releaseLock(); }
}

function FLMP_scopedRows_(c, snapshot) {
  var hubs = {};
  (c.canonicalStations || []).forEach(function(hub) { hubs[hub.hubCode] = hub; });
  return snapshot.records.flatMap(function(record) {
    var code = (c.aliases || {})[flmTeamAlias_(record.station)], hub = hubs[code];
    if (!hub) return [];
    if (c.module === 'BPO') {
      var activity = record.last_activity_date;
      var activityStatus = record.quality !== 'VALID' ? 'UNKNOWN' : activity === c.anchor ? 'WORKED_ON_ANCHOR' : activity < c.anchor ? 'NO_WORK_ON_ANCHOR' : 'AFTER_ANCHOR';
      return [Object.assign({},record,{station:hub.station,hub_code:code,status:activityStatus})];
    }
    var status = FLMPC.state(record,c.anchor), valid = record.quality === 'VALID';
    return [Object.assign({},record,{station:hub.station, hub_code:code, status:status, employment_state:status,
      is_joined_period:valid && record.join_date >= c.from && record.join_date <= c.anchor,
      is_last_work_period:valid && !!record.last_work_date && record.last_work_date >= c.from && record.last_work_date <= c.anchor})];
  });
}

function flmPeopleGetResource(request) {
  var c = FLMP_context_(request,false), snapshot = FLMP_snapshot_(c.module,request && request.force === true);
  if (c.module === 'BPO') {
    var scoped = FLMP_scopedRows_(c,snapshot);
    return {module:'BPO',scope:c.scope,anchor:c.anchor,from:c.from,revision:snapshot.revision,source:'GOOGLE_SHEETS',sourceSheet:'bpo',sourceAsOf:snapshot.loadedAt,cacheDay:snapshot.day,
      canViewEmployeeDetails:c.canViewEmployeeDetails,totals:{records:scoped.length,
        worked_on_anchor:scoped.filter(function(row) { return row.status==='WORKED_ON_ANCHOR'; }).length,
        flagged_records:scoped.filter(function(row) { return row.tag || row.status==='UNKNOWN'; }).length},
      warnings:['Nguồn Google Sheets backend: bpo. Outsource được thống kê riêng với Staff. Mỗi mã CTV lấy một lần theo dòng có ngày làm gần nhất mới nhất.',
        'Ngày làm gần nhất thể hiện phát sinh công, không phải ngày nghỉ việc. Nguồn không có lịch sử công từng ngày hoặc lịch sử chuyển Hub.',
        'Số ngày chưa phát sinh công được giữ nguyên theo nguồn, không suy ra trạng thái đang làm/nghỉ việc.',
        snapshot.persistentCache?'Cache làm mới ở lần truy cập đầu tiên mỗi ngày (giờ Việt Nam). Bấm Làm mới để đọc lại nguồn ngay.':'Không lưu được cache ngày trong backend; cache tạm chỉ giữ tối đa 6 giờ.']};
  }
  var byHub = {}, keys = ['records','unknown_records','active','joined_period','last_work_day_period','exited_before_anchor','not_joined'];
  var totals = {}; keys.forEach(function(key) { totals[key] = 0; });
  FLMP_scopedRows_(c,snapshot).forEach(function(record) {
    var hub = byHub[record.hub_code];
    if (!hub) { hub = {station:record.station,hubCode:record.hub_code,stationCode:record.hub_code,loaded_at:snapshot.loadedAt}; keys.forEach(function(key) { hub[key] = 0; }); byHub[record.hub_code] = hub; }
    hub.records++;
    if (record.status === 'UNKNOWN') hub.unknown_records++;
    if (record.status === 'ACTIVE') hub.active++;
    if (record.status === 'EXITED') hub.exited_before_anchor++;
    if (record.status === 'NOT_JOINED') hub.not_joined++;
    if (record.is_joined_period) hub.joined_period++;
    if (record.is_last_work_period) hub.last_work_day_period++;
  });
  var hubRows = Object.keys(byHub).map(function(code) { var hub=byHub[code]; keys.forEach(function(key) { totals[key] += hub[key]; }); return hub; });
  hubRows.sort(function(a,b) { return b.active-a.active || a.station.localeCompare(b.station); });
  var warnings = ['Nguồn Google Sheets backend: '+FLMP_API.sheets[c.module]+(c.module==='FTE'?'. Đã loại các dòng vị trí Rider.':'. Toàn bộ tab được sử dụng.')+' Ngày nhận/nghỉ việc không được suy đoán.',
    'Cache dữ liệu làm mới ở lần truy cập đầu tiên mỗi ngày (giờ Việt Nam). Bấm Làm mới để đọc lại nguồn ngay.',
    'Phạm vi Hub và quyền xem hồ sơ được kiểm tra lại mỗi lần gọi. Không có lịch sử chuyển Hub hoặc tái tuyển.'];
  if (!snapshot.persistentCache) warnings.push('Không lưu được cache ngày trong backend. Cần quyền ghi tab cache; cache tạm chỉ giữ tối đa 6 giờ.');
  return {module:c.module,scope:c.scope,anchor:c.anchor,from:c.from,revision:snapshot.revision,source:'GOOGLE_SHEETS',sourceSheet:FLMP_API.sheets[c.module],sourceAsOf:snapshot.loadedAt,cacheDay:snapshot.day,
    canViewEmployeeDetails:c.canViewEmployeeDetails,totals:totals,hubRows:hubRows,warnings:warnings,dateRule:'Ngày làm việc cuối cùng vẫn tính đang làm; từ hôm sau tính đã nghỉ.'};
}

function flmPeopleGetEmployees(request) {
  var r=request || {}, c=FLMP_context_(r,true), state=String(r.state || (c.module==='BPO'?'ALL':'ACTIVE')), size=r.pageSize == null?50:Number(r.pageSize);
  var states=c.module==='BPO'?['WORKED_ON_ANCHOR','NO_WORK_ON_ANCHOR','AFTER_ANCHOR','UNKNOWN','ALL']:['ACTIVE','EXITED','NOT_JOINED','UNKNOWN','ALL'];
  if (states.indexOf(state)<0) throw Error('PEOPLE_STATE_INVALID');
  if (!Number.isInteger(size) || size<1 || size>100) throw Error('PEOPLE_PAGE_SIZE_INVALID');
  if (r.search != null && (typeof r.search!=='string' || r.search.length>100)) throw Error('PEOPLE_SEARCH_INVALID');
  var search=c.module==='BPO'?FLMPC.norm(r.search || ''):'';
  var snapshot=FLMP_snapshot_(c.module,false), binding=FLMP_digest_(JSON.stringify([FLMP_API.version,c.user,c.securityVersion,c.stations,c.anchor,c.from,snapshot.revision,state,size,search])), after='';
  if (r.cursor) {
    try { var cursor=JSON.parse(r.cursor); if (typeof r.cursor!=='string' || r.cursor.length>4000 || cursor.binding!==binding || typeof cursor.after!=='string' || !cursor.after || cursor.after.length>256) throw Error(); after=cursor.after; }
    catch (_) { throw Error('PEOPLE_CURSOR_STALE_OR_INVALID: restart first page'); }
  }
  var rows=FLMP_scopedRows_(c,snapshot).filter(function(row) {
    return (state==='ALL' || row.status===state) && row.employee_id>after && (!search || FLMPC.norm([row.employee_id,row.employee_name,row.vendor,row.contract_type,row.station].join(' ')).indexOf(search)>=0);
  });
  var hasMore=rows.length>size; rows=rows.slice(0,size);
  return {module:c.module,anchor:c.anchor,from:c.from,revision:snapshot.revision,state:state,rows:rows,nextCursor:hasMore?JSON.stringify({binding:binding,after:rows[rows.length-1].employee_id}):null};
}

function flmPeopleGetHubRoster(request) {
  var r=request || {}, c=FLMP_context_(r,true), code=String(r.hubCode || r.stationCode || '').trim(), station=String(r.station || '').trim();
  if (!code && !station) throw Error('PEOPLE_STATION_REQUIRED');
  var hubs=(c.canonicalStations || []).filter(function(hub) { return code?hub.hubCode===code:flmTeamAlias_(hub.station)===flmTeamAlias_(station); });
  if (hubs.length!==1) throw Error('HUB_ACCESS_DENIED');
  var hub=hubs[0], snapshot=FLMP_snapshot_(c.module,false), rows=FLMP_scopedRows_(c,snapshot).filter(function(row) { return row.hub_code===hub.hubCode; });
  return {module:c.module,station:hub.station,hubCode:hub.hubCode,anchor:c.anchor,from:c.from,revision:snapshot.revision,total:rows.length,rows:rows,source:'GOOGLE_SHEETS',
    notice:'Hồ sơ từ tab '+FLMP_API.sheets[c.module]+' trong backend. '+(c.module==='BPO'?'Ngày làm gần nhất là ngày phát sinh công, không phải ngày nghỉ việc.':'Ngày nhận/nghỉ việc lấy trực tiếp từ nguồn; dữ liệu được cache trong ngày.')};
}

function flmPeopleCheckResource(request) {
  var c=FLMP_context_(request,false), snapshot=FLMP_snapshot_(c.module,false), rows=FLMP_scopedRows_(c,snapshot);
  return {module:c.module,source:'GOOGLE_SHEETS',sourceSheet:FLMP_API.sheets[c.module],revision:snapshot.revision,cacheDay:snapshot.day,sourceAsOf:snapshot.loadedAt,scope:c.scope,canViewEmployeeDetails:c.canViewEmployeeDetails,
    counts:{records:rows.length,unique_ids:new Set(rows.map(function(row) { return row.employee_id; })).size,missing_names:rows.filter(function(row) { return !row.employee_name; }).length,loaded_at:snapshot.loadedAt}};
}
function flmPeopleCheckFteNames() { requireAdmin_(); return flmPeopleCheckResource({module:'FTE',scopeType:'CITY',scopeValue:APP.CITY_VALUE}); }
