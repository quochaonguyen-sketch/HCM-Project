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

console.log('ALL HUB ACCESS REQUEST API TESTS PASSED!');
