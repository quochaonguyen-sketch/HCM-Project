const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const { read } = require('./source.cjs');

const source = read('Javascript.html').replace(/\r\n/g, '\n');
function load(context, ...names) {
  for (const name of names) {
    const match = [...source.matchAll(new RegExp(`^([ \\t]*)function ${name}\\(`, 'gm'))].at(-1);
    assert.ok(match, name);
    const tail = source.slice(match.index);
    const end = tail.split('\n', 1)[0].endsWith('}') ? tail.indexOf('\n') : tail.search(new RegExp(`^${match[1]}}$`, 'm')) + match[1].length + 1;
    assert.ok(end > 0, name);
    vm.runInContext(tail.slice(0, end), context);
  }
}

test('D0 forecast cards use the matching section, date and HUB scope', async () => {
  const fmDay = '2026-11-22', lmDay = '2026-11-21';
  const a = { station_id: 1, station_name: 'Synthetic A', hub_code: 'A', zone: 'North' };
  const b = { station_id: 2, station_name: 'Synthetic B', hub_code: 'B', zone: 'North' };
  const fm = [
    { ...a, snapshot_date: fmDay, fetched_at: fmDay + 'T09:00:00+07:00', Picked: 0 },
    { ...b, snapshot_date: fmDay, fetched_at: fmDay + 'T09:00:00+07:00', Picked: 24 }
  ];
  const lm = [
    { ...a, fetched_at: lmDay + 'T09:00:00+07:00', lm_hub_inbounded_order_qty_eod: 7 },
    { ...b, fetched_at: lmDay + 'T09:00:00+07:00', lm_hub_inbounded_order_qty_eod: 9 }
  ];
  const fmPlan = { date: fmDay, byHub: { A: { fm: 20 }, B: { fm: 40 } } };
  const lmPlan = { date: lmDay, byHub: { A: { lm: 10 }, B: { lm: 30 } } };
  const sections = {
    fm: { sheets: { 'FM Order Volume D0': fm }, todayForecast: fmPlan },
    lm: { sheets: { 'LM Order Volume D0': lm }, todayForecast: lmPlan }
  };
  const requests = [], frames = [];
  let fmFailed = false;
  const context = vm.createContext({
    state: { bootReady: true, page: 'd0' }, D0: { leg: 'overview' },
    setTimeout, clearTimeout, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, e: String, uiDateLabel: String,
    document: { querySelectorAll: () => [] }, d0FleetChart: () => '',
    render() { frames.push(context.d0Cards()); },
    async d0SnapshotRequest(force, section) {
      requests.push(section);
      if (force && fmFailed && section === 'fm') throw Error('Synthetic FM refresh failure');
      return { section, ...(sections[section] || { sheets: {}, todayForecast: null }) };
    }
  });
  load(context, 'd0Num', 'd0Fmt', 'd0Pct', 'd0Sum', 'd0Ratio', 'd0IsPage', 'd0IsAttendancePage', 'd0ViewSections',
    'd0SectionReady', 'd0Fetch', 'd0Model', 'd0Scoped', 'd0LegRows', 'd0Timestamp', 'd0Time', 'd0LatestUpdated', 'd0LastUpdated',
    'd0ActualStaff', 'd0ActualStaffTotal', 'd0ClearanceTotal', 'd0Clearance', 'd0SourceDate_', 'd0Forecast_',
    'd0BacklogSplitTotal_', 'd0BacklogSplit_', 'd0HubHourlyInbound_', 'd0HubHourlyRows_',
    'd0TotalCard', 'd0Cards', 'ovNetworkSummary', 'opsLmCardGroups', 'opsHeading');
  const { D0 } = context;
  await context.d0Fetch(false);
  assert.deepEqual(requests, ['fm', 'lm', 'attendance', 'delivery', 'fmPickup', 'hourly']);
  assert.equal(D0.data.todayForecast, null);
  assert.match(frames[0], /data-d0-metric="fm-fc"><span>FM vs Forecast<\/span><b>Loading\u2026/);
  assert.match(frames.at(-1), /data-d0-metric="fm-fc"><span>FM vs Forecast<\/span><b>40\.0%/);
  assert.match(context.d0Cards(), /FM vs Forecast<\/span><b>40\.0%<\/b><small>Picked: 24 \/ KH: 60/);
  assert.match(context.d0Cards(), /LM vs Forecast<\/span><b>40\.0%<\/b><small>LM Inbound: 16 \/ KH: 40/);
  assert.match(context.ovNetworkSummary(), /ov-summary-fm.*40\.0% Forecast.*ov-summary-lm.*40\.0% Forecast/);

  D0.leg = 'fm';
  assert.match(context.d0Cards(), /data-d0-metric="fm-fc"><span>% \u0110\u1ea1t Forecast<\/span><b>40\.0%<\/b><small>K\u1ebf ho\u1ea1ch: 60/);
  D0.leg = 'lm';
  assert.match(context.d0Cards(), /data-d0-metric="lm-fc"><span>% \u0110\u1ea1t Forecast<\/span><b>40\.0%<\/b><small>K\u1ebf ho\u1ea1ch: 40/);
  D0.leg = 'overview';

  // The selected scope includes its catalog-only HUBs until the user narrows it.
  fm[1].Picked = 30;
  D0.data.hubCatalog = [{code:'C',name:'Synthetic catalog only HUB',zone:'East'}];
  D0.model = null;
  assert.equal(context.d0Scoped().length,3);
  assert.equal(context.d0Forecast_('fm').total,null,'Missing plan for a selected catalog HUB invalidates the plan total');
  assert.equal(context.d0Forecast_('fm').rate,null,'The 50% for reporting HUBs is not the rate for the full scope');
  D0.forecasts.fm = { ...fmPlan, byHub: { ...fmPlan.byHub,C:{fm:10} } };
  assert.equal(context.d0Forecast_('fm').total,70,'A complete scope plan can still be displayed');
  assert.equal(context.d0Forecast_('fm').rate,null,'Actuals remain incomplete');
  D0.forecasts.fm = fmPlan;
  D0.zone = 'North';
  assert.equal(context.d0Forecast_('fm').rate,50,'The explicitly selected North zone has complete plans and actuals');
  D0.zone = '';
  D0.data.hubCatalog = [];
  D0.model = null;
  fm[1].Picked = 24;

  D0.forecasts.fm = { ...fmPlan, date: lmDay };
  assert.match(context.d0Cards(), /FM vs Forecast<\/span><b>\u2014<\/b><small>Picked: 24 \/ KH: \u2014/);
  D0.forecasts.fm = { date: fmDay, byHub: { A: { fm: 20 }, B: { fm: null } } };
  assert.equal(context.d0Forecast_('fm').total, null);
  assert.equal(context.d0Forecast_('lm').rate, 40);
  D0.hub = '1';
  assert.equal(context.d0Forecast_('fm').total, 20);
  assert.equal(context.d0Forecast_('fm').rate, 0);
  D0.hub = '2';
  assert.equal(context.d0Forecast_('fm').total, null);
  D0.hub = '';
  D0.forecasts.fm = { date: fmDay, byHub: { A: { fm: 0 }, B: { fm: 0 } } };
  assert.match(context.d0Cards(), /FM vs Forecast<\/span><b>\u2014<\/b><small>Picked: 24 \/ KH: 0/);
  assert.match(context.ovNetworkSummary(), /K\u1ebf ho\u1ea1ch Forecast<\/dt><dd>0<\/dd>/);
  D0.forecasts.fm = fmPlan;

  lm[0].lm_hub_inbounded_order_qty_eod = null;
  assert.equal(context.d0Forecast_('lm').rate, null);
  lm[0].lm_hub_inbounded_order_qty_eod = 7;
  lm[0].fetched_at = '2026-11-20T09:00:00+07:00';
  assert.equal(context.d0Forecast_('lm').rate, null, 'Dated actuals from different days cannot share a plan');
  lm[0].fetched_at = lmDay + 'T09:00:00+07:00';

  fmFailed = true;
  await context.d0Fetch(true);
  assert.equal(context.d0Forecast_('fm').rate, 40, 'A failed refresh retains the prior matched snapshot and plan');
  fmFailed = false;
  sections.fm.todayForecast = null;
  await context.d0Fetch(true);
  assert.match(context.d0Cards(), /FM vs Forecast<\/span><b>\u2014<\/b><small>Picked: 24 \/ KH: \u2014/);
  assert.equal(context.d0Forecast_('lm').rate, 40, 'An absent FM plan leaves LM display independent');
});

async function verifyD0Ui() {
  const day = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const fetched = day + 'T09:10:00+07:00';
  const old = '2025-03-14T09:10:00+07:00';
  const a = { station_id: 10, station_name: 'Synthetic Depot A', hub_code: 'A', zone: 'North', aom: ['a'], sup: ['s'], fetched_at: fetched };
  const b = { ...a, station_id: 20, station_name: 'Synthetic Depot B', hub_code: 'B' };
  const hubCatalog = [{ code: 'A', name: a.station_name }, { code: 'B', name: b.station_name }];
  const plan = { date: day, byHub: { A: { fm: 20, lm: 10 }, B: { fm: 40, lm: 30 } } };
  const facts = {
    fm: { sheets: { 'FM Order Volume D0': [{ ...a, snapshot_date: day, Picked: 0, 'Total FM Inbound': 14, Outbound: 6 }, { ...b, snapshot_date: day, Picked: 24 }] }, todayForecast: plan },
    lm: { sheets: { 'LM Backlog D0': [{ ...a, backlog_d0: 8 }, { ...b, backlog_d0: null }], 'LM Order Volume D0': [{ ...a, lm_hub_delivered_order_qty_eod: 0, lm_hub_inbounded_order_qty_eod: 7 }, { ...b, lm_hub_delivered_order_qty_eod: 6, lm_hub_inbounded_order_qty_eod: 9 }], 'Backlog D0': [{ ...a, fetched_at: old, total_backlog_d_minus_1: 9, to_deliver_1d: 1, to_deliver_2d: 2 }] }, todayForecast: plan },
    attendance: { sheets: { 'Roster D0': [{ ...a, event_date_iso: day, scheduled_count: 0, fte_count: 0, bpo_count: 0, os_count: 0 }], 'Roster Shifts D0': [], 'Attendance Hours D0': [] }, attendanceCapabilities: { late: false }, todayForecast: null },
    delivery: { sheets: { 'Delivery Progress D0': [] }, todayForecast: null },
    fmPickup: { sheets: { 'FM Pending Pickup Backlog D0': [] }, todayForecast: null }
  };
  const requests = [], navigation = [];
  const context = vm.createContext({
    state: { bootReady: true, page: 'd0' },
    D0: { data: null, leg: 'overview', aom: '', sup: '', zone: '', hub: '', attendanceTab: 'attendance', hubPage: 1, riderPage: 2 },
    window: {}, document: { querySelectorAll: () => [] }, setTimeout, clearTimeout,
    e: value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
    uiDateLabel: value => String(value).split('-').reverse().join('/'), render() {},
    isNormalAccount: () => false, queueViewAnchor_: anchor => navigation.push(anchor), renderForPageNavigation_: page => navigation.push(page),
    history: { replaceState: (_, __, next) => navigation.push(next) },
    d0SnapshotRequest: async (force, section) => {
      requests.push([force, section]);
      if (force && section === 'fm') throw Error('Synthetic refresh failure');
      return { ...facts[section], hubCatalog, section };
    }
  });
  load(context, 'd0Num', 'd0Fmt', 'd0Pct', 'd0Sum', 'd0Ratio', 'd0ViewSections', 'd0SectionReady', 'd0IsPage', 'd0IsAttendancePage',
    'd0Fetch', 'd0Model', 'd0Scoped', 'd0LegRows', 'd0Timestamp', 'd0Time', 'd0LatestUpdated', 'd0SourceDate_', 'd0Forecast_', 'd0SourcePanel_',
    'd0Clearance', 'd0ClearanceParts_', 'd0ClearanceTotal', 'fmPickupCount', 'd0BacklogDayTotal_', 'd0AttendanceCapabilitiesNote_',
    'd0ActualStaff', 'd0ActualStaffTotal', 'd0LastUpdated', 'd0TotalCard', 'd0Cards', 'd0SectionTabs', 'd0Pagination', 'd0SelectView');

  assert.match(context.d0SourcePanel_(), /Waiting for data/);
  const loading = context.d0Fetch(false);
  assert.match(context.d0SourcePanel_(), /Loading…/);
  await loading;
  assert.deepEqual(requests.map(row => row[1]), ['fm', 'lm', 'attendance', 'delivery', 'fmPickup']);
  assert.equal(context.D0.data.todayForecast, null, 'An unrelated section includes no forecast');
  assert.equal(context.d0Forecast_('fm').rate, 40);
  assert.equal(context.d0Forecast_('lm').rate, 40);
  assert.match(context.d0Cards(), /data-d0-metric="fm-fc"><span>FM vs Forecast<\/span><b>40\.0%/);
  assert.match(context.d0Cards(), /data-d0-metric="lm-clearance"><span>LM Clearance<\/span><b>—<\/b>/);
  assert.equal(context.d0ClearanceTotal(), null, 'A partially observed HUB leaves scope clearance unknown');
  const hubs = context.d0Scoped();
  assert.equal(context.d0Clearance(hubs[0]), 0);
  assert.equal(context.d0Clearance(hubs[1]), null);
  assert.equal(context.d0Clearance({ lm: { backlog_d0: 5 } }), null);
  assert.equal(context.d0Clearance({ lm: { backlog_d0: 0, lm_hub_fleet_delivered_order_qty_eod: 5 } }), 100);
  assert.equal(context.d0Clearance({ lm: { backlog_d0: 0 }, lmVolume: { lm_hub_delivered_order_qty_eod: 0 } }), null);
  assert.equal(context.d0BacklogDayTotal_(hubs[0].backlog), 9);
  assert.equal(context.d0BacklogDayTotal_({ 'total_backlog D-1': 0 }), 0);
  assert.equal(context.d0BacklogDayTotal_({}), null);
  assert.equal(context.d0Fmt(''), '—');
  assert.equal(context.d0Fmt(0), '0');
  assert.equal(context.d0Pct(NaN), '—');
  assert.equal(context.d0Ratio(0, 2), 0);

  let html = context.d0SourcePanel_();
  assert.match(html, /data-d0-feed="FM Order Volume D0".*Supabase.*Fetched 09:10/);
  assert.match(html, /data-d0-feed="Backlog D0".*Stale snapshot/);
  assert.match(html, /data-d0-feed="fmForecast".*Google Sheets · FC workbook/);
  assert.match(html, /data-d0-feed="Attendance Hours D0".*No confirmed clock-in data.*Raw clock-ins are unavailable/);
  assert.match(html, /data-d0-feed="Roster D0".*Daily late counts unavailable/);
  assert.match(context.d0AttendanceCapabilitiesNote_(), /Daily late counts unavailable.*No confirmed hourly clock-in data/);
  context.window.__LOCAL_DATA__ = {};
  html = context.d0SourcePanel_();
  assert.match(html, /D0 data · runtime source unconfirmed/);
  assert.doesNotMatch(html, /<span>Supabase<\/span>/);

  // Missing selected-HUB plans cannot masquerade as complete scope progress.
  for (const leg of ['fm','lm']) {
    const sheet=leg==='fm'?'FM Order Volume D0':'LM Order Volume D0',field=leg==='fm'?'Picked':'lm_hub_inbounded_order_qty_eod';
    const rows=context.D0.data.sheets[sheet],actuals=rows.map(row=>row[field]),savedPlan=context.D0.forecasts[leg];
    rows.forEach(row=>{row[field]=10});context.D0.model=null;
    const setPlan=(a,b)=>{context.D0.forecasts[leg]={date:day,byHub:{A:{[leg]:a},B:{[leg]:b}}}};
    setPlan(100,null);
    assert.equal(context.d0Forecast_(leg).total,null);
    assert.equal(context.d0Forecast_(leg).rate,null,'A=100, B=null and actual=20 must not display 20%');
    assert.match(context.d0SourcePanel_(),new RegExp('data-d0-feed="'+leg+'Forecast".*No confirmed plan for this scope and date'));
    if(leg==='fm')assert.match(context.d0Cards(),/data-d0-metric="fm-fc"><span>FM vs Forecast<\/span><b>\u2014<\/b>/);
    setPlan(100,undefined);
    assert.equal(context.d0Forecast_(leg).total,null,'An absent HUB plan is also unknown');
    setPlan(100,100);
    assert.equal(context.d0Forecast_(leg).total,200);assert.equal(context.d0Forecast_(leg).rate,10);
    setPlan(100,0);
    assert.equal(context.d0Forecast_(leg).total,100);assert.equal(context.d0Forecast_(leg).rate,20,'Reported zero remains a numeric plan');
    setPlan(0,0);
    assert.equal(context.d0Forecast_(leg).total,0);assert.equal(context.d0Forecast_(leg).rate,null,'A zero denominator has no percentage');
    assert.match(context.d0SourcePanel_(),new RegExp('data-d0-feed="'+leg+'Forecast".*Available'));
    setPlan(100,null);context.D0.hub='10';
    assert.equal(context.d0Forecast_(leg).total,100);assert.equal(context.d0Forecast_(leg).rate,10,'An unselected missing plan does not invalidate the selected HUB');
    context.D0.hub='20';assert.equal(context.d0Forecast_(leg).total,null);
    setPlan(100,0);assert.equal(context.d0Forecast_(leg).total,0);assert.equal(context.d0Forecast_(leg).rate,null);
    context.D0.hub='';context.D0.forecasts[leg]=savedPlan;
    rows.forEach((row,index)=>{row[field]=actuals[index]});context.D0.model=null;
  }

  context.D0.hub = '10';
  assert.equal(context.d0ClearanceTotal(), 0);
  assert.equal(context.d0Forecast_('fm').rate, 0);
  context.D0.forecasts.fm = { ...plan, date: '2025-03-14' };
  assert.equal(context.d0Forecast_('fm').total, null, 'A mismatched forecast date cannot be used');
  context.D0.forecasts.fm = plan;
  await context.d0Fetch(true);
  assert.match(context.d0SourcePanel_(), /data-d0-feed="FM Order Volume D0".*Stale · refresh failed/);
  assert.equal(context.d0Forecast_('fm').total, 20, 'A stale retained snapshot keeps its accompanying plan');
  assert.match(context.D0.error, /Synthetic refresh failure/);

  context.d0Fetch = force => navigation.push(force);
  context.d0SelectView('lm', 'age', 'lm-hub');
  assert.deepEqual(navigation, ['#d0-lm', 'lm-hub', 'd0', false]);
  assert.match(context.d0SectionTabs(), /data-d0-tab="age"[^>]*aria-pressed="true"/);
  assert.match(context.d0Pagination('rider', 40, 20), /data-d0-page="rider:2" class="active"/);
  console.log('PASS: D0 mapped state and HUB scope, unknown and zero metrics, forecast isolation, source and attendance capabilities, refresh, tabs and pagination.');
}

async function verifyD0ExportsAndHourly() {
  const day = '2026-11-19';
  const shift = { shift: '22:00-06:00', shift_date_iso: '2026-11-18', shift_start: '2026-11-18T22:00:00+07:00', shift_end: day + 'T06:00:00+07:00',
    planned_people: 0, actual_people: 5, actual_fte: 0, actual_bpo: 5, actual_os: null, male_count: 3, female_count: 0, unknown_gender_count: null,
    avg_work_hours: null, ot_people: 0, classification_status: 'Matched' };
  const hub = { id: '1', code: 'A', name: 'Synthetic HUB A', riderCount: 8, riders: [{ rider_count: 8, lm_hub_fleet_assigned_order_qty_td: 90 }], shifts: [shift],
    roster: { scheduled_count: 0, fte_count: 0, bpo_count: 5, os_count: 2, male_count: 3, female_count: 0, unknown_gender_count: null },
    backlog: { total_backlog_d_minus_1: 8, to_deliver_1d: 0, to_deliver_2d: null, to_deliver_3d: 0, to_deliver_4d: 0, to_deliver_5d: 0, to_deliver_6d: 0 } };
  const other = { id: '2', code: 'B', name: 'Synthetic HUB B', riders: [], shifts: [] };
  const hourly = (hubCode, hour, received, assigned, delivered) => ({ hub_code: hubCode, hour, grass_date: day,
    lm_hub_received_in_system_order_qty_1h: received, lm_hub_assigned_in_system_order_qty_1h: assigned, lm_hub_delivered_in_system_order_qty_1h: delivered });
  const alerts = [], files = [], exportButton = {};
  let currentBlob;
  const context = vm.createContext({
    state: { page: 'd0', bootReady: false }, LmHourly: { mode: 'combined', metric: 'received', window: 'all', visible: {} },
    lmHourlyMetrics: [['received','Received']],
    D0: { leg: 'lm', tab: 'age', attendanceTab: 'attendance', attendanceHub: '1', tableSorts: {}, hubPage: 1, riderHub: '1', riderPage: 1,
      riderSort: 'driver_id', riderDirection: 'asc', riderCache: {}, riderLoading: {}, riderError: {}, partial: true, sectionTimes: { hourly: 1 }, sectionErrors: {},
      data: { sheets: { 'Throughput Hourly D0': [
        hourly('A', 8, null, 100, null), hourly('B', 8, null, null, 50),
        hourly('A', 9, 60, 40, 0), hourly('B', 9, 100, null, null), hourly('A', 10, 120, 60, 30)
      ] } }
    },
    e: value => String(value ?? ''),
    uiDateLabel: value => String(value).split('-').reverse().join('/'),
    d0ReportDate: () => day, d0AttendanceTime: () => '05:00', d0Scoped: () => [hub, other], d0Visible: () => [hub],
    appExportIcon: () => '<svg></svg>', designNavIcon: () => '<svg></svg>', d0RiderHeaders: () => '', d0RiderProgress: () => '', opsRiderMobile: () => '',
    lmHourlyCombinedChart_: () => '<svg></svg>', lmHourlyChart_: () => '<svg></svg>',
    alert: message => alerts.push(message), Blob, setTimeout() {},
    URL: { createObjectURL: blob => { currentBlob = blob; return 'blob:synthetic'; } },
    document: { body: { appendChild() {}, removeChild() {} }, createElement: () => ({ click() { files.push({ name: this.download, blob: currentBlob }); } }),
      getElementById: id => id === 'd0RiderExportCsv' ? exportButton : null, querySelectorAll: () => [] }
  });
  load(context, 'd0Num', 'd0Fmt', 'd0Pct', 'd0Sum', 'd0Ratio', 'd0IsAttendancePage', 'd0SectionReady', 'd0Pagination', 'd0ActualStaff',
    'd0AttendanceStamp', 'd0AttendanceShiftLabel', 'd0WorkforceValues_', 'd0WorkforceTotal', 'd0GenderValues', 'd0WorkHours', 'd0BacklogDayTotal_', 'fmPickupCount',
    'd0TableSortKey', 'd0SortTableRecords', 'd0ColumnValues', 'd0TableExportCsv_', 'd0AttendanceDetailExportCsv_', 'd0ChosenRiderHub',
    'd0RiderCacheKey', 'd0RiderExportRows_', 'd0RiderExportCsv_', 'd0RiderTable', 'd0BindRiderControls', 'd0LastUpdated', 'd0LatestUpdated', 'd0Timestamp',
    'd0ViewSelector', 'lmHourlyMultiModel_', 'lmHourlyRateText_', 'lmHourlyModel_', 'lmHourlyWindowBounds_', 'lmHourlyWindowControl_',
    'lmHourlyPanel_', 'lmHourlyExportCsv_', 'downloadCsvFile_');

  const { D0, LmHourly } = context;
  const latestCsv = () => files.at(-1).blob.text();
  assert.match(context.d0RiderTable(), /id="d0RiderExportCsv"[^>]+ disabled/);
  assert.match(context.d0RiderTable(), /Select View riders to load details and export CSV/);
  context.d0BindRiderControls();
  exportButton.onclick();
  assert.equal(files.length, 0, 'The HUB aggregate must never export as a rider');
  assert.match(alerts.at(-1), /View riders/);
  const key = context.d0RiderCacheKey('A', 1);
  D0.riderCache[key] = { data: { total: 3, rows: [hub.riders[0], { driver_id: 'OTHER', hub_code: 'B' }, { driver_id: 'R-17', hub_code: 'A', driver_name: '=Synthetic',
    lm_hub_fleet_assigned_order_qty_td: 8, lm_hub_fleet_delivering_in_system_order_qty_eod: null, lm_hub_fleet_failed_delivery_order_qty_eod: 0,
    lm_hub_fleet_delivered_order_qty_eod: 0 }] } };
  D0.riderLoading[key] = true;
  assert.match(context.d0RiderTable(), /id="d0RiderExportCsv"[^>]+ disabled/);
  exportButton.onclick();
  assert.equal(files.length, 0, 'The export is disabled while the selected detail page is being refreshed');
  D0.riderLoading[key] = false;
  assert.doesNotMatch(context.d0RiderTable(), /id="d0RiderExportCsv"[^>]+ disabled/);
  context.d0BindRiderControls();
  exportButton.onclick();
  assert.match(await latestCsv(), /"A","Synthetic HUB A","R-17","'=Synthetic","8","","0","0","0\.00%"$/);
  assert.doesNotMatch(await latestCsv(), /OTHER|"90"/);
  D0.riderSearch = 'different search';
  exportButton.onclick();
  assert.equal(files.length, 1, 'A different rider search cannot export the previous cache page');

  context.d0TableExportCsv_();
  assert.match(await latestCsv(), /"A","Synthetic HUB A","8","","0",""$/);
  D0.leg = 'attendance';
  context.d0TableExportCsv_();
  assert.match(await latestCsv(), /"A","Synthetic HUB A","0","7","0","5","2","3","0",""$/);
  D0.attendanceTab = 'shifts';
  context.d0TableExportCsv_();
  assert.match(await latestCsv(), /"22:00-06:00 \(Previous day · 18\/11\/2026\)","0","5","0","5","","3","0",""$/);
  context.d0AttendanceDetailExportCsv_();
  assert.match(await latestCsv(), /"22:00-06:00 \(Previous day · 18\/11\/2026\)","Active","0","5","0","5","","3","0","","","0","Matched"$/);
  assert.doesNotMatch(await latestCsv(), /<b>|<small>/);

  D0.leg = 'lm';
  const model = context.lmHourlyMultiModel_();
  assert.equal(model.hours[8].assigned, 100);
  assert.equal(model.hours[8].delivered, 50);
  assert.equal(context.lmHourlyRateText_([model.hours[8]],'delivery'), '— (0/2 HUB-giờ đủ cặp)');
  assert.equal(context.lmHourlyRateText_([model.hours[9]],'delivery'), '0.0%');
  assert.equal(context.lmHourlyRateText_([model.hours[9]],'assign'), '66.7% (1/2 HUB-giờ đủ cặp)');
  assert.equal(context.lmHourlyRateText_([model.hours[10]],'delivery'), '50.0%');
  assert.equal(context.lmHourlyRateText_(model.hours,'delivery'), '30.0% (2/4 HUB-giờ đủ cặp)');
  assert.match(context.lmHourlyPanel_(), /Tỷ lệ giao: <em>30\.0% \(2\/4 HUB-giờ đủ cặp\)/);
  Object.assign(LmHourly, { window: 'custom', fromHour: 8, toHour: 8 });
  assert.match(context.lmHourlyPanel_(), /Tỷ lệ giao: <em>— \(0\/2 HUB-giờ đủ cặp\)/);
  LmHourly.window = 'all';
  context.lmHourlyExportCsv_();
  assert.match(await latestCsv(), /"08:00","","100","50","— \(0\/2 HUB-giờ đủ cặp\)","2"/);
  assert.match(await latestCsv(), /"09:00","160","40","0","0\.0%","2"/);

  D0.sectionTimes.hourly = 0;
  for (const mode of ['combined', 'single']) {
    LmHourly.mode = mode;
    D0.loading = true;
    D0.sectionErrors = {};
    assert.match(context.lmHourlyPanel_(), /aria-busy="true".*Đang tải/);
    D0.sectionErrors.hourly = true;
    assert.match(context.lmHourlyPanel_(), /aria-busy="false".*Chưa tải được/);
    D0.loading = false;
    assert.match(context.lmHourlyPanel_(), /aria-busy="false".*Chưa tải được/);
  }

  const perfBind = source.slice(source.indexOf('var perfBind=bind;'), source.indexOf('// Daily Snapshot keeps'));
  const refreshButton = {};
  context.bind = () => {};
  context.document.getElementById = id => id === 'd0Refresh' ? refreshButton : null;
  vm.runInContext(perfBind, context);
  for (const loading of [false, true]) {
    D0.loading = loading;
    const label = loading ? 'Updating…' : 'Refresh data';
    const html = context.d0ViewSelector();
    assert.ok(html.includes('<svg></svg> ' + label));
    assert.equal(html.includes(' disabled'), loading);
    refreshButton.textContent = label;
    context.bind();
    assert.equal(refreshButton.textContent, label, 'The late binder keeps the visible refresh label');
  }
  console.log('PASS: D0 serialized rider, backlog, attendance and hourly CSV, paired HUB-hour rates, refresh labels and settled loading states.');
}


const flushD0 = () => new Promise(resolve => setImmediate(resolve));
function d0Queue(leg) {
  const requests = [], paints = [], pending = new Map(), frames = new Map(), riders = [];
  let nextFrame = 0, maxActive = 0;
  const D0 = { leg, error: '', generation: 0, riderCache: {}, riderError: {}, riderLoading: {} };
  const state = { page: 'd0', bootReady: true };
  const context = vm.createContext({
    D0, state, setTimeout() {}, clearTimeout() {}, document: { querySelectorAll: () => [] },
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    render() { paints.push({ loading: D0.loading, sections: Object.keys(D0.sectionTimes), error: D0.error }); },
    d0FetchRiders: force => riders.push(force),
    d0SnapshotRequest(force, section) {
      assert(!pending.has(section), 'A section must have at most one in-flight request');
      requests.push([force, section]);
      return new Promise((resolve, reject) => {
        pending.set(section, { resolve, reject });
        maxActive = Math.max(maxActive, pending.size);
      });
    }
  });
  load(context, 'd0IsPage', 'd0IsAttendancePage', 'd0ViewSections', 'd0Fetch');
  return {
    context, D0, state, requests, paints, riders, pending,
    get maxActive() { return maxActive; },
    settle(section, result = { section, sheets: { [section]: [] } }) {
      const request = pending.get(section);
      assert(request, section + ' must be in flight');
      pending.delete(section);
      if (result instanceof Error) request.reject(result);
      else request.resolve(result);
    },
    paint() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(fn => fn());
    }
  };
}

test('D0 Overview overlaps FM and LM, paints progress once per frame, and retains all six feeds', async () => {
  const queue = d0Queue('overview');
  const loading = queue.context.d0Fetch(false);
  await flushD0();
  assert.deepEqual(queue.requests, [[false, 'fm'], [false, 'lm']]);
  queue.settle('fm');
  await flushD0();
  assert.deepEqual([...queue.pending.keys()], ['lm', 'attendance'], 'A free slot starts the next section before LM settles');
  queue.paint();
  assert.deepEqual(queue.paints.at(-1), { loading: true, sections: ['fm'], error: '' });
  queue.settle('lm');
  queue.settle('attendance');
  await flushD0();
  assert.deepEqual([...queue.pending.keys()], ['delivery', 'fmPickup']);
  assert.equal(queue.paints.length, 2, 'RPC callbacks merge data without immediately repainting');
  queue.paint();
  assert.deepEqual(queue.paints.at(-1).sections, ['fm', 'lm', 'attendance']);
  assert.equal(queue.paints.length, 3, 'Two settlements share a single paint');
  queue.settle('delivery');
  await flushD0();
  queue.settle('fmPickup');
  queue.settle('hourly');
  await loading;
  assert.equal(queue.maxActive, 2);
  assert.equal(queue.paints.length, 4, 'The final paint replaces a pending progress frame');
  queue.paint();
  assert.equal(queue.paints.length, 4);
  assert.deepEqual(queue.paints.at(-1), { loading: false, sections: ['fm', 'lm', 'attendance', 'delivery', 'fmPickup', 'hourly'], error: '' });
  await queue.context.d0Fetch(false);
  assert.equal(queue.requests.length, 6, 'Fresh successful empty feeds are reused');
});

test('D0 navigation replaces queued work, uses a spare slot, and ignores off-view errors', async () => {
  const queue = d0Queue('fm');
  queue.D0.sectionTimes = { fmPickup: Date.now() };
  const loading = queue.context.d0Fetch(false);
  await flushD0();
  assert.deepEqual([...queue.pending.keys()], ['fm']);
  queue.D0.leg = 'lm';
  assert.equal(queue.context.d0Fetch(false), loading);
  await flushD0();
  assert.deepEqual([...queue.pending.keys()], ['fm', 'lm'], 'Navigation fills the idle slot while FM is still pending');
  queue.settle('fm', Error('Synthetic FM failure'));
  await flushD0();
  assert.deepEqual([...queue.pending.keys()], ['lm', 'hourly']);
  queue.settle('lm');
  await flushD0();
  assert.deepEqual([...queue.pending.keys()], ['hourly', 'delivery']);
  queue.settle('hourly');
  queue.settle('delivery');
  await loading;
  assert.equal(queue.D0.error, '');
  assert.deepEqual(queue.requests.map(([,section]) => section), ['fm', 'lm', 'hourly', 'delivery']);
  assert.equal(queue.context.d0Fetch(false), undefined, 'Re-entering a warm LM does not read again');

  queue.D0.leg = 'overview';
  const overview = queue.context.d0Fetch(false);
  await flushD0();
  assert.deepEqual([...queue.pending.keys()], ['fm', 'attendance'], 'Re-entering Overview retries its missing FM and keeps the warm LM feeds');
  const paintsBeforeLeaving = queue.paints.length;
  queue.state.page = 'dashboard';
  queue.settle('fm');
  queue.settle('attendance');
  await overview;
  queue.paint();
  assert.equal(queue.paints.length, paintsBeforeLeaving, 'Late results do not repaint another page');
  assert.deepEqual(queue.requests.map(([,section]) => section), ['fm', 'lm', 'hourly', 'delivery', 'fm', 'attendance']);
});

test('D0 queued Refresh retries the current view without discarding usable data or duplicating rider reloads', async () => {
  const queue = d0Queue('overview');
  queue.D0.ridersOpened = true;
  queue.D0.riderCache = { old: {} };
  const loading = queue.context.d0Fetch(false);
  await flushD0();
  queue.D0.leg = 'lm';
  assert.equal(queue.context.d0Fetch(true), loading);
  assert.equal(queue.context.d0Fetch(false), loading);
  queue.settle('lm', { section: 'lm', sheets: { lm: ['prior'] }, todayForecast: { date: '2026-11-22' } });
  await flushD0();
  assert.deepEqual([...queue.pending.keys()], ['fm'], 'Refresh waits for the active pass and skips its remaining queue');
  queue.settle('fm');
  await flushD0();
  assert.deepEqual(queue.requests, [[false, 'fm'], [false, 'lm'], [true, 'lm'], [true, 'hourly']]);
  queue.settle('hourly', { section: 'wrong', sheets: { hourly: ['bad'] } });
  queue.settle('lm', Error('Synthetic LM refresh failure'));
  await flushD0();
  assert.deepEqual([...queue.pending.keys()], ['delivery'], 'Failures do not stall the remaining section or retry in a loop');
  queue.settle('delivery');
  await loading;
  assert.match(queue.D0.error, /^lm: Synthetic LM refresh failure · hourly: The D0 snapshot response was empty or invalid/);
  assert.deepEqual(queue.D0.data.sheets.lm, ['prior']);
  assert.equal(queue.D0.forecasts.lm.date, '2026-11-22');
  assert.equal(queue.D0.sectionTimes.hourly, undefined);
  assert.deepEqual(Object.keys(queue.D0.riderCache), []);
  assert.equal(queue.D0.generation, 1);
  assert.deepEqual(queue.riders, [true], 'The opened rider detail is refreshed once when the summary finishes');

  const retry = queue.context.d0Fetch(true);
  await flushD0();
  queue.settle('lm');
  queue.settle('hourly');
  await flushD0();
  queue.settle('delivery');
  await retry;
  assert.equal(queue.D0.error, '');
  assert.equal(queue.D0.forecasts.lm, null, 'A successful response without a plan clears the prior plan');
  assert.ok(queue.D0.sectionTimes.hourly);
});

test('D0 LM Refresh forces one rider RPC when delivery settles ahead of hourly', async () => {
  const { context, D0, pending, paint, settle } = d0Queue('lm');
  const refresh = {}, timers = [], riderForces = [];
  const render = context.render;
  Object.assign(context, {
    bind() {}, isNormalAccount: () => false,
    render() { render(); context.bind(); },
    setTimeout(fn, delay) { if (delay === 0) timers.push(fn); },
    d0ChosenRiderHub: () => ({ code: 'A' }),
    d0UpdateRiders() {},
    google: { script: { run: {
      withSuccessHandler() { return this; },
      withFailureHandler() { return this; },
      getD0Riders(code, page, sort, direction, force) { riderForces.push(force); }
    } } }
  });
  context.document.getElementById = id => id === 'refreshBtn' ? refresh : null;
  Object.assign(D0, { data: { sheets: {} }, ridersOpened: true, riderPage: 1 });
  load(context, 'd0RiderCacheKey', 'd0FetchRiders');
  vm.runInContext(source.slice(source.indexOf('var perfBind=bind;'), source.indexOf('// Daily Snapshot keeps')), context);
  const runTimers = () => timers.splice(0).forEach(fn => fn());

  context.bind();
  assert.equal(timers.length, 1, 'An idle bind still schedules an opened rider panel');
  refresh.onclick();
  const loading = D0.load.promise;
  runTimers();
  const preRefreshTimerCalls = riderForces.length;
  await flushD0();
  settle('lm');
  await flushD0();
  settle('delivery');
  await flushD0();
  assert.deepEqual([...pending.keys()], ['hourly']);
  assert.equal(D0.generation, 1);
  paint();
  const progressTimers = timers.length;
  runTimers();
  settle('hourly');
  await loading;
  runTimers();

  assert.deepEqual(riderForces, [true], 'The summary completion owns the forced rider RPC');
  assert.equal(preRefreshTimerCalls, 0, 'A timer queued before Refresh cannot read while it is active');
  assert.equal(progressTimers, 0, 'The progress binder does not schedule a new rider read');
});

test('D0 delivery refresh keeps late results from repopulating the rider cache', async () => {
  const { context, D0, settle } = d0Queue('lm');
  let completeRiders;
  Object.assign(context, {
    d0ChosenRiderHub: () => ({ code: 'A' }),
    d0UpdateRiders() {},
    google: { script: { run: {
      withSuccessHandler(fn) { completeRiders = fn; return this; },
      withFailureHandler() { return this; },
      getD0Riders() {}
    } } }
  });
  Object.assign(D0, { riderPage: 1, riderSort: 'driver_id', riderDirection: 'asc' });
  load(context, 'd0RiderCacheKey', 'd0FetchRiders');
  context.d0FetchRiders(false);
  assert.equal(typeof completeRiders, 'function');
  const loading = context.d0Fetch(true);
  await flushD0();
  settle('lm');
  await flushD0();
  settle('delivery');
  settle('hourly');
  await loading;
  assert.equal(D0.generation, 1);
  completeRiders({ rows: [{ driver_id: 'older' }] });
  await flushD0();
  assert.deepEqual(Object.keys(D0.riderCache), []);
});

test('D0 LM hourly status stops announcing loading after an hourly failure', async () => {
  const queue = d0Queue('lm');
  Object.assign(queue.context, {
    LmHourly: { mode: 'combined', metric: 'received' }, lmHourlyMetrics: [['received', 'Received']],
    e: String, appExportIcon: () => '', lmHourlyWindowBounds_: () => ({}),
    lmHourlyMultiModel_: () => ({ hubs: [] }), lmHourlyModel_: () => ({ hubs: [] })
  });
  load(queue.context, 'd0SectionReady', 'lmHourlyPanel_');
  const assertHourlyStatus = regex => {
    for (const mode of ['combined', 'single']) {
      queue.context.LmHourly.mode = mode;
      assert.match(queue.context.lmHourlyPanel_(), regex);
    }
  };
  const loading = queue.context.d0Fetch(false);
  await flushD0();
  queue.settle('lm');
  await flushD0();
  assertHourlyStatus(/aria-busy="true".*role="status">Đang tải/);
  queue.settle('hourly', Error('Synthetic hourly failure'));
  await flushD0();
  assert.equal(queue.D0.loading, true, 'Delivery is still loading');
  assertHourlyStatus(/aria-busy="false".*role="status">Chưa tải được/);
  queue.settle('delivery');
  await loading;
  assertHourlyStatus(/aria-busy="false".*role="status">Chưa tải được/);
});

test('D0 Overview indexes hourly aliases once per source and keeps HUB row order and backlog totals', () => {
  const field = 'lm_hub_received_in_system_order_qty_1h';
  const nameMatch = { station_name: ' Depot A ', hour: 14, [field]: 3 };
  const crossCode = { station_id: ' A ', hour: 13, [field]: 2 };
  const multiMatch = { hub_code: ' a ', station_id: '12', station_name: 'depot a', hour: 15, [field]: 4 };
  const crossId = { hub_code: ' 12 ', hour: 12, [field]: 1 };
  const source = [nameMatch, { station_name: 'A', hour: 9, [field]: 100 }, crossCode,
    { hub_code: 'Depot A', hour: 10, [field]: 100 }, multiMatch, crossId, nameMatch];
  const D0 = { data: { sheets: { 'Throughput Hourly D0': source } } };
  const context = vm.createContext({ D0, Date: class extends Date { constructor() { super('2026-11-22T07:00:00Z'); } } });
  load(context, 'd0Num', 'd0HubHourlyRows_', 'd0HubHourlyInbound_', 'd0BacklogSplit_', 'd0BacklogSplitTotal_');
  const hub = { code: 'A', id: '12', name: 'Depot A', lm: { backlog_d0: 12 } };
  assert.deepEqual(Array.from(context.d0HubHourlyRows_(hub)), [nameMatch, crossCode, multiMatch, crossId, nameMatch]);
  const split = context.d0BacklogSplit_(hub);
  assert.deepEqual({ ...split }, { total: 12, d0: 2, d1: 10, inbBefore13: 3, inbAfter13: 10 });
  assert.equal(context.d0HubHourlyInbound_({ code: 'missing' }), null);

  let codeReads = 0;
  const hubs = Array.from({ length: 120 }, (_, i) => ({ code: 'H' + i, lm: { backlog_d0: 30 } }));
  const rows = hubs.flatMap(({ code }) => Array.from({ length: 24 }, (_, hour) => ({
    get hub_code() { codeReads++; return code; }, hour, [field]: 1
  })));
  D0.data.sheets['Throughput Hourly D0'] = rows;
  const totals = context.d0BacklogSplitTotal_(hubs);
  assert.deepEqual({ ...totals }, { total: 3600, d0: 2400, d1: 1200, inbBefore13: 1680, inbAfter13: 1200 });
  assert.equal(codeReads, 2880, 'Each hourly code is read once across 120 HUBs');
  context.d0BacklogSplitTotal_(hubs);
  assert.equal(codeReads, 2880, 'The same array reuses the index on the next render');
});

async function verifyD0FinalRiderBinding() {
  const calls=[],buttons={d0ViewRiders:{},d0Refresh:{setAttribute(){}}};
  const context=vm.createContext({state:{page:'d0'},D0:{leg:'lm',ridersOpened:false},bind(){},
    document:{getElementById:id=>buttons[id]||null,querySelectorAll:()=>[]},
    d0FetchRiders:force=>calls.push(['riders',force]),d0Fetch:force=>calls.push(['summary',force])});
  load(context,'d0IsPage','d0IsAttendancePage','d0BindRiderControls','d0BindRiderSort','opsBindRiderMobile');
  const mainBind=source.slice(source.indexOf('var d0OriginalBind=bind;'),source.indexOf("if(typeof WorkspaceNavigation!=="));
  assert(mainBind.includes('d0BindRiderControls();'));
  vm.runInContext(mainBind,context);
  // Apply the real later wrappers in source order: they must retain the cache-aware owning binding.
  for(const prefix of ['var opsOriginalRiderBind=','var opsOriginalBind=']) {
    const line=source.split('\n').find(line=>line.startsWith(prefix));assert(line);vm.runInContext(line,context);
  }
  context.bind();buttons.d0ViewRiders.onclick();
  assert.equal(context.D0.ridersOpened,true);assert.deepEqual(calls,[['riders',false]]);
  buttons.d0Refresh.onclick();assert.deepEqual(calls.at(-1),['summary',true],'Explicit summary refresh remains forceful');
  // Replacing the rider panel rebinds controls through the final wrapper again.
  buttons.d0ViewRiders={};context.d0BindRiderControls();buttons.d0ViewRiders.onclick();
  assert.deepEqual(calls.at(-1),['riders',false]);
  assert.equal(source.match(/var view=document.getElementById\('d0ViewRiders'\)/g).length,1,'Only the owning rider binder assigns this handler');
  console.log('PASS: D0 actual main/final rider binding order and rebind reuse fresh reads; explicit refresh still forces.');
}

test('D0 source panel, exports, and legacy reports', async () => {
  await verifyD0Ui();
  await verifyD0ExportsAndHourly();
  await verifyD0FinalRiderBinding();
});
