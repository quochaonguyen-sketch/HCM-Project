const assert = require('node:assert/strict');
const { createRuntime } = require('./apps-script-runtime.cjs');

console.log('Testing People API (Rider & FTE Resource)...');
const r = createRuntime();

// 1. RIDER Resource Query
const rider = r.call('flmPeopleGetResource', [{ module: 'RIDER', scopeType: 'CITY', scopeValue: 'HCM_CITY' }]);
assert.equal(rider.module, 'RIDER');
assert(rider.anchor);
assert(rider.from);
assert(rider.hubRows.length > 0);
assert(typeof rider.totals.active === 'number' && rider.totals.active > 0);
assert(typeof rider.totals.joined_period === 'number');
assert(typeof rider.totals.last_work_day_period === 'number');
assert(typeof rider.totals.unknown_records === 'number');
console.log('PASS: RIDER resource loaded successfully:', rider.totals);

// 2. FTE Resource Query
const fte = r.call('flmPeopleGetResource', [{ module: 'FTE', scopeType: 'CITY', scopeValue: 'HCM_CITY' }]);
assert.equal(fte.module, 'FTE');
assert(fte.anchor);
assert(fte.from);
assert(fte.hubRows.length > 0);
assert(typeof fte.totals.active === 'number' && fte.totals.active > 0);
assert(typeof fte.totals.joined_period === 'number');
assert(typeof fte.totals.last_work_day_period === 'number');
assert(typeof fte.totals.unknown_records === 'number');
console.log('PASS: FTE resource loaded successfully:', fte.totals);

// 3. Detailed Hub Roster Query (Raw Data)
const testStation = fte.hubRows[0].station;
const fteRoster = r.call('flmPeopleGetHubRoster', [{
  module: 'FTE',
  station: testStation,
  scopeType: 'CITY',
  scopeValue: 'HCM_CITY'
}]);
assert.equal(fteRoster.module, 'FTE');
assert.equal(fteRoster.station, testStation);
assert(fteRoster.rows.length > 0);
assert(fteRoster.rows[0].employee_id);
assert(fteRoster.rows[0].position, 'Preserve the source position from staff');
assert(fteRoster.rows.every(row => !/\brider\b/i.test(row.position)), 'FTE roster excludes Rider positions');
assert(['ACTIVE', 'EXITED', 'UNKNOWN', 'NOT_JOINED'].includes(fteRoster.rows[0].status));
console.log('PASS: FTE Hub raw roster loaded:', fteRoster.rows.length, 'records for', testStation);

const riderRoster = r.call('flmPeopleGetHubRoster', [{
  module: 'RIDER',
  station: rider.hubRows[0].station,
  scopeType: 'CITY',
  scopeValue: 'HCM_CITY'
}]);
assert.equal(riderRoster.module, 'RIDER');
assert(riderRoster.rows.length > 0);
assert(/^4\. Rider/.test(riderRoster.rows[0].position));
console.log('PASS: Rider Hub raw roster loaded:', riderRoster.rows.length, 'records for', testStation);

// 4. Validation: Invalid module
assert.throws(() => {
  r.call('flmPeopleGetResource', [{ module: 'UNKNOWN', scopeType: 'CITY', scopeValue: 'HCM_CITY' }]);
}, /PEOPLE_INVALID_MODULE/);

// 5. Validation: Future anchor date
assert.throws(() => {
  r.call('flmPeopleGetResource', [{ module: 'RIDER', scopeType: 'CITY', scopeValue: 'HCM_CITY', anchorDate: '2099-01-01' }]);
}, /FLM_FUTURE_ANCHOR/);

// 6. Validation: Hub roster missing station
assert.throws(() => {
  r.call('flmPeopleGetHubRoster', [{ module: 'RIDER', station: '', scopeType: 'CITY', scopeValue: 'HCM_CITY' }]);
}, /PEOPLE_STATION_REQUIRED/);

// 7. Keyset Employee Listing (flmp-2-names)
const empList = r.call('flmPeopleGetEmployees', [{ module: 'FTE', state: 'ACTIVE', pageSize: 10, scopeType: 'CITY', scopeValue: 'HCM_CITY' }]);
assert.equal(empList.module, 'FTE');
assert.equal(empList.state, 'ACTIVE');
assert(Array.isArray(empList.rows));
assert(empList.rows.length > 0);
assert(empList.rows[0].employee_id);
assert(empList.rows[0].employee_name);
assert(empList.rows.every(row => !/\brider\b/i.test(row.position)), 'FTE employee pages exclude Rider positions');
assert.equal(empList.rows[0].employment_state, 'ACTIVE');
console.log('PASS: flmPeopleGetEmployees returned', empList.rows.length, 'staff rows with source names');

const bpo = r.call('flmPeopleGetResource', [{module:'BPO',scopeType:'CITY',scopeValue:'HCM_CITY'}]);
assert.equal(bpo.sourceSheet,'bpo');assert(bpo.totals.records>0);
let bpoPage = r.call('flmPeopleGetEmployees', [{module:'BPO',state:'ALL',pageSize:100,scopeType:'CITY',scopeValue:'HCM_CITY'}]);
const bpoRows=[...bpoPage.rows];
while(bpoPage.nextCursor){bpoPage=r.call('flmPeopleGetEmployees',[{module:'BPO',state:'ALL',pageSize:100,cursor:bpoPage.nextCursor,scopeType:'CITY',scopeValue:'HCM_CITY'}]);bpoRows.push(...bpoPage.rows);}
assert.equal(bpoRows.length,bpo.totals.records);
assert.equal(new Set(bpoRows.map(row=>row.employee_id)).size,bpoRows.length);
assert(bpoRows.every(row=>row.last_work_date===undefined&&row.join_date===undefined));
console.log('PASS: Outsource separate source, scoped unique CTV and activity fields:',bpo.totals);
console.log('ALL PEOPLE API & ROSTER TESTS PASSED.');
