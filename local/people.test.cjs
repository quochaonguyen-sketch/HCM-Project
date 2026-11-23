const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
const permission=r.context.getPermissionModel_(false);
const sup=Object.values(permission.users).find(u=>u.rank==='SUP'&&u.hubCodes.length<permission.stations.length);
assert.ok(sup);
r.context.Session.getActiveUser=()=>({getEmail:()=>sup.email});
const restricted={scopeType:'SUP',scopeValue:sup.email,selectedHubCodes:sup.hubCodes.slice(0,1)};
const resolveAccess=r.context.getUserAccessByEmail_;
r.context.getUserAccessByEmail_=email=>({...resolveAccess(email),customAccess:true,allowedPages:['dashboard']});
for(const module of ['FTE','RIDER']){
 const resource=r.call('flmPeopleGetResource',[{...restricted,module}]);
 assert.ok(resource.hubRows.length>0&&resource.hubRows.every(row=>restricted.selectedHubCodes.includes(row.hubCode)));
}
const forbidden=permission.stations.find(h=>!sup.hubCodes.includes(h.hubCode));
assert.throws(()=>r.call('flmPeopleGetResource',[{...restricted,module:'FTE',selectedHubCodes:[forbidden.hubCode]}]),/HUB_ACCESS_DENIED/);
r.context.getUserAccessByEmail_=email=>({...resolveAccess(email),customAccess:true,allowedPages:['kpi']});
assert.throws(()=>r.call('flmPeopleGetResource',[{...restricted,module:'FTE'}]),/PAGE_ACCESS_DENIED/);
r.context.getUserAccessByEmail_=resolveAccess;
r.context.Session.getActiveUser=()=>({getEmail:()=>'unknown@example.test'});
assert.throws(()=>r.call('flmPeopleGetResource',[{...restricted,module:'RIDER'}]),/ACCESS_DENIED/);
console.log('PASS: Dashboard-only workforce access, scoped HUB selection, and denied users checked by the server.');
console.log('ALL PEOPLE API & ROSTER TESTS PASSED.');

const source = fs.readFileSync(path.join(__dirname, '..', 'Javascript.html'), 'utf8');

function sourceBetween(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, from);
  return source.slice(start, end);
}

function workforceHarness(source) {
  const state = { page: 'dashboard', bootReady: true, boot: {}, kpiLoading: true };
  const frames = [], idle = [], requests = [], timers = new Map(), routes = [];
  const workspace = { signedOut: false };
  let container, today = '2026-11-18', serial = 0;
  let scope = { type: 'CITY', value: 'HCM_CITY' }, hubs = ['H1', 'H2'], anchor = today;
  let normal = false, allowed = true;
  const google = { script: { run: { withSuccessHandler(success) {
    return { withFailureHandler(failure) {
      return { flmPeopleGetResource(request) { requests.push({ request, success, failure }); } };
    }};
  }}} };
  const context = vm.createContext({
    state, WorkspaceSession: workspace, google, window: { google, requestIdleCallback: fn => idle.push(fn) },
    FLMPeople: { fte: {}, rider: {} },
    document: { getElementById(id) {
      return id === 'snapshotFteContainer' ? container : container?.[id];
    }},
    syncCurrentScope: () => scope, currentDrillView: () => scope, effectiveSelectedHubCodes: () => hubs,
    flmPeopleAnchor_: () => anchor, flmSourceToday_: () => today, isNormalAccount: () => normal,
    clientPageAllowed_: page => { assert.equal(page, 'dashboard');return allowed; },
    setTimeout(fn, delay) { timers.set(++serial, { fn, delay });return serial; },
    clearTimeout: id => timers.delete(id), requestAnimationFrame: fn => frames.push(fn),
    renderSnapshotWorkforce_(node, fte, rider) { node.data = [fte?.name, rider?.name]; },
    e: value => String(value).replace(/</g, '&lt;'),
    renderForPageNavigation_(page) { state.page = page;routes.push(page); },
    scheduleCurrentPageDataLoad() { routes.push('load:' + state.page); }
  });
  const body = sourceBetween(source, " var fteRefresh=document.getElementById('snapshotFteRefresh');", " function eodRender()");
  const binderFrom = source.lastIndexOf('\n', source.indexOf(body) - 2);
  const binder = source.slice(binderFrom, source.indexOf(body));
  const active = source.includes('function snapshotFteContext_(){');
  if (active) vm.runInContext(sourceBetween(source, 'var SnapshotWorkforce=', 'function snapshotFteSection(){'), context);
  vm.runInContext(sourceBetween(source, active ? 'function snapshotFteContext_(){' : 'function snapshotFteLoad(force){', 'function snapshotUpcomingSections(){'), context);
  vm.runInContext('function bindWorkforce(){' + binder + body + '}', context);

  function mount() {
    container = {
      snapshotFteRefresh: {}, snapshotFteFullPage: {}, snapshotRiderFullPage: {},
      data: null, error: '', retry: {},
      set textContent(value) { assert.equal(value, '');this.data = null;this.error = ''; },
      set innerHTML(value) { assert.match(value, /flmp-loading/);this.data = null;this.error = ''; },
      insertAdjacentHTML(position, error) { assert.equal(position, 'beforeend');this.error = error; },
      querySelector(id) { assert.equal(id, '#snapshotWorkforceRetry');return this.retry; }
    };
    context.bindWorkforce();
    return container;
  }
  function runTimers(delay) {
    for (const [id, t] of [...timers]) {
      if (t.delay !== delay || !timers.delete(id)) continue;
      t.fn();
    }
  }
  function paint() {
    while (frames.length) frames.shift()();
    while (idle.length) idle.shift()();
    runTimers(0);
  }
  function resolvePair(at, name) {
    requests[at].success({ name: 'FTE ' + name });
    requests[at + 1].success({ name: 'RIDER ' + name });
  }
  return {
    state, workspace, context, requests, routes, mount, paint, runTimers, resolvePair,
    setScope(type, value, selected) { scope = { type, value };hubs = selected; },
    setToday(value) { today = value; },
    setAnchor(value) { anchor = value; },
    setPermissions(isNormal, hasDashboard) { normal = isNormal;allowed = hasDashboard; }
  };
}

function verifyWorkforceStartup() {
  const h = workforceHarness(source);
  const initial = Array.from({ length: 4 }, () => h.mount());
  h.paint();
  assert.equal(h.requests.length, 0, 'Workforce stays off the KPI startup path');
  h.state.kpiLoading = false;
  h.state.kpiData = { rows: [{}] };
  const rendered = Array.from({ length: 4 }, () => h.mount());
  assert.equal(h.requests.length, 0, 'Requests wait for the KPI paint');
  h.paint();
  assert.equal(h.requests.length, 2, 'Four repeated binds send one FTE/Rider pair');
  h.setScope('CITY', 'HCM_CITY', ['H2', 'H1']);
  const latest = h.mount();
  h.paint();
  assert.equal(h.requests.length, 2, 'Changing only HUB order preserves the in-flight request');
  h.resolvePair(0, 'city');
  assert.deepEqual(latest.data, ['FTE city', 'RIDER city']);
  assert.ok(initial.concat(rendered).every(node => node.data === null), 'Only the latest container is painted');
  assert.deepEqual(h.mount().data, latest.data, 'Rebinding reuses the completed pair');

  h.setScope('HUB', 'H1', ['H1']);
  h.mount();
  h.paint();
  const hubRequest = h.requests[2].request;
  assert.deepEqual([hubRequest.scopeType, hubRequest.scopeValue, ...hubRequest.selectedHubCodes], ['HUB', 'H1', 'H1']);
  h.setAnchor('2026-11-17');
  const anchorView = h.mount();
  h.paint();
  h.resolvePair(4, 'earlier');
  h.resolvePair(2, 'stale anchor');
  assert.deepEqual(anchorView.data, ['FTE earlier', 'RIDER earlier']);
  assert.equal(h.requests[4].request.anchorDate, '2026-11-17');
  h.setToday('2026-11-19');
  h.mount();
  h.paint();
  assert.equal(h.requests.length, 8, 'A new Vietnam cache day reloads even a pinned anchor');
  h.setScope('HUB', 'H2', ['H2']);
  const scopeView = h.mount();
  h.paint();
  h.resolvePair(6, 'stale HUB');
  assert.equal(scopeView.data, null);

  scopeView.snapshotFteRefresh.onclick();
  scopeView.snapshotFteRefresh.onclick();
  assert.equal(h.requests.length, 12, 'Forced refresh supersedes normal work and coalesces repeated clicks');
  assert.ok(h.requests.slice(10).every(call => call.request.force === true));
  h.resolvePair(8, 'superseded');
  assert.equal(scopeView.data, null);
  h.requests[10].success({ name: 'one module' });
  h.runTimers(45000);
  assert.match(scopeView.error, /Thử lại/);
  assert.deepEqual(scopeView.data, ['one module', undefined]);
  h.requests[11].success({ name: 'late module' });
  assert.deepEqual(scopeView.data, ['one module', undefined], 'Timed-out results cannot repaint');
  const errorView = h.mount();
  h.paint();
  assert.equal(h.requests.length, 12, 'A failed automatic request does not restart on bind');
  assert.match(errorView.error, /Thử lại/);
  errorView.retry.onclick();
  h.requests[12].failure(Error('<denied>'));
  h.requests[13].failure(Error('other failure'));
  assert.equal(errorView.data, null);
  assert.match(errorView.error, /&lt;denied>/);
  errorView.retry.onclick();
  h.resolvePair(14, 'after retry');
  assert.deepEqual(errorView.data, ['FTE after retry', 'RIDER after retry']);
  errorView.snapshotFteFullPage.onclick();
  assert.deepEqual(h.routes, ['fte', 'load:fte']);
  errorView.snapshotRiderFullPage.onclick();
  assert.deepEqual(h.routes.slice(-2), ['pickup', 'load:pickup']);

  h.state.page = 'dashboard';
  h.state.boot = {};
  h.setPermissions(true, true);
  h.mount().snapshotFteRefresh.onclick();
  h.paint();
  h.setPermissions(false, false);
  h.mount().snapshotFteRefresh.onclick();
  h.paint();
  h.setPermissions(false, true);
  h.workspace.signedOut = true;
  h.mount().snapshotFteRefresh.onclick();
  h.paint();
  assert.equal(h.requests.length, 16, 'No read for NORMAL, denied Dashboard, or signed-out pages');
  h.workspace.signedOut = false;
  const newBoot = h.mount();
  h.paint();
  assert.equal(newBoot.data, null, 'A new workspace does not reuse the old workspace result');
  assert.equal(h.requests.length, 18);
  h.state.page = 'pickup';
  h.resolvePair(16, 'dashboard only');
  assert.equal(newBoot.data, null);

  const unavailable = workforceHarness(source);
  unavailable.state.kpiLoading = false;
  unavailable.state.kpiError = 'KPI unavailable';
  unavailable.context.window.requestIdleCallback = undefined;
  unavailable.mount();
  unavailable.paint();
  assert.equal(unavailable.requests.length, 2, 'KPI errors and browsers without idle callbacks still load workforce');
  console.log('PASS: four Dashboard binds issue one workforce pair after KPI paint; current scope/day, timeout, retry, roles, and direct page links verified.');
}

function verifySourceHealthCalls() {
  const calls = [], state = { page: 'dashboard' };
  let admin = true, now = 1000;
  const context = vm.createContext({
    state, isAdmin: () => admin, Date: { now: () => now }, e: String,
    render() { if (state.page === 'data' || state.page === 'monitor') context.sourceHealthSeatalkCard_(); },
    google: { script: { run: { withSuccessHandler(success) {
      return { withFailureHandler(failure) {
        function record(method) { calls.push({ method, success, failure }); }
        return { getSourceHealth: () => record('health'), getSeaTalkAlertConfig: () => record('seatalk') };
      }};
    }}} }
  });
  vm.runInContext(sourceBetween(source, 'var sourceHealthState=', 'function sourceHealthIcon_('), context);
  context.sourceHealthLoad_();
  assert.deepEqual(calls.map(c => c.method), ['health']);
  calls[0].success({});
  state.page = 'data';
  context.sourceHealthSeatalkCard_();
  context.sourceHealthLoad_();
  calls[1].success({ hasWebhook: true, enabled: true });
  assert.deepEqual(calls.map(c => c.method), ['health', 'seatalk', 'health'], 'Panel auto-check does not duplicate the pending config read');
  calls[2].success({});
  state.page = 'monitor';
  context.sourceHealthLoad_(true);
  assert.deepEqual(calls.map(c => c.method), ['health', 'seatalk', 'health', 'health', 'seatalk']);
  calls[3].success({});
  calls[4].failure(Error('temporary'));
  now += 300001;
  admin = false;
  context.sourceHealthLoad_(true);
  assert.equal(calls.length, 5);
  console.log('PASS: Source Health keeps its Dashboard check and reads SeaTalk config once on its panels, with explicit refresh and admin gating.');
}

verifyWorkforceStartup();
verifySourceHealthCalls();
