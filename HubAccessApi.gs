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
      saom: s.saom || []
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
        managedGrants.push({
          email: g.email,
          displayName: g.displayName || (matchedReq ? matchedReq.displayName : ''),
          hubCode: code,
          hubName: stationMap[code] || (matchedReq ? matchedReq.hubName : code),
          roleName: matchedReq ? matchedReq.roleName : (g.profile || 'HUB_VIEWER'),
          includeKpi: matchedReq ? matchedReq.includeKpi : (g.pages || []).indexOf('kpi') !== -1,
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
      { id: 'HUB_VIEWER', name: 'HUB Viewer (Xem vận hành Hub)' },
      { id: 'LEAD', name: 'HUB Lead (Trưởng nhóm Hub)' },
      { id: 'DISPATCHER', name: 'Dispatcher (Điều phối viên)' },
      { id: 'OPERATOR', name: 'Operator (Vận hành viên)' },
      { id: 'CUSTOM', name: 'Tuỳ chỉnh khác' }
    ]
  };
}

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
  var hubCode = String(payload.hubCode || '').trim();
  var roleName = cleanText_(payload.roleName || 'HUB_VIEWER', 60);
  var includeKpi = payload.includeKpi === true || String(payload.includeKpi).toLowerCase() === 'true';
  var note = cleanText_(payload.note || '', 500);

  if (!email) throw Error('EMAIL_REQUIRED');
  if (!hubCode) throw Error('Vui lòng chọn Hub cần xin cấp quyền.');
  if (!roleName) throw Error('Vui lòng nhập tên quyền muốn xin cấp.');

  var permission = getPermissionModel_(false);
  var station = (permission.stations || []).find(function(s) { return String(s.hubCode) === hubCode; });
  if (!station) throw Error('HUB_NOT_FOUND: Hub không hợp lệ.');

  var rows = readHubRequestRows_();
  var existingPending = rows.find(function(r) {
    return r.email === email &&
           r.hubCode === hubCode &&
           r.roleName.toLowerCase() === roleName.toLowerCase() &&
           r.includeKpi === includeKpi &&
           r.status === 'PENDING';
  });
  if (existingPending) {
    throw Error('Yêu cầu cho Hub này (' + roleName + (includeKpi ? ' + KPI' : ' - không KPI') + ') đang chờ AOM duyệt, không cần gửi lại.');
  }

  var sheet = getHubRequestSheet_();
  var requestId = 'REQ-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  var now = new Date().toISOString();

  var newRow = [
    requestId,
    email,
    displayName,
    hubCode,
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
  SpreadsheetApp.flush();

  return {
    ok: true,
    requestId: requestId,
    message: 'Yêu cầu xin cấp quyền Hub ' + station.hubName + ' đã được gửi đến AOM phụ trách/Admin duyệt.'
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

      var targetPages = ['dashboard', 'd0'];
      if (request.includeKpi) {
        targetPages.push('kpi');
      }

      if (existingGrant) {
        var hubCodes = Array.from(new Set(existingGrant.hubCodes.concat([request.hubCode])));
        var mergedPages = Array.from(new Set(existingGrant.pages.concat(targetPages)));
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
  var hubCode = String(payload.hubCode || '').trim();
  var roleName = cleanText_(payload.roleName || 'HUB_VIEWER', 60);
  var includeKpi = payload.includeKpi === true || String(payload.includeKpi).toLowerCase() === 'true';
  var note = cleanText_(payload.note || '', 500);

  if (!targetEmail || !isValidEmail_(targetEmail)) {
    throw Error('Vui lòng nhập địa chỉ email hợp lệ của nhân sự.');
  }
  if (!hubCode) {
    throw Error('Vui lòng chọn Hub cần cấp quyền.');
  }
  if (!roleName) {
    throw Error('Vui lòng nhập tên quyền (Role) cấp cho nhân sự.');
  }

  var permission = getPermissionModel_(false);
  var isAdmin = caller.isAdmin || caller.rank === 'ADMIN';
  var managedHubCodes = isAdmin
    ? (permission.stations || []).map(function(s) { return String(s.hubCode); })
    : getAomManagedHubCodes_(caller.email, permission);

  if (!isAdmin && managedHubCodes.indexOf(hubCode) === -1) {
    throw Error('NOT_AUTHORIZED: Bạn không quản lý Hub này. Chỉ AOM quản lý Hub hoặc Admin mới có quyền cấp.');
  }

  var station = (permission.stations || []).find(function(s) { return String(s.hubCode) === hubCode; });
  if (!station) {
    throw Error('HUB_NOT_FOUND: Hub không tồn tại trong hệ thống.');
  }

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

  var targetPages = ['dashboard', 'd0'];
  if (includeKpi) {
    targetPages.push('kpi');
  }

  var grantNote = 'Cấp bởi AOM ' + caller.email + ' vào Hub ' + station.hubName + ' (' + roleName + (includeKpi ? ' + KPI' : ' - không KPI') + ')';
  if (note) grantNote += ' - ' + note;

  if (existingGrant) {
    var hubCodes = Array.from(new Set(existingGrant.hubCodes.concat([hubCode])));
    var mergedPages = Array.from(new Set(existingGrant.pages.concat(targetPages)));
    var existingNote = existingGrant.note ? existingGrant.note + ' | ' + grantNote : grantNote;

    var cleanGrant = accessGrantClean_({
      email: existingGrant.email,
      displayName: displayName || existingGrant.displayName || displayNameFromEmail_(targetEmail),
      profile: existingGrant.profile === 'DELETED' ? 'CUSTOM' : existingGrant.profile,
      active: true,
      hubCodes: hubCodes,
      pages: mergedPages,
      note: existingNote,
      revision: existingGrant.revision
    });
    accessGrantWrite_(cleanGrant, caller, cleanGrant.revision);
  } else {
    var newGrantClean = accessGrantClean_({
      email: targetEmail,
      displayName: displayName || displayNameFromEmail_(targetEmail),
      profile: 'CUSTOM',
      active: true,
      hubCodes: [hubCode],
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
  var pendingReq = rows.find(function(r) {
    return r.email === targetEmail && r.hubCode === hubCode && r.status === 'PENDING';
  });

  if (pendingReq) {
    reqSheet.getRange(pendingReq.rowNumber, 6, 1, 6).setValues([[
      roleName,
      includeKpi,
      'APPROVED',
      note || pendingReq.note,
      pendingReq.createdAt,
      caller.email
    ]]);
    reqSheet.getRange(pendingReq.rowNumber, 12, 1, 1).setValue(now);
  } else {
    var reqId = 'DIR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    reqSheet.appendRow([
      reqId,
      targetEmail,
      displayName || displayNameFromEmail_(targetEmail),
      hubCode,
      station.hubName,
      roleName,
      includeKpi,
      'APPROVED',
      note || ('Cấp quyền trực tiếp bởi AOM ' + caller.email),
      now,
      caller.email,
      now,
      ''
    ]);
  }

  SpreadsheetApp.flush();
  clearSecurityCaches_();

  return {
    ok: true,
    message: 'Đã cấp quyền Hub ' + station.hubName + ' (' + roleName + (includeKpi ? ' + KPI' : ' - không KPI') + ') cho ' + targetEmail + ' thành công!'
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
