/**
 * Hub Access Request & Approval API
 * Supports requesting Hub access with custom role and optional KPI permission.
 * AOMs can review requests for Hubs they manage; Admins can review all Hubs.
 */

var HUB_REQUEST_CFG = Object.freeze({
  sheet: 'Hub Access Requests',
  headers: [
    'REQUEST_ID',
    'EMAIL',
    'DISPLAY_NAME',
    'HUB_CODE',
    'HUB_NAME',
    'ROLE_NAME',
    'INCLUDE_KPI',
    'STATUS',
    'NOTE',
    'CREATED_AT',
    'REVIEWED_BY',
    'REVIEWED_AT',
    'REJECTION_REASON'
  ]
});

function getHubRequestSheet_() {
  var db = getDb_();
  var sheet = db.getSheetByName(HUB_REQUEST_CFG.sheet);
  if (!sheet) {
    sheet = db.insertSheet(HUB_REQUEST_CFG.sheet);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HUB_REQUEST_CFG.headers.length).setValues([HUB_REQUEST_CFG.headers.slice()]);
    SpreadsheetApp.flush();
  }
  return sheet;
}

function getAomManagedHubCodes_(email, permission) {
  var norm = normalizeEmail_(email);
  if (!norm) return [];
  var model = permission || getPermissionModel_(false);
  var managed = [];
  (model.stations || []).forEach(function(s) {
    var aoms = (s.aom || []).concat(s.saom || []).map(normalizeEmail_);
    if (aoms.indexOf(norm) !== -1) {
      managed.push(String(s.hubCode));
    }
  });
  return Array.from(new Set(managed));
}

/**
 * Helper: Classify whether a station is First Mile (FM) or Last Mile (LM).
 */
function isFmHub_(station) {
  if (!station) return false;
  var code = String(station.hubCode || station.code || '').toUpperCase().trim();
  var name = String(station.hubName || station.name || station.Hub || '').toUpperCase().trim();
  var type = String(station.type || station.hubType || '').toUpperCase().trim();
  if (type === 'FM' || /^FM[\s_-]/.test(type) || /\bFM HUB\b/.test(type)) return true;
  if (code.startsWith('54HCM') || code.indexOf('FM') >= 0) return true;
  if (/\bFM\b/.test(name) || name.indexOf('FIRST MILE') >= 0 || name.indexOf('FIRSTMILE') >= 0) return true;
  return false;
}

function readHubRequestRows_() {
  var sheet = getHubRequestSheet_();
  if (sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var header = values.shift();
  var out = [];
  values.forEach(function(r, idx) {
    var reqId = String(r[0] || '').trim();
    if (!reqId) return;
    out.push({
      rowNumber: idx + 2,
      requestId: reqId,
      email: normalizeEmail_(r[1]),
      displayName: String(r[2] || ''),
      hubCode: String(r[3] || '').trim(),
      hubName: String(r[4] || '').trim(),
      roleName: String(r[5] || '').trim(),
      includeKpi: r[6] === true || String(r[6]).toUpperCase() === 'TRUE',
      status: String(r[7] || 'PENDING').trim().toUpperCase(),
      note: String(r[8] || '').trim(),
      createdAt: r[9] instanceof Date ? r[9].toISOString() : String(r[9] || ''),
      reviewedBy: normalizeEmail_(r[10]),
      reviewedAt: r[11] instanceof Date ? r[11].toISOString() : String(r[11] || ''),
      rejectionReason: String(r[12] || '').trim()
    });
  });
  return out;
}

/**
 * Endpoint: Initial data for Hub Permission Request & AOM Grant page.
 */
function getHubRequestInitData() {
  var access = requireAccess_();
  var permission = getPermissionModel_(false);
  var email = access.email;
  var isAdmin = access.isAdmin || access.rank === 'ADMIN';
  var managedHubCodes = isAdmin
    ? (permission.stations || []).map(function(s) { return String(s.hubCode); })
    : getAomManagedHubCodes_(email, permission);
  var isAom = isAdmin || managedHubCodes.length > 0;

  var allStations = (permission.stations || []).map(function(s) {
    return {
      hubCode: String(s.hubCode),
      hubName: s.hubName,
      zone: s.zone || '',
      aom: s.aom || [],
      saom: s.saom || [],
      hubType: isFmHub_(s) ? 'FM' : 'LM'
    };
  }).sort(function(a, b) {
    return a.hubName.localeCompare(b.hubName);
  });

  var managedHubSet = new Set(managedHubCodes.map(String));
  var managedStations = allStations.filter(function(s) {
    return managedHubSet.has(s.hubCode);
  });

  var rows = readHubRequestRows_();
  var myRequests = rows.filter(function(r) { return r.email === email; })
                       .sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });

  var pendingApprovals = [];
  var approvalHistory = [];
  var managedGrants = [];

  if (isAom) {
    rows.forEach(function(r) {
      if (!isAdmin && !managedHubSet.has(String(r.hubCode))) return;
      if (r.status === 'PENDING') {
        pendingApprovals.push(r);
      } else {
        approvalHistory.push(r);
      }
    });
    pendingApprovals.sort(function(a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    approvalHistory.sort(function(a, b) { return String(b.reviewedAt || b.createdAt).localeCompare(String(a.reviewedAt || a.createdAt)); });

    // Build managed grants from Access Grants & latest Hub Access Requests
    var grantRows = (typeof accessGrantRows_ === 'function') ? accessGrantRows_() : [];
    var stationMap = {};
    allStations.forEach(function(s) { stationMap[s.hubCode] = s.hubName; });

    // Map latest request rows by email + hubCode for rich roleName/KPI info
    var reqMap = {};
    rows.forEach(function(r) {
      if (r.status === 'APPROVED' || r.status === 'REVOKED') {
        var k = r.email + '||' + r.hubCode;
        if (!reqMap[k] || String(r.reviewedAt || r.createdAt) > String(reqMap[k].reviewedAt || reqMap[k].createdAt)) {
          reqMap[k] = r;
        }
      }
    });

    grantRows.forEach(function(g) {
      if (g.profile === 'DELETED' || !g.active) return;
      (g.hubCodes || []).forEach(function(code) {
        code = String(code);
        if (!managedHubSet.has(code)) return;
        var k = g.email + '||' + code;
        var matchedReq = reqMap[k];
        var isAllPages = (g.pages && g.pages.length === ACCESS_GRANT_CFG.pages.length);
        var derivedRole = matchedReq ? matchedReq.roleName : (isAllPages ? 'All Permissions' : (g.profile || 'CUSTOM'));
        var hType = isFmHub_(stationMap[code] ? { hubCode: code, hubName: stationMap[code] } : { hubCode: code });
        managedGrants.push({
          email: g.email,
          displayName: g.displayName || (matchedReq ? matchedReq.displayName : ''),
          hubCode: code,
          hubName: stationMap[code] || (matchedReq ? matchedReq.hubName : code),
          hubType: hType ? 'FM' : 'LM',
          roleName: derivedRole,
          includeKpi: matchedReq ? matchedReq.includeKpi : (g.pages || []).indexOf('kpi') !== -1,
          pages: g.pages || [],
          grantedBy: matchedReq ? matchedReq.reviewedBy : g.updatedBy,
          grantedAt: matchedReq ? (matchedReq.reviewedAt || matchedReq.createdAt) : g.updatedAt,
          note: matchedReq ? matchedReq.note : g.note,
          requestId: matchedReq ? matchedReq.requestId : ''
        });
      });
    });

    managedGrants.sort(function(a, b) {
      return String(b.grantedAt).localeCompare(String(a.grantedAt));
    });
  }

  return {
    ok: true,
    user: {
      email: email,
      displayName: access.displayName,
      rank: access.rank,
      isAdmin: isAdmin,
      isAom: isAom,
      managedHubCodes: managedHubCodes
    },
    hubs: allStations,
    managedHubs: managedStations,
    managedGrants: managedGrants,
    myRequests: myRequests,
    pendingApprovals: pendingApprovals,
    approvalHistory: approvalHistory.slice(0, 100),
    standardRoles: [
      { id: 'ALL', name: 'All Permissions (Full Access - ' + ACCESS_GRANT_CFG.pages.length + '/' + ACCESS_GRANT_CFG.pages.length + ')' },
      { id: 'FM', name: '🚚 First Mile Package (Backlog, D0, Dashboard, KPI)' },
      { id: 'LM', name: '🛵 Last Mile Package (Alerts, Rider Resource, D0, Dashboard, KPI)' },
      { id: 'CUSTOM', name: '⚙️ Select Individual Permissions' }
    ]
  };
}

/**
 * Endpoint: Check what Hubs and permissions a target email already has.
 * Enables Admin & AOM to inspect existing access upon entering an email,
 * preventing duplicate grants and preventing overwriting with smaller permissions.
 */
function checkUserHubAccess(targetEmail) {
  var caller = requireAccess_();
  targetEmail = normalizeEmail_(targetEmail);
  if (!targetEmail) {
    return {
      ok: true,
      email: '',
      found: false,
      isAdmin: false,
      isProtectedAdmin: false,
      existingHubs: [],
      existingHubCodes: [],
      pendingRequests: []
    };
  }

  var permission = getPermissionModel_(false);
  var allStations = permission.stations || [];
  var stationMap = {};
  allStations.forEach(function(s) {
    stationMap[String(s.hubCode)] = s;
  });

  // Check if target is an Admin or SuperAdmin
  var isTargetSuperAdmin = (typeof isSuperAdminEmail_ === 'function') && isSuperAdminEmail_(targetEmail);
  var targetAccount = (typeof getAdhocAdminIndex_ === 'function') ? getAdhocAdminIndex_(false)[targetEmail] : null;
  var isTargetAdmin = isTargetSuperAdmin || (targetAccount && String(targetAccount.role || '').toUpperCase() === 'ADMIN');
  var isProtectedAdmin = (typeof accessGrantProtected_ === 'function') && accessGrantProtected_(targetEmail);

  // Check Access Grants sheet
  var grantRows = (typeof accessGrantRows_ === 'function') ? accessGrantRows_() : [];
  var targetGrant = grantRows.find(function(g) {
    return g.email === targetEmail && g.profile !== 'DELETED' && g.active;
  });

  // Check Hub Access Requests sheet for historical and approved/pending roles per hub
  var reqRows = readHubRequestRows_();
  var reqMap = {};
  var pendingRequests = [];
  reqRows.forEach(function(r) {
    if (r.email !== targetEmail) return;
    if (r.status === 'PENDING') {
      pendingRequests.push({
        requestId: r.requestId,
        hubCode: r.hubCode,
        hubName: r.hubName,
        roleName: r.roleName,
        includeKpi: r.includeKpi,
        createdAt: r.createdAt
      });
    } else if (r.status === 'APPROVED' || r.status === 'REVOKED') {
      var k = String(r.hubCode);
      if (!reqMap[k] || String(r.reviewedAt || r.createdAt) > String(reqMap[k].reviewedAt || reqMap[k].createdAt)) {
        reqMap[k] = r;
      }
    }
  });

  var existingHubs = [];
  var existingHubSet = new Set();

  if (targetGrant && Array.isArray(targetGrant.hubCodes)) {
    targetGrant.hubCodes.forEach(function(code) {
      code = String(code);
      existingHubSet.add(code);
      var station = stationMap[code] || {};
      var req = reqMap[code];
      var isAllPages = (targetGrant.pages && targetGrant.pages.length === ACCESS_GRANT_CFG.pages.length);
      var roleName = req ? req.roleName : (isAllPages ? 'All Permissions' : (targetGrant.profile || 'Custom'));
      var includeKpi = req ? req.includeKpi : (targetGrant.pages || []).indexOf('kpi') !== -1;
      var hType = isFmHub_(station.hubCode ? station : { hubCode: code, hubName: station.hubName || code });
      existingHubs.push({
        hubCode: code,
        hubName: station.hubName || (req ? req.hubName : code),
        hubType: hType ? 'FM' : 'LM',
        zone: station.zone || '',
        roleName: roleName,
        includeKpi: includeKpi,
        pages: targetGrant.pages || [],
        isAllPages: isAllPages,
        pageCount: (targetGrant.pages || []).length,
        source: 'Access Grants',
        grantedBy: req ? req.reviewedBy : targetGrant.updatedBy,
        grantedAt: req ? (req.reviewedAt || req.createdAt) : targetGrant.updatedAt
      });
    });
  }

  // Also check Permission sheet mapping (e.g. Lead, SUP, AOM) if not in Access Grants
  var permUser = (permission.users || {})[targetEmail];
  var permRank = permUser ? permUser.rank : '';
  if (permUser && Array.isArray(permUser.hubCodes)) {
    permUser.hubCodes.forEach(function(code) {
      code = String(code);
      if (!existingHubSet.has(code)) {
        existingHubSet.add(code);
        var station = stationMap[code] || {};
        var hTypePerm = isFmHub_(station.hubCode ? station : { hubCode: code, hubName: station.hubName || code });
        existingHubs.push({
          hubCode: code,
          hubName: station.hubName || code,
          hubType: hTypePerm ? 'FM' : 'LM',
          zone: station.zone || '',
          roleName: permUser.role || permUser.rank || 'LEAD',
          includeKpi: true,
          pages: ACCESS_GRANT_CFG.pages.slice(),
          isAllPages: true,
          pageCount: ACCESS_GRANT_CFG.pages.length,
          source: 'Permission Sheet (' + (permUser.rank || permUser.role) + ')',
          grantedBy: 'System Mapping',
          grantedAt: ''
        });
      }
    });
  }

  return {
    ok: true,
    email: targetEmail,
    displayName: (targetGrant && targetGrant.displayName) || (targetAccount && targetAccount.displayName) || (permUser && permUser.name) || displayNameFromEmail_(targetEmail),
    isAdmin: isTargetAdmin,
    isProtectedAdmin: isProtectedAdmin,
    rank: permRank || (isTargetAdmin ? 'ADMIN' : (targetAccount ? targetAccount.role : 'USER')),
    existingHubs: existingHubs,
    existingHubCodes: Array.from(existingHubSet),
    pendingRequests: pendingRequests,
    grantPages: (targetGrant && targetGrant.pages) || []
  };
}
var hubAccessCheckUser_ = checkUserHubAccess;

/**
 * Endpoint: Submit a new request for Hub access.
 * Note: Role names can be identical across different hubs, because
 * one hub may include KPI while another hub does not.
 */
function submitHubAccessRequest(payload) {
  var access = requireAccess_();
  payload = payload || {};
  var email = access.email;
  var displayName = cleanText_(payload.displayName || access.displayName, 120);
  var rawHubCodes = Array.isArray(payload.hubCodes)
    ? payload.hubCodes.map(String).map(function(c) { return c.trim(); }).filter(Boolean)
    : (payload.hubCode ? [String(payload.hubCode).trim()] : []);
  rawHubCodes = Array.from(new Set(rawHubCodes));

  var permType = String(payload.permType || '').toUpperCase();
  var rawPages = Array.isArray(payload.pages) ? payload.pages : null;
  var roleInput = cleanText_(payload.customRole || payload.roleName || '', 60);
  var includeKpi = payload.includeKpi === true || String(payload.includeKpi).toLowerCase() === 'true';
  var note = cleanText_(payload.note || '', 500);

  var targetPages = [];
  var roleName = '';
  if (permType === 'ALL' || roleInput === 'ALL' || roleInput === 'All Permissions' || roleInput === 'Tất cả quyền') {
    targetPages = ACCESS_GRANT_CFG.pages.slice();
    roleName = 'All Permissions';
    includeKpi = true;
  } else if (permType === 'FM' || roleInput === 'FM' || roleInput === 'First Mile Operator (FM)') {
    targetPages = ['backlog', 'backlog_fm', 'd0', 'dashboard', 'kpi'];
    roleName = roleInput && roleInput !== 'FM' ? roleInput : 'First Mile Operator (FM)';
    includeKpi = true;
  } else if (permType === 'LM' || roleInput === 'LM' || roleInput === 'Last Mile Operator (LM)') {
    targetPages = ['backlog', 'backlog_lm', 'alerts', 'pickup', 'd0', 'dashboard', 'kpi'];
    roleName = roleInput && roleInput !== 'LM' ? roleInput : 'Last Mile Operator (LM)';
    includeKpi = true;
  } else if (rawPages && rawPages.length > 0) {
    targetPages = rawPages.filter(function(p) { return ACCESS_GRANT_CFG.pages.indexOf(p) !== -1; });
    if (targetPages.indexOf('backlog_fm') !== -1 || targetPages.indexOf('backlog_lm') !== -1) {
      if (targetPages.indexOf('backlog') === -1) targetPages.push('backlog');
    }
    includeKpi = targetPages.indexOf('kpi') !== -1;
    roleName = roleInput && roleInput !== 'CUSTOM' ? roleInput : ('Custom (' + targetPages.length + ' permissions)');
  } else {
    targetPages = includeKpi ? ['dashboard', 'd0', 'kpi'] : ['dashboard', 'd0'];
    roleName = roleInput || 'All Permissions';
  }

  if (!email) throw Error('EMAIL_REQUIRED');
  if (!rawHubCodes.length) throw Error('Vui lòng chọn ít nhất một Hub cần xin cấp quyền.');
  if (!roleName) throw Error('Vui lòng nhập tên quyền muốn xin cấp.');

  var permission = getPermissionModel_(false);
  var allStations = permission.stations || [];
  var validStations = allStations.filter(function(s) {
    return rawHubCodes.indexOf(String(s.hubCode)) !== -1;
  });
  if (!validStations.length) throw Error('HUB_NOT_FOUND: Hub không hợp lệ.');

  var rows = readHubRequestRows_();
  var sheet = getHubRequestSheet_();
  var now = new Date().toISOString();
  var lastReqId = '';
  var requestIds = [];
  var submittedCount = 0;

  validStations.forEach(function(station) {
    var hCode = String(station.hubCode);
    var existingPending = rows.find(function(r) {
      return r.email === email &&
             r.hubCode === hCode &&
             r.roleName.toLowerCase() === roleName.toLowerCase() &&
             r.includeKpi === includeKpi &&
             r.status === 'PENDING';
    });
    if (!existingPending) {
      var reqId = 'REQ-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      lastReqId = reqId;
      requestIds.push(reqId);
      var newRow = [
        reqId,
        email,
        displayName,
        hCode,
        station.hubName,
        roleName,
        includeKpi,
        'PENDING',
        note,
        now,
        '',
        '',
        ''
      ];
      sheet.appendRow(newRow);
      submittedCount++;
    }
  });

  SpreadsheetApp.flush();

  if (submittedCount === 0) {
    throw Error('Các yêu cầu cho các Hub đã chọn đang chờ duyệt, không cần gửi lại.');
  }

  var msg = validStations.length === 1
    ? 'Yêu cầu xin cấp quyền Hub ' + validStations[0].hubName + ' đã được gửi đến AOM phụ trách/Admin duyệt.'
    : 'Đã gửi yêu cầu xin cấp quyền cho ' + submittedCount + ' Hubs đến AOM phụ trách/Admin duyệt.';

  return {
    ok: true,
    requestId: lastReqId,
    requestIds: requestIds,
    message: msg
  };
}

/**
 * Endpoint: Review (Approve or Reject) a Hub access request.
 * Enforces that AOM can only approve requests for Hubs they manage.
 */
function reviewHubAccessRequest(payload) {
  var reviewer = requireAccess_();
  payload = payload || {};
  var requestId = String(payload.requestId || '').trim();
  var action = String(payload.action || '').toUpperCase();
  var rejectionReason = cleanText_(payload.rejectionReason || '', 500);

  if (!requestId) throw Error('REQUEST_ID_REQUIRED');
  if (action !== 'APPROVE' && action !== 'REJECT') throw Error('INVALID_ACTION');

  var sheet = getHubRequestSheet_();
  var rows = readHubRequestRows_();
  var request = rows.find(function(r) { return r.requestId === requestId; });
  if (!request) throw Error('REQUEST_NOT_FOUND: Không tìm thấy yêu cầu.');
  if (request.status !== 'PENDING') throw Error('REQUEST_ALREADY_REVIEWED: Yêu cầu này đã được xử lý (' + request.status + ').');

  var permission = getPermissionModel_(false);
  var isAdmin = reviewer.isAdmin || reviewer.rank === 'ADMIN';
  var managedHubs = getAomManagedHubCodes_(reviewer.email, permission);

  if (!isAdmin && managedHubs.indexOf(request.hubCode) === -1) {
    throw Error('NOT_AUTHORIZED: Bạn không quản lý Hub ' + request.hubName + ' (' + request.hubCode + '). Chỉ AOM quản lý Hub này hoặc Admin mới có quyền duyệt.');
  }

  var now = new Date().toISOString();

  if (action === 'APPROVE') {
    // 1. Update request status to APPROVED
    sheet.getRange(request.rowNumber, 8, 1, 4).setValues([[
      'APPROVED',
      request.note,
      request.createdAt,
      reviewer.email
    ]]);
    sheet.getRange(request.rowNumber, 12, 1, 1).setValue(now);

    // 2. Grant actual access to user in 'Access Grants' (if not an Admin protected account)
    if (typeof accessGrantProtected_ === 'function' && !accessGrantProtected_(request.email)) {
      var grantSheet = getDb_().getSheetByName(ACCESS_GRANT_CFG.sheet);
      if (!grantSheet) {
        grantSheet = getDb_().insertSheet(ACCESS_GRANT_CFG.sheet);
        grantSheet.getRange(1, 1, 1, ACCESS_GRANT_CFG.headers.length).setValues([ACCESS_GRANT_CFG.headers.slice()]);
      }
      var grants = accessGrantRows_();
      var existingGrant = grants.find(function(g) { return g.email === request.email; });

      var targetPages = [];
      if (request.roleName === 'ALL' || request.roleName === 'All Permissions' || request.roleName === 'Tất cả quyền') {
        targetPages = ACCESS_GRANT_CFG.pages.slice();
      } else if (request.roleName === 'FM' || request.roleName === 'First Mile Operator (FM)') {
        targetPages = ['backlog', 'd0', 'dashboard', 'kpi'];
      } else if (request.roleName === 'LM' || request.roleName === 'Last Mile Operator (LM)') {
        targetPages = ['alerts', 'pickup', 'd0', 'dashboard', 'kpi'];
      } else {
        targetPages = ['dashboard', 'd0'];
        if (request.includeKpi) {
          targetPages.push('kpi');
        }
      }

      if (existingGrant) {
        var hubCodes = Array.from(new Set(existingGrant.hubCodes.concat([request.hubCode])));
        var isAll = (request.roleName === 'All Permissions' || request.roleName === 'ALL' || request.roleName === 'Tất cả quyền');
        var mergedPages = isAll
          ? ACCESS_GRANT_CFG.pages.slice()
          : Array.from(new Set(existingGrant.pages.concat(targetPages)));
        var note = existingGrant.note || '';
        if (note) note += ' | ';
        note += 'Thêm Hub ' + request.hubName + ' (' + request.roleName + (request.includeKpi ? ' + KPI' : ' - không KPI') + ') duyệt bởi ' + reviewer.email;

        var cleanGrant = accessGrantClean_({
          email: existingGrant.email,
          displayName: existingGrant.displayName || request.displayName,
          profile: existingGrant.profile === 'DELETED' ? 'CUSTOM' : existingGrant.profile,
          active: true,
          hubCodes: hubCodes,
          pages: mergedPages,
          note: note,
          revision: existingGrant.revision
        });
        accessGrantWrite_(cleanGrant, reviewer, cleanGrant.revision);
      } else {
        var newGrantClean = accessGrantClean_({
          email: request.email,
          displayName: request.displayName,
          profile: 'CUSTOM',
          active: true,
          hubCodes: [request.hubCode],
          pages: targetPages,
          note: 'Duyệt bởi ' + reviewer.email + ' cho Hub ' + request.hubName + ' (' + request.roleName + (request.includeKpi ? ' + KPI' : ' - không KPI') + ')',
          revision: ''
        });
        accessGrantWrite_(newGrantClean, reviewer, '');
      }
      SpreadsheetApp.flush();
      clearSecurityCaches_();
    }
    return {
      ok: true,
      requestId: requestId,
      status: 'APPROVED',
      message: 'Đã duyệt yêu cầu thành công và cấp quyền cho ' + request.email + ' vào Hub ' + request.hubName + '.'
    };
  } else {
    // REJECT
    sheet.getRange(request.rowNumber, 8, 1, 6).setValues([[
      'REJECTED',
      request.note,
      request.createdAt,
      reviewer.email,
      now,
      rejectionReason || 'Từ chối bởi AOM/Admin'
    ]]);
    SpreadsheetApp.flush();
    return {
      ok: true,
      requestId: requestId,
      status: 'REJECTED',
      message: 'Đã từ chối yêu cầu của ' + request.email + '.'
    };
  }
}

/**
 * Endpoint: Cancel applicant's own pending request.
 */
function cancelHubAccessRequest(payload) {
  var access = requireAccess_();
  payload = payload || {};
  var requestId = String(payload.requestId || '').trim();
  if (!requestId) throw Error('REQUEST_ID_REQUIRED');

  var sheet = getHubRequestSheet_();
  var rows = readHubRequestRows_();
  var request = rows.find(function(r) { return r.requestId === requestId; });
  if (!request) throw Error('REQUEST_NOT_FOUND');
  if (request.email !== access.email && !access.isAdmin && access.rank !== 'ADMIN') {
    throw Error('NOT_AUTHORIZED: Bạn chỉ có thể huỷ yêu cầu của chính mình.');
  }
  if (request.status !== 'PENDING') throw Error('REQUEST_ALREADY_REVIEWED: Không thể huỷ yêu cầu đã được xử lý.');

  var now = new Date().toISOString();
  sheet.getRange(request.rowNumber, 8, 1, 6).setValues([[
    'CANCELLED',
    request.note,
    request.createdAt,
    access.email,
    now,
    'Người dùng tự huỷ yêu cầu'
  ]]);
  SpreadsheetApp.flush();

  return {
    ok: true,
    requestId: requestId,
    status: 'CANCELLED',
    message: 'Đã huỷ yêu cầu thành công.'
  };
}

/**
 * Endpoint: Directly grant Hub access to a user by an AOM (or Admin).
 * Enforces that AOM can only grant access to Hubs they manage.
 * Supports identical role names across different hubs (e.g. LEAD with KPI in Hub A, LEAD without KPI in Hub B).
 */
function aomGrantHubAccess(payload) {
  var caller = requireAccess_();
  payload = payload || {};
  var targetEmail = normalizeEmail_(payload.targetEmail);
  var displayName = cleanText_(payload.displayName || '', 120);
  var rawHubCodes = Array.isArray(payload.hubCodes)
    ? payload.hubCodes.map(String).map(function(c) { return c.trim(); }).filter(Boolean)
    : (payload.hubCode ? [String(payload.hubCode).trim()] : []);
  rawHubCodes = Array.from(new Set(rawHubCodes));

  var permType = String(payload.permType || '').toUpperCase();
  var rawPages = Array.isArray(payload.pages) ? payload.pages : null;
  var roleInput = cleanText_(payload.customRole || payload.roleName || '', 60);
  var includeKpi = payload.includeKpi === true || String(payload.includeKpi).toLowerCase() === 'true';
  var note = cleanText_(payload.note || '', 500);

  if (['','ALL','OPERATIONS_VIEWER','HUB_VIEWER','FM','LM','CUSTOM'].indexOf(permType) === -1) throw Error('INVALID_ACCESS_PROFILE');
  if (permType === 'CUSTOM' && (!rawPages || !rawPages.length || rawPages.some(function(p) { return ACCESS_GRANT_CFG.pages.indexOf(p) === -1; }))) throw Error('Select valid viewing permissions.');
  var targetPages = [];
  var roleName = '';
  if (permType === 'ALL' || permType === 'OPERATIONS_VIEWER' || (!permType && (roleInput === 'ALL' || roleInput === 'All Permissions' || roleInput === 'Tất cả quyền'))) {
    targetPages = ACCESS_GRANT_CFG.pages.slice();
    roleName = 'All Permissions';
    includeKpi = true;
  } else if (permType === 'HUB_VIEWER') {
    targetPages = ['dashboard', 'kpi', 'd0'];
    roleName = 'HUB viewer';
    includeKpi = true;
  } else if (permType === 'FM' || (!permType && roleInput === 'FM') || (!permType && roleInput === 'First Mile Operator (FM)')) {
    targetPages = ['backlog', 'backlog_fm', 'd0', 'dashboard', 'kpi'];
    roleName = roleInput && roleInput !== 'FM' ? roleInput : 'First Mile Operator (FM)';
    includeKpi = true;
  } else if (permType === 'LM' || (!permType && (roleInput === 'LM' || roleInput === 'Last Mile Operator (LM)'))) {
    targetPages = ['backlog', 'backlog_lm', 'alerts', 'pickup', 'd0', 'dashboard', 'kpi'];
    roleName = roleInput && roleInput !== 'LM' ? roleInput : 'Last Mile Operator (LM)';
    includeKpi = true;
  } else if (rawPages && rawPages.length > 0) {
    targetPages = rawPages.filter(function(p) { return ACCESS_GRANT_CFG.pages.indexOf(p) !== -1; });
    includeKpi = targetPages.indexOf('kpi') !== -1;
    roleName = roleInput && roleInput !== 'CUSTOM' ? roleInput : ('Custom (' + targetPages.length + ' permissions)');
  } else {
    targetPages = includeKpi ? ['dashboard', 'd0', 'kpi'] : ['dashboard', 'd0'];
    roleName = roleInput || 'All Permissions';
  }

  if (!targetEmail || !isValidEmail_(targetEmail)) {
    throw Error('Vui lòng nhập địa chỉ email hợp lệ của nhân sự.');
  }
  if (!rawHubCodes.length) {
    throw Error('Vui lòng chọn ít nhất một Hub cần cấp quyền.');
  }
  if (!roleName) {
    throw Error('Vui lòng chọn hoặc nhập quyền cấp cho nhân sự.');
  }

  var permission = getPermissionModel_(false);
  var isAdmin = caller.isAdmin || caller.rank === 'ADMIN';
  var managedHubCodes = isAdmin
    ? (permission.stations || []).map(function(s) { return String(s.hubCode); })
    : getAomManagedHubCodes_(caller.email, permission);

  var unauthorizedHubs = rawHubCodes.filter(function(code) {
    return !isAdmin && managedHubCodes.indexOf(code) === -1;
  });
  if (unauthorizedHubs.length > 0) {
    throw Error('NOT_AUTHORIZED: Bạn không quản lý một số Hub được chọn (' + unauthorizedHubs.join(', ') + '). Chỉ AOM quản lý Hub hoặc Admin mới có quyền cấp.');
  }

  var allStations = permission.stations || [];
  var validStations = allStations.filter(function(s) {
    return rawHubCodes.indexOf(String(s.hubCode)) !== -1;
  });
  if (!validStations.length) {
    throw Error('HUB_NOT_FOUND: Hub không tồn tại trong hệ thống.');
  }

  var targetHubCodes = validStations.map(function(s) { return String(s.hubCode); });
  var hubNamesStr = validStations.map(function(s) { return s.hubName; }).join(', ');

  if (typeof accessGrantProtected_ === 'function' && accessGrantProtected_(targetEmail)) {
    throw Error('ADMIN_PROTECTED: Không thể cấp quyền tùy chỉnh cho tài khoản Admin hệ thống.');
  }

  var grantSheet = getDb_().getSheetByName(ACCESS_GRANT_CFG.sheet);
  if (!grantSheet) {
    grantSheet = getDb_().insertSheet(ACCESS_GRANT_CFG.sheet);
    grantSheet.getRange(1, 1, 1, ACCESS_GRANT_CFG.headers.length).setValues([ACCESS_GRANT_CFG.headers.slice()]);
  }

  var grants = accessGrantRows_();
  var existingGrant = grants.find(function(g) { return g.email === targetEmail; });

  if (!targetPages.length) {
    targetPages = includeKpi ? ['dashboard', 'd0', 'kpi'] : ['dashboard', 'd0'];
  }

  var grantNote = validStations.length === 1
    ? 'Cấp bởi AOM ' + caller.email + ' vào Hub ' + validStations[0].hubName + ' (' + roleName + (includeKpi ? ' + KPI' : ' - không KPI') + ')'
    : 'Cấp bởi AOM ' + caller.email + ' vào ' + validStations.length + ' Hub: ' + hubNamesStr + ' (' + roleName + (includeKpi ? ' + KPI' : ' - không KPI') + ')';
  if (note) grantNote += ' - ' + note;

  if (existingGrant) {
    var mergedHubCodes = Array.from(new Set(existingGrant.hubCodes.concat(targetHubCodes)));
    var isAll = permType === 'ALL' || permType === 'OPERATIONS_VIEWER' || (!permType && roleName === 'All Permissions');
    var mergedPages = isAll
      ? ACCESS_GRANT_CFG.pages.slice()
      : Array.from(new Set(existingGrant.pages.concat(targetPages)));
    var existingNote = existingGrant.note ? existingGrant.note + ' | ' + grantNote : grantNote;

    var cleanGrant = accessGrantClean_({
      email: existingGrant.email,
      displayName: displayName || existingGrant.displayName || displayNameFromEmail_(targetEmail),
      profile: existingGrant.profile === 'DELETED' ? 'CUSTOM' : existingGrant.profile,
      active: true,
      hubCodes: mergedHubCodes,
      pages: mergedPages,
      note: existingNote,
      revision: existingGrant.revision
    });
    accessGrantWrite_(cleanGrant, caller, cleanGrant.revision);
  } else {
    var newGrantClean = accessGrantClean_({
      email: targetEmail,
      displayName: displayName || displayNameFromEmail_(targetEmail),
      profile: permType === 'HUB_VIEWER' ? 'HUB_VIEWER' : (permType === 'ALL' || permType === 'OPERATIONS_VIEWER' ? 'OPERATIONS_VIEWER' : 'CUSTOM'),
      active: true,
      hubCodes: targetHubCodes,
      pages: targetPages,
      note: grantNote,
      revision: ''
    });
    accessGrantWrite_(newGrantClean, caller, '');
  }

  // Update or append in Hub Access Requests sheet for tracking & duplicate role support
  var now = new Date().toISOString();
  var reqSheet = getHubRequestSheet_();
  var rows = readHubRequestRows_();

  validStations.forEach(function(station) {
    var hCode = String(station.hubCode);
    var pendingReq = rows.find(function(r) {
      return r.email === targetEmail && r.hubCode === hCode && r.status === 'PENDING';
    });

    // Check if the user already has an approved grant on this hub to prevent losing higher permissions
    var existingApproved = rows.slice().reverse().find(function(r) {
      return r.email === targetEmail && r.hubCode === hCode && r.status === 'APPROVED';
    });

    var finalRole = roleName;
    var finalKpi = includeKpi;
    if (existingApproved) {
      // If previously granted All Permissions (or ALL), retain All Permissions so a smaller role doesn't downgrade
      if ((existingApproved.roleName === 'All Permissions' || existingApproved.roleName === 'ALL' || existingApproved.roleName === 'Tất cả quyền') && roleName !== 'All Permissions') {
        finalRole = 'All Permissions';
        finalKpi = true;
      } else if (existingApproved.includeKpi && !finalKpi) {
        finalKpi = true;
      }
    }

    if (pendingReq) {
      reqSheet.getRange(pendingReq.rowNumber, 6, 1, 6).setValues([[
        finalRole,
        finalKpi,
        'APPROVED',
        note || pendingReq.note,
        pendingReq.createdAt,
        caller.email
      ]]);
      reqSheet.getRange(pendingReq.rowNumber, 12, 1, 1).setValue(now);
    } else {
      var reqId = 'DIR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      var newRow = [
        reqId,
        targetEmail,
        displayName || displayNameFromEmail_(targetEmail),
        hCode,
        station.hubName,
        finalRole,
        finalKpi,
        'APPROVED',
        note || ('Cấp quyền trực tiếp bởi AOM ' + caller.email + (finalRole !== roleName ? ' [Tự động bảo lưu quyền cao hơn]' : '')),
        now,
        caller.email,
        now,
        ''
      ];
      reqSheet.appendRow(newRow);
    }
  });

  SpreadsheetApp.flush();
  clearSecurityCaches_();

  var returnMsg = validStations.length === 1
    ? 'Đã cấp quyền Hub ' + validStations[0].hubName + ' (' + roleName + (includeKpi ? ' + KPI' : ' - không KPI') + ') cho ' + targetEmail + ' thành công!'
    : 'Đã cấp quyền ' + validStations.length + ' Hubs (' + roleName + (includeKpi ? ' + KPI' : ' - không KPI') + ') cho ' + targetEmail + ' thành công!';

  return {
    ok: true,
    message: returnMsg
  };
}

/**
 * Endpoint: Revoke Hub access from a user for a specific Hub.
 * Enforces that AOM can only revoke access for Hubs they manage.
 */
function aomRevokeHubAccess(payload) {
  var caller = requireAccess_();
  payload = payload || {};
  var targetEmail = normalizeEmail_(payload.targetEmail);
  var hubCode = String(payload.hubCode || '').trim();

  if (!targetEmail) throw Error('TARGET_EMAIL_REQUIRED');
  if (!hubCode) throw Error('HUB_CODE_REQUIRED');

  var permission = getPermissionModel_(false);
  var isAdmin = caller.isAdmin || caller.rank === 'ADMIN';
  var managedHubCodes = isAdmin
    ? (permission.stations || []).map(function(s) { return String(s.hubCode); })
    : getAomManagedHubCodes_(caller.email, permission);

  if (!isAdmin && managedHubCodes.indexOf(hubCode) === -1) {
    throw Error('NOT_AUTHORIZED: Bạn không quản lý Hub này. Chỉ AOM quản lý Hub hoặc Admin mới có quyền thu hồi.');
  }

  var station = (permission.stations || []).find(function(s) { return String(s.hubCode) === hubCode; });
  var hubName = station ? station.hubName : hubCode;

  // 1. Remove hubCode from Access Grants
  var grants = accessGrantRows_();
  var targetGrant = grants.find(function(g) { return g.email === targetEmail; });
  if (targetGrant) {
    var newHubCodes = targetGrant.hubCodes.filter(function(c) { return String(c) !== hubCode; });
    if (newHubCodes.length === 0) {
      accessGrantWrite_({
        email: targetGrant.email,
        displayName: targetGrant.displayName,
        profile: 'DELETED',
        active: false,
        hubCodes: [],
        pages: [],
        note: (targetGrant.note || '') + ' | Đã thu hồi quyền Hub ' + hubName + ' bởi AOM ' + caller.email
      }, caller, targetGrant.revision);
    } else {
      var cleanGrant = accessGrantClean_({
        email: targetGrant.email,
        displayName: targetGrant.displayName,
        profile: targetGrant.profile === 'DELETED' ? 'CUSTOM' : targetGrant.profile,
        active: targetGrant.active,
        hubCodes: newHubCodes,
        pages: targetGrant.pages,
        note: (targetGrant.note || '') + ' | Thu hồi Hub ' + hubName + ' bởi AOM ' + caller.email,
        revision: targetGrant.revision
      });
      accessGrantWrite_(cleanGrant, caller, targetGrant.revision);
    }
  }

  // 2. Update Hub Access Requests status to REVOKED
  var reqSheet = getHubRequestSheet_();
  var rows = readHubRequestRows_();
  var now = new Date().toISOString();
  rows.forEach(function(r) {
    if (r.email === targetEmail && r.hubCode === hubCode && r.status === 'APPROVED') {
      reqSheet.getRange(r.rowNumber, 8, 1, 6).setValues([[
        'REVOKED',
        r.note,
        r.createdAt,
        caller.email,
        now,
        'Thu hồi quyền bởi AOM ' + caller.email
      ]]);
    }
  });

  SpreadsheetApp.flush();
  clearSecurityCaches_();

  return {
    ok: true,
    message: 'Đã thu hồi quyền truy cập Hub ' + hubName + ' của ' + targetEmail + '.'
  };
}
