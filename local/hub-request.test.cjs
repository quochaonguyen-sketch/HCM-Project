const { createRuntime } = require('./apps-script-runtime.cjs');
const assert = require('node:assert');

console.log('Testing Hub Access Request API...');
const app = createRuntime();

// 1. Get Init Data
const initData = app.call('getHubRequestInitData', []);
assert(initData.ok === true, 'Init data failed');
assert(Array.isArray(initData.hubs) && initData.hubs.length > 0, 'Hub catalog empty');
console.log('PASS: getHubRequestInitData returned', initData.hubs.length, 'hubs');

// 2. Submit Request 1: Hub 51HCM171 with role LEAD and KPI: true
const targetHub1 = initData.hubs.find(h => h.hubCode === '51HCM171');
assert(targetHub1, 'Target Hub 1 not found');
const res1 = app.call('submitHubAccessRequest', [{
  hubCode: targetHub1.hubCode,
  roleName: 'LEAD',
  includeKpi: true,
  note: 'Cần cấp quyền Lead có xem KPI để quản lý'
}]);
assert(res1.ok === true, 'Submit 1 failed');
console.log('PASS: Request 1 submitted:', res1.requestId);

// 3. Submit Request 2: Hub 51HCM158 with the SAME role name 'LEAD' and KPI: false
// Demonstrates that role names can collide/duplicate across hubs with different KPI settings!
const targetHub2 = initData.hubs.find(h => h.hubCode === '51HCM158');
assert(targetHub2, 'Target Hub 2 not found');
const res2 = app.call('submitHubAccessRequest', [{
  hubCode: targetHub2.hubCode,
  roleName: 'LEAD',
  includeKpi: false,
  note: 'Cần cấp quyền Lead phụ trách điều phối không KPI'
}]);
assert(res2.ok === true, 'Submit 2 failed');
console.log('PASS: Request 2 submitted with duplicate role name "LEAD":', res2.requestId);

// 4. Verify duplicate pending prevention for the same hub & kpi setting
let dupBlocked = false;
try {
  app.call('submitHubAccessRequest', [{
    hubCode: targetHub1.hubCode,
    roleName: 'LEAD',
    includeKpi: true,
    note: 'Thử gửi lại cùng Hub và role'
  }]);
} catch (err) {
  dupBlocked = true;
}
assert(dupBlocked, 'Duplicate pending request should have thrown an error');
console.log('PASS: Duplicate pending request correctly prevented');

// 5. Test Review: Approve Request 1
const reviewRes1 = app.call('reviewHubAccessRequest', [{
  requestId: res1.requestId,
  action: 'APPROVE'
}]);
assert(reviewRes1.ok === true && reviewRes1.status === 'APPROVED', 'Approve 1 failed');
console.log('PASS: Request 1 approved successfully');

// 6. Test Review: Reject Request 2
const reviewRes2 = app.call('reviewHubAccessRequest', [{
  requestId: res2.requestId,
  action: 'REJECT',
  rejectionReason: 'Hiện tại chưa cần mở thêm quyền cho Hub này'
}]);
assert(reviewRes2.ok === true && reviewRes2.status === 'REJECTED', 'Reject 2 failed');
console.log('PASS: Request 2 rejected successfully with reason');

// 7. Test non-admin user request & actual Access Grants insertion
const db = app.context.SpreadsheetApp.openById('frontend');
const reqSheet = db.getSheetByName('Hub Access Requests');
const nonAdminEmail = 'user.nv@spxexpress.com';
const testReqId = 'REQ-TEST-NONADMIN-' + Date.now();
reqSheet.appendRow([
  testReqId,
  nonAdminEmail,
  'Nguyen Van A',
  targetHub1.hubCode,
  targetHub1.hubName,
  'HUB_VIEWER',
  true,
  'PENDING',
  'Xin vao hub co KPI',
  new Date().toISOString(),
  '',
  '',
  ''
]);

const reviewNonAdmin = app.call('reviewHubAccessRequest', [{
  requestId: testReqId,
  action: 'APPROVE'
}]);
assert(reviewNonAdmin.ok === true && reviewNonAdmin.status === 'APPROVED', 'Approve non-admin failed');

// Check Access Grants
const grantRows = app.context.accessGrantRows_();
const grant = grantRows.find(g => g.email === nonAdminEmail);
assert(grant, 'Grant for non-admin should be created in Access Grants');
assert(grant.hubCodes.includes(targetHub1.hubCode), 'Grant should include target hub code');
assert(grant.pages.includes('kpi'), 'Grant should include kpi page');
assert(grant.active === true, 'Grant should be active');
console.log('PASS: Non-admin request approved and grant successfully created in Access Grants with KPI:', grant.email, grant.hubCodes, grant.pages);

// 8. Check Init Data reflects updated status
const afterData = app.call('getHubRequestInitData', []);
const req1 = afterData.myRequests.find(r => r.requestId === res1.requestId);
const req2 = afterData.myRequests.find(r => r.requestId === res2.requestId);
assert(req1 && req1.status === 'APPROVED', 'Request 1 status should be APPROVED');
assert(req2 && req2.status === 'REJECTED', 'Request 2 status should be REJECTED');
console.log('PASS: History records reflect APPROVED and REJECTED statuses');

// 9. Test AOM Direct Granting (aomGrantHubAccess)
console.log('Testing AOM Direct Granting...');
const directUserEmail = 'direct.rider@spxexpress.com';

// 9a. Direct grant Hub 1 with role LEAD and KPI: true
const grantRes1 = app.call('aomGrantHubAccess', [{
  targetEmail: directUserEmail,
  displayName: 'Direct User Rider',
  hubCode: targetHub1.hubCode,
  roleName: 'LEAD',
  includeKpi: true,
  note: 'AOM trực tiếp cấp quyền Lead có KPI'
}]);
assert(grantRes1.ok === true, 'Direct grant 1 failed');
console.log('PASS: AOM direct grant 1 succeeded:', grantRes1.message);

// 9b. Direct grant Hub 2 with DUPLICATE role LEAD and KPI: false
const grantRes2 = app.call('aomGrantHubAccess', [{
  targetEmail: directUserEmail,
  displayName: 'Direct User Rider',
  hubCode: targetHub2.hubCode,
  roleName: 'LEAD',
  includeKpi: false,
  note: 'AOM trực tiếp cấp thêm Hub 2 với quyền LEAD không KPI'
}]);
assert(grantRes2.ok === true, 'Direct grant 2 failed');
console.log('PASS: AOM direct grant 2 with duplicate role name succeeded:', grantRes2.message);

// 9c. Verify in Access Grants and managedGrants
const initDataAfterDirect = app.call('getHubRequestInitData', []);
const userGrants = initDataAfterDirect.managedGrants.filter(g => g.email === directUserEmail);
assert(userGrants.length === 2, 'User should have 2 active hub grants');
const g1 = userGrants.find(g => g.hubCode === targetHub1.hubCode);
const g2 = userGrants.find(g => g.hubCode === targetHub2.hubCode);
assert(g1 && g1.roleName === 'LEAD' && g1.includeKpi === true, 'Grant 1 should be LEAD with KPI');
assert(g2 && g2.roleName === 'LEAD' && g2.includeKpi === false, 'Grant 2 should be LEAD without KPI');
console.log('PASS: Duplicate role name across hubs with different KPI settings verified in managedGrants!');

// 10. Test AOM Revoke Access (aomRevokeHubAccess)
console.log('Testing AOM Revoke Access...');
const revokeRes = app.call('aomRevokeHubAccess', [{
  targetEmail: directUserEmail,
  hubCode: targetHub2.hubCode
}]);
assert(revokeRes.ok === true, 'Revoke Hub 2 failed');
console.log('PASS: AOM revoke Hub 2 succeeded:', revokeRes.message);

const initDataAfterRevoke = app.call('getHubRequestInitData', []);
const userGrantsAfterRevoke = initDataAfterRevoke.managedGrants.filter(g => g.email === directUserEmail);
assert(userGrantsAfterRevoke.length === 1, 'User should now only have 1 active hub grant');
assert(userGrantsAfterRevoke[0].hubCode === targetHub1.hubCode, 'Remaining hub should be Hub 1');
console.log('PASS: Hub 2 revoked while Hub 1 remains intact!');

// 11. Test Direct Grant with permType: 'ALL' (Tất cả quyền)
console.log('Testing permType: ALL (Tất cả quyền)...');
const allPermEmail = 'allperms.user@spxexpress.com';
const grantAllRes = app.call('aomGrantHubAccess', [{
  targetEmail: allPermEmail,
  displayName: 'All Permissions User',
  hubCode: targetHub1.hubCode,
  permType: 'ALL',
  note: 'Cấp toàn quyền truy cập Hub'
}]);
assert(grantAllRes.ok === true, 'Grant ALL failed');
const grantsAfterAll = app.context.accessGrantRows_();
const allGrant = grantsAfterAll.find(g => g.email === allPermEmail);
assert(allGrant, 'Grant for ALL should exist');
assert(allGrant.pages.length === app.context.getAccessGrantSettings().pages.length, 'Grant for ALL should contain all catalog pages');
assert(allGrant.pages.includes('kpi') && allGrant.pages.includes('compensated') && allGrant.pages.includes('pickup') && allGrant.pages.includes('fte'), 'Grant should include all page keys including pickup & fte');
console.log('PASS: Direct grant with permType ALL granted all catalog pages (including Rider & FTE Resource) successfully!');

// 12. Test Direct Grant with permType: 'CUSTOM' (Lựa chọn từng quyền)
console.log('Testing permType: CUSTOM (Lựa chọn từng quyền)...');
const customPermEmail = 'custom.user@spxexpress.com';
const grantCustomRes = app.call('aomGrantHubAccess', [{
  targetEmail: customPermEmail,
  displayName: 'Custom Permissions User',
  hubCode: targetHub1.hubCode,
  permType: 'CUSTOM',
  pages: ['alerts', 'backlog'],
  customRole: 'Điều phối hàng hóa',
  note: 'Chỉ xem DTC và Backlog'
}]);
assert(grantCustomRes.ok === true, 'Grant CUSTOM failed');
const grantsAfterCustom = app.context.accessGrantRows_();
const customGrant = grantsAfterCustom.find(g => g.email === customPermEmail);
assert(customGrant, 'Grant for CUSTOM should exist');
assert(customGrant.pages.length === 2, 'Grant for CUSTOM should contain exactly 2 pages');
assert(customGrant.pages.includes('alerts') && customGrant.pages.includes('backlog'), 'Grant should include alerts & backlog');
assert(!customGrant.pages.includes('kpi'), 'Grant should NOT include kpi');
console.log('PASS: Direct grant with permType CUSTOM granted specific selected pages successfully!');

// 12b. Test Direct Grant with Rider & FTE Resource permissions
console.log('Testing permType: CUSTOM with Rider & FTE Resource...');
const peoplePermEmail = 'people.user@spxexpress.com';
const grantPeopleRes = app.call('aomGrantHubAccess', [{
  targetEmail: peoplePermEmail,
  displayName: 'People & HR User',
  hubCode: targetHub1.hubCode,
  permType: 'CUSTOM',
  pages: ['pickup', 'fte'],
  customRole: 'HR Dispatcher',
  note: 'Chỉ xem Rider và FTE Resource'
}]);
assert(grantPeopleRes.ok === true, 'Grant People CUSTOM failed');
const grantsAfterPeople = app.context.accessGrantRows_();
const peopleGrant = grantsAfterPeople.find(g => g.email === peoplePermEmail);
assert(peopleGrant, 'Grant for People user should exist');
assert(peopleGrant.pages.length === 2 && peopleGrant.pages.includes('pickup') && peopleGrant.pages.includes('fte'), 'Grant should include pickup & fte');
console.log('PASS: Direct grant with Rider & FTE Resource permissions succeeded!');

// 13. Test Multi-Hub Direct Granting (hubCodes array)
console.log('Testing Multi-Hub Direct Granting (hubCodes array)...');
const multiHubEmail = 'multihub.user@spxexpress.com';
const grantMultiRes = app.call('aomGrantHubAccess', [{
  targetEmail: multiHubEmail,
  displayName: 'Multi Hub User',
  hubCodes: [targetHub1.hubCode, targetHub2.hubCode],
  permType: 'ALL',
  note: 'Cấp quyền vào nhiều Hub cùng lúc'
}]);
assert(grantMultiRes.ok === true, 'Multi-hub grant failed');
const grantsAfterMulti = app.context.accessGrantRows_();
const multiGrant = grantsAfterMulti.find(g => g.email === multiHubEmail);
assert(multiGrant, 'Grant for Multi Hub user should exist');
assert(multiGrant.hubCodes.includes(targetHub1.hubCode) && multiGrant.hubCodes.includes(targetHub2.hubCode), 'User should have access to both hubs');
console.log('PASS: Multi-Hub direct grant granted access to both Hubs in single call:', multiGrant.hubCodes);

// 14. Test Multi-Hub Request Submission (submitHubAccessRequest with hubCodes array)
console.log('Testing Multi-Hub Request Submission...');
const existingPending = new Set(
  app.context.readHubRequestRows_()
    .filter(r => r.email === app.context.Session.getActiveUser().getEmail() && r.status === 'PENDING')
    .map(r => r.hubCode)
);
const testHubs = initData.hubs.filter(h => !existingPending.has(h.hubCode)).slice(0, 2);
assert(testHubs.length === 2, 'Should find 2 non-pending hubs for test');
const submitMultiRes = app.call('submitHubAccessRequest', [{
  hubCodes: [testHubs[0].hubCode, testHubs[1].hubCode],
  permType: 'ALL',
  note: 'Xin cấp quyền vào nhiều Hub cùng lúc'
}]);
assert(submitMultiRes.ok === true && Array.isArray(submitMultiRes.requestIds) && submitMultiRes.requestIds.length === 2, 'Multi-hub request submission failed');
console.log('PASS: Multi-Hub request submission created pending requests for both Hubs:', submitMultiRes.requestIds);

// 15. Test checkUserHubAccess API (Checking existing hubs & permissions)
console.log('Testing checkUserHubAccess (Check quyền hiện có theo email)...');
const checkRes = app.call('checkUserHubAccess', [allPermEmail]);
assert(checkRes.ok === true, 'checkUserHubAccess should return ok: true');
assert(checkRes.email === allPermEmail, 'Email should match');
assert(checkRes.existingHubs.length > 0, 'User should have existing hubs');
assert(checkRes.existingHubCodes.includes(targetHub1.hubCode), 'Should include target hub 1');
const hub1Info = checkRes.existingHubs.find(h => h.hubCode === targetHub1.hubCode);
assert(hub1Info.roleName === 'All Permissions', 'Hub 1 should have role All Permissions');
assert(hub1Info.includeKpi === true, 'Hub 1 should include KPI');
assert(hub1Info.pageCount === app.context.getAccessGrantSettings().pages.length, 'Hub 1 should have all catalog pages');
console.log('PASS: checkUserHubAccess verified existing hubs & permissions successfully:', hub1Info.hubName, hub1Info.roleName, hub1Info.pageCount, 'pages');

const checkNewRes = app.call('checkUserHubAccess', ['completely.new@spxexpress.com']);
assert(checkNewRes.ok === true && checkNewRes.existingHubs.length === 0, 'New user should have 0 existing hubs');
console.log('PASS: checkUserHubAccess correctly reports 0 hubs for new accounts');

// 16. Test Prevention of Overwriting with Smaller Permissions (Bảo lưu quyền khi cấp quyền nhỏ hơn)
console.log('Testing Prevention of Overwriting with Smaller Permissions (Bảo lưu quyền khi cấp nhỏ hơn)...');
const downgradeAttempt = app.call('aomGrantHubAccess', [{
  targetEmail: allPermEmail,
  hubCode: targetHub1.hubCode,
  permType: 'CUSTOM',
  pages: ['d0'],
  customRole: 'Only D0',
  includeKpi: false,
  note: 'Thử cấp quyền nhỏ hơn cho hub đã có All Permissions'
}]);
assert(downgradeAttempt.ok === true, 'Downgrade attempt call should succeed');
const grantAfterDowngrade = app.context.accessGrantRows_().find(g => g.email === allPermEmail);
assert(grantAfterDowngrade.pages.length === app.context.getAccessGrantSettings().pages.length, 'Access Grants should preserve all catalog pages (never downgrade)');
assert(grantAfterDowngrade.pages.includes('kpi'), 'KPI page should be preserved');
const afterReqs = app.context.readHubRequestRows_().filter(r => r.email === allPermEmail && r.hubCode === targetHub1.hubCode && r.status === 'APPROVED');
const latestApproved = afterReqs[afterReqs.length - 1];
assert(latestApproved.roleName === 'All Permissions', 'Role in Hub Access Requests should remain All Permissions');
assert(latestApproved.includeKpi === true, 'KPI should remain true');
console.log('PASS: Attempt to grant smaller permissions preserved all catalog pages and All Permissions role!');

// 17. Test FM vs LM Hub classification
console.log('Testing FM vs LM Hub classification...');
const fmHubs = initData.hubs.filter(h => h.hubType === 'FM');
const lmHubs = initData.hubs.filter(h => h.hubType === 'LM');
assert(fmHubs.length > 0, 'There should be at least 1 FM hub');
assert(lmHubs.length > 0, 'There should be LM hubs');
assert(fmHubs.every(h => h.hubCode.startsWith('54HCM') || h.hubName.includes('FM')), 'FM hubs must match FM pattern');
console.log('PASS: FM/LM classification verified. FM Hubs:', fmHubs.length, 'LM Hubs:', lmHubs.length);

// 18. Test permType: FM and permType: LM granting
console.log('Testing permType: FM and permType: LM...');
const fmEmail = 'fm.operator@spxexpress.com';
const lmEmail = 'lm.operator@spxexpress.com';

const grantFmRes = app.call('aomGrantHubAccess', [{
  targetEmail: fmEmail,
  displayName: 'FM Operator',
  hubCode: fmHubs[0].hubCode,
  permType: 'FM',
  note: 'Cấp bộ quyền First Mile'
}]);
assert(grantFmRes.ok === true, 'Grant FM failed');
const fmGrant = app.context.accessGrantRows_().find(g => g.email === fmEmail);
assert(fmGrant, 'FM grant not found');
assert(fmGrant.pages.includes('backlog'), 'FM grant must include backlog');
assert(fmGrant.pages.includes('d0'), 'FM grant must include d0');
assert(fmGrant.pages.includes('dashboard'), 'FM grant must include dashboard');
assert(fmGrant.pages.includes('kpi'), 'FM grant must include kpi');
console.log('PASS: permType FM granted FM pages:', fmGrant.pages);

const grantLmRes = app.call('aomGrantHubAccess', [{
  targetEmail: lmEmail,
  displayName: 'LM Operator',
  hubCode: lmHubs[0].hubCode,
  permType: 'LM',
  note: 'Cấp bộ quyền Last Mile'
}]);
assert(grantLmRes.ok === true, 'Grant LM failed');
const lmGrant = app.context.accessGrantRows_().find(g => g.email === lmEmail);
assert(lmGrant, 'LM grant not found');
assert(lmGrant.pages.includes('alerts'), 'LM grant must include alerts');
assert(lmGrant.pages.includes('pickup'), 'LM grant must include pickup');
assert(lmGrant.pages.includes('d0'), 'LM grant must include d0');
assert(lmGrant.pages.includes('dashboard'), 'LM grant must include dashboard');
console.log('PASS: permType LM granted LM pages:', lmGrant.pages);

// 19. Test Split FM Backlog and LM Backlog Granular Grants
console.log('Testing Split FM Backlog vs LM Backlog Granular Grants...');
const onlyFmEmail = 'onlyfm.backlog@spxexpress.com';
const onlyLmEmail = 'onlylm.backlog@spxexpress.com';

const grantOnlyFm = app.call('aomGrantHubAccess', [{
  targetEmail: onlyFmEmail,
  displayName: 'Only FM Backlog User',
  hubCode: targetHub1.hubCode,
  permType: 'CUSTOM',
  pages: ['backlog_fm', 'd0'],
  customRole: 'Chỉ xem FM Backlog',
  note: 'Chỉ cấp quyền FM Backlog'
}]);
assert(grantOnlyFm.ok === true, 'Grant Only FM failed');
const onlyFmGrant = app.context.accessGrantRows_().find(g => g.email === onlyFmEmail);
assert(onlyFmGrant, 'Only FM grant not found');
assert(onlyFmGrant.pages.includes('backlog_fm'), 'Grant must have backlog_fm');
assert(!onlyFmGrant.pages.includes('backlog_lm'), 'Grant must NOT have backlog_lm');

const grantOnlyLm = app.call('aomGrantHubAccess', [{
  targetEmail: onlyLmEmail,
  displayName: 'Only LM Backlog User',
  hubCode: targetHub1.hubCode,
  permType: 'CUSTOM',
  pages: ['backlog_lm', 'alerts'],
  customRole: 'Chỉ xem LM Backlog',
  note: 'Chỉ cấp quyền LM Backlog'
}]);
assert(grantOnlyLm.ok === true, 'Grant Only LM failed');
const onlyLmGrant = app.context.accessGrantRows_().find(g => g.email === onlyLmEmail);
assert(onlyLmGrant, 'Only LM grant not found');
assert(onlyLmGrant.pages.includes('backlog_lm'), 'Grant must have backlog_lm');
assert(!onlyLmGrant.pages.includes('backlog_fm'), 'Grant must NOT have backlog_fm');
console.log('PASS: Granular FM Backlog and LM Backlog custom grants verified successfully!');

console.log('ALL HUB ACCESS REQUEST & AOM GRANT TESTS PASSED!');
