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
assert.equal(fteRoster.rows[0].position, '3. Staff');
assert(['ACTIVE', 'EXITED', 'UNKNOWN', 'NOT_JOINED'].includes(fteRoster.rows[0].status));
console.log('PASS: FTE Hub raw roster loaded:', fteRoster.rows.length, 'records for', testStation);

const riderRoster = r.call('flmPeopleGetHubRoster', [{
  module: 'RIDER',
  station: testStation,
  scopeType: 'CITY',
  scopeValue: 'HCM_CITY'
}]);
assert.equal(riderRoster.module, 'RIDER');
assert(riderRoster.rows.length > 0);
assert.equal(riderRoster.rows[0].position, '4. Rider');
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

console.log('ALL PEOPLE API & ROSTER TESTS PASSED.');
