const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read } = require('./source.cjs');

// Exercise the active renderer, including its empty groups and all-HUB totals.
const source = read('Javascript.html');
const start = source.lastIndexOf('\nfunction flmClaimsZoneTable_(') + 1;
const end = source.indexOf('\nfunction ', start + 1);
assert.ok(start > 0 && end > start, 'Active Zone renderer must exist');
const zones = [
  { name: 'Zone <One>', aomName: 'Owner & One', aomEmail: 'one@example.test' },
  { name: 'Zone Two', aomName: 'Owner Two', aomEmail: 'two@example.test' }
];
const context = {
  FLM_ZONES_CONFIG: zones,
  flmBuildHubToZoneMap_: () => Object.fromEntries(['A', 'B', 'C', 'D'].map(code => [code, zones[0]])),
  flmClassifyOrder_: row => ({ cogs: row.amount, isHV: row.amount >= 1000000, isFM: true, isLM: false, isRT: false, isEHA: false }),
  flmTeamFmt_: value => Number(value).toLocaleString('en-US'),
  appExportIcon: () => '<svg aria-hidden="true"></svg>',
  e: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const orders = [1500000, 200, 300, 400].map((amount, i) => ({
  hub: i === 0 ? 'Hub <A&>' : 'Hub ' + i, hubCode: 'ABCD'[i], amount
}));
for (const lost of [true, false]) {
  const html = context.flmClaimsZoneTable_({ rawOrders: orders, lost });
  assert.equal((html.match(/<tbody class="cl-zone-body">/g) || []).length, 2);
  assert.equal((html.match(/class="cl-zone-group is-empty"/g) || []).length, 1);
  assert.equal((html.match(/class="cl-zone-hub-row"/g) || []).length, 3, 'Only the top three HUBs are shown');
  assert.ok(html.includes('Zone &lt;One&gt;') && html.includes('Owner &amp; One') && html.includes('Hub &lt;A&amp;&gt;'));
  assert.equal((html.match(/data-cl-drill-zone=/g) || []).length, 2, 'Empty Zones remain navigable');
  assert.equal((html.match(/data-cl-drill-hub=/g) || []).length, 3);
  const total = html.match(/<tr class="tr-network-total">([\s\S]*?)<\/tr>/)[1];
  assert.ok(total.includes('1,500,900'), 'Total includes the fourth HUB omitted from the top three');
  assert.equal((total.match(/<th\b/g) || []).length, 1);
  assert.equal((total.match(/<td\b/g) || []).length, 8);
  for (const row of html.matchAll(/<tr class="cl-zone-hub-row">([\s\S]*?)<\/tr>/g)) {
    assert.equal((row[1].match(/<td\b/g) || []).length, 9, 'Data columns match grouped headers');
  }
  assert.ok(html.includes('class="td-num td-fm"') && html.includes('class="td-num td-lm"') && html.includes('class="td-num td-rt"') && html.includes('class="td-num td-eha"'), 'Operations columns have distinct classes');
  assert.ok(total.includes('class="td-num td-fm"') && total.includes('class="td-num td-lm"') && total.includes('class="td-num td-rt"') && total.includes('class="td-num td-eha"'), 'Total row operations columns have distinct classes');
}
const empty = context.flmClaimsZoneTable_({ rawOrders: [], lost: true });
assert.equal((empty.match(/class="cl-zone-group is-empty"/g) || []).length, 2);
assert.ok(!empty.includes('class="cl-zone-hub-row"'), 'Empty Zones do not manufacture zero-valued HUB rows');
const zero = context.flmClaimsZoneTable_({ rawOrders: [{ hub: 'Zero Hub', hubCode: 'A', amount: 0 }], lost: true });
assert.ok(zero.includes('Zero Hub') && zero.includes('<td class="td-money">0</td>'), 'An observed zero amount remains visible');
console.log('PASS: grouped Claims UI, empty Zones, escaped labels, drill targets, nine-column rows and all-HUB totals.');

function loadActive(context, ...names) {
  const normalizedSource = source.replace(/\r\n/g, '\n');
  for (const name of names) {
    const pattern = new RegExp('^([ \t]*)(?:async )?function ' + name + '\\(', 'gm');
    const found = [...normalizedSource.matchAll(pattern)].at(-1);
    assert.ok(found, name);
    const tail = normalizedSource.slice(found.index);
    const close = tail.split('\n', 1)[0].endsWith('}') ? /\n/ : new RegExp('^' + found[1] + '}\\s*$', 'm');
    const end = tail.search(close);
    assert.ok(end > 0, name);
    vm.runInContext(tail.slice(0, end + (close.source === '\\n' ? 0 : found[1].length + 1)), context);
  }
}

let rank = 'ADMIN';
let allData = true;
let allowedNodes = orders.map(order => ({ label: order.hub, value: order.hubCode }));
let headerHub = '';
Object.assign(context, {
  state: { page: 'compensated', drillPath: {}, selectedHubCodes: [] },
  FLMClaims: { tab: 'lost', period: 'mtd', page: 1, pageSize: 10, expanded: {} },
  FLMTeam: { claims: {} },
  accessInfo: () => ({ rank, allData }),
  currentOrgHubNodes: () => allowedNodes,
  effectiveSelectedHubCodes: () => context.state.selectedHubCodes.length ?
    context.state.selectedHubCodes.filter(code => allowedNodes.some(node => node.value === code)) :
    allowedNodes.map(node => node.value),
  flmTeamVolumeHub_: () => headerHub,
  flmResolveLostAmount_: row => row.amount || 0,
  flmResolveLostReason_: () => 'Fixture reason',
  designNavIcon: () => '',
  clientPageAllowed_: () => true
});
loadActive(context, 'normalizeClientRoleList_', 'hubMapName', 'flmClaimsAllowedViews_', 'flmGetActiveScopeView_',
  'flmClaimsScopeTabs_', 'flmGetScopeInfo_', 'flmClaimsHubRows_', 'flmClaimsHubsTable_',
  'flmClaimsOrdersTable_', 'flmClaimsTable_', 'flmClaimsResults_', 'flmClaimsUpdate_',
  'flmClaimsBindResults_', 'flmClaimsBind_', 'flmClaimsExport_', 'flmClaimsModalHub_',
  'flmOpenHubOrdersModal_', 'flmRenderHubOrdersModal_', 'flmCloseHubOrdersModal_',
  'flmExportHubOrdersCsv_', 'flmClaimsModel_', 'flmClaimsText_', 'flmMatchHub_',
  'flmBuildSupabaseLostSource_', 'flmBuildSupabaseRiskSource_', 'flmHubOrdersData_');
for (const lost of [true, false]) {
  const html = context.flmClaimsHubsTable_({ rawOrders: orders, lost });
  assert.match(html, /<div class="cl-hub-table-wrap" tabindex="0" role="region" aria-labelledby="claims-all-hubs-title">/);
  assert.equal((html.match(/<th scope="col">/g) || []).length, 12);
  const firstRow = html.match(/<tbody><tr>(.*?)<\/tr>/)[1];
  assert.equal((firstRow.match(/<td>/g) || []).length, 12);
  assert.match(firstRow, /<td><b>Hub &lt;A&amp;&gt;<\/b><\/td><td>A<\/td>/);
  assert.match(firstRow, /data-cl-drill-hub="Hub &lt;A&amp;&gt;"/);
}
console.log('PASS: All HUB table columns, keyboard-scroll region and order drill targets.');

// Supabase publishable keys belong in apikey, not in a Bearer JWT header.
const headersHelper = source.match(/function flmSupabaseHeaders_\(key\)\{[\s\S]*?\n\}/);
assert.ok(headersHelper, 'Supabase headers helper must exist');
const headers = vm.runInNewContext(headersHelper[0] + '\nflmSupabaseHeaders_');
const publishable = headers('sb_publishable_example');
assert.equal(publishable.apikey, 'sb_publishable_example');
assert.equal(publishable.Authorization, undefined);
assert.equal(headers('legacy.example.key').Authorization, 'Bearer legacy.example.key');
console.log('PASS: Supabase publishable and legacy key headers.');

async function verifyLostPagination() {
  const loader = source.match(/async function flmFetchSupabaseLostRows_\([\s\S]*?\n\}/);
  assert.ok(loader, 'Lost pagination helper must exist');
  const requests = [];
  const loadRows = vm.runInNewContext(loader[0] + '\nflmFetchSupabaseLostRows_', {
    URL,
    async fetch(value) {
      const url = new URL(value);
      requests.push(url.searchParams);
      const offset = Number(url.searchParams.get('offset'));
      return { ok: true, json: async () => Array.from({ length: offset ? 1 : 1000 }, (_, i) => offset + i) };
    }
  });
  const url = 'https://example.test/rest/v1/lost_claims?claim_date=gte.2026-11-01&claim_date=lte.2026-11-14';
  const rows = await loadRows(url, {}, true);
  assert.equal(rows.length, 1001);
  assert.equal(rows.at(-1), 1000);
  assert.deepEqual(requests.map(params => params.get('offset')), ['0', '1000']);
  assert.ok(requests.every(params => params.getAll('claim_date').join(',') === 'gte.2026-11-01,lte.2026-11-14' && params.get('order') === 'claim_date.desc,id.asc'));
  requests.length = 0;
  await loadRows(url, {}, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].has('offset'), false);
  console.log('PASS: Lost pagination keeps the date filter and reads beyond 1,000 rows.');
}
verifyLostPagination().catch(error => { console.error(error); process.exitCode = 1; });

async function verifySupabaseSourceCheck() {
  const checker = source.match(/async function flmCheckSupabaseSources_\([^)]*\)\{[\s\S]*?\n\}/);
  assert.ok(checker, 'Claims source checker must exist');
  const requested = [];
  const context = {
    URL,
    FLMSupabaseBench: { url: 'https://unrelated.example.test/', apiKey: 'example' },
    FLMSupabaseRisk: {
      prelostUrl: 'https://db.example.test/rest/v1/prelost_claims?claim_date=eq.2026-11-08',
      alertUrl: 'https://db.example.test/rest/v1/alert_claims',
      apiKey: 'example'
    },
    flmSupabaseHeaders_: key => ({ apikey: key }),
    async fetch(url, options) {
      requested.push(url.pathname.split('/').at(-1));
      assert.equal(url.hostname, 'db.example.test');
      assert.equal(url.searchParams.get('select'), 'claim_date');
      assert.equal(url.searchParams.get('limit'), '1');
      assert.equal(options.headers.apikey, 'example');
      if (url.pathname.endsWith('prelost_claims')) {
        assert.equal(url.searchParams.get('claim_date'), 'eq.2026-11-08');
        return { ok: true, json: async () => [] };
      }
      if (url.pathname.endsWith('alert_claims')) return { ok: false, status: 403 };
      return { ok: true, json: async () => [{ claim_date: '2026-11-14' }] };
    }
  };
  const check = vm.runInNewContext(checker[0] + '\nflmCheckSupabaseSources_', context);
  const result = await check();
  assert.deepEqual(requested, ['lost_claims', 'prelost_claims', 'alert_claims']);
  assert.equal(result.ok, false);
  assert.equal(result.sources.map(item => item.status).join(','), 'AVAILABLE,EMPTY,ERROR');
  assert.equal(result.sources[0].dates[0], '2026-11-14');
  console.log('PASS: Claims source checks distinguish Supabase data, empty results and denied reads.');
}
verifySupabaseSourceCheck().catch(error => { console.error(error); process.exitCode = 1; });

// Selecting a Claims submenu item must work from outside the report page.
const sidebarContext = {
  state: { page: 'dashboard', activeModuleChild: 'old' }, FLMClaims: { tab: 'lost', query: 'old' },
  designNavIcon: () => '',
  innerWidth: 390, clientPageAllowed_: () => true,
  setSidebarCollapsed_(open) { this.mobileMenuOpen = open; },
  renderForPageNavigation_(page) { sidebarContext.state.page = page; },
  flmTeamLoad_() {}, document: { querySelector() { return null; } }
};
vm.createContext(sidebarContext);
for (const name of ['flmClaimsSidebar_', 'flmClaimsSelectView_']) {
  const code = source.match(new RegExp('function '+name+'\\([\\s\\S]*?\\n\\}'));
  assert.ok(code, name);
  vm.runInContext(code[0], sidebarContext);
}
assert.match(sidebarContext.flmClaimsSidebar_(), /aria-expanded="false"/);
sidebarContext.flmClaimsSelectView_('risk');
assert.equal(sidebarContext.state.page, 'compensated');
assert.equal(sidebarContext.FLMClaims.query, '');
assert.equal(sidebarContext.state.activeModuleChild, '');
const sidebar = sidebarContext.flmClaimsSidebar_();
assert.match(sidebar, /aria-expanded="true"/);
assert.match(sidebar, /data-cl-tab="risk"[^>]*aria-current="page"/);
assert.doesNotMatch(sidebar, /claims-nav-count/);
sidebarContext.clientPageAllowed_ = () => false;
sidebarContext.flmClaimsSelectView_('lost');
assert.equal(sidebarContext.FLMClaims.tab, 'risk');
console.log('PASS: Claims submenu navigation, active selection and count-free labels.');

// The Claims header retains the shared filters and leaves refresh to the toolbar.
const headerContext = vm.createContext({ flmTeamVolumeFilters_: () => '<div id="scope-filters"></div>' });
for (const name of ['flmClaimsHeader_', 'moduleSourceName_', 'moduleSourceMarkup_']) {
  const start = source.indexOf('\nfunction ' + name + '(') + 1;
  const end = source.indexOf(name === 'moduleSourceMarkup_' ? '\nvar moduleSourceBaseRender_' : '\nfunction ', start);
  assert.ok(start > 0 && end > start, name);
  vm.runInContext(source.slice(start, end), headerContext);
}
const claimsHeader = headerContext.moduleSourceMarkup_(headerContext.flmClaimsHeader_(), 'compensated');
assert.match(claimsHeader, /<h1>Compensated & Lost<\/h1>/);
assert.match(claimsHeader, /id="scope-filters"/);
assert.doesNotMatch(claimsHeader, /module-source-label|Track claims|flmTeamAnchor|cl-report-bar|flmTeamRefresh/);
assert.match(headerContext.moduleSourceMarkup_('<h1>Pickup</h1>', 'pickup'), /data-module-source="Gsheet"/);
console.log('PASS: compact Claims header retains scope filters; Pickup source label remains available.');


const controls = new Map();
const buttons = new Map();
const downloads = [];
function control(dataset) {
  return { dataset, addEventListener(type, callback, capture) { this.change = callback; assert.equal(capture, true); } };
}
Object.assign(context, {
  FLMSupabaseBench: {},
  flmLostRange_: () => ({ from: '2026-11-01', to: '2026-11-18' }),
  flmLostSlot_: () => context.lostFixture,
  flmTeamLoad_() {},
  FLMSupabaseRisk: { prelostData: [], alertData: [] },
  document: {
    getElementById: id => controls.get(id),
    querySelectorAll: selector => buttons.get(selector) || [],
    querySelector: () => null,
    createElement: () => ({ click() {} }),
    body: { classList: { remove() {} } }
  },
  render() {},
  setTimeout() {},
  Blob,
  URL: { createObjectURL(blob) { downloads.push(blob); } },
  availableAoms: () => [{ email: 'one@example.test' }],
  resetHubSelection() {},
  syncCurrentScope() {},
  invalidateScopeData() {},
  appExportIcon: () => ''
});
const reports = ['lost', 'risk'];
const reportOrders = [
  { hubCode: 'A', hub: orders[0].hub, orderId: 'VISIBLE-ONE' },
  { hubCode: 'B', hub: orders[1].hub, orderId: 'VISIBLE-TWO' },
  { hubCode: 'C', hub: orders[2].hub, orderId: 'OTHER-HUB' },
  { hubCode: 'AA', hub: orders[0].hub, orderId: 'OTHER-HUB-SIMILAR' },
  { hub: orders[0].hub, orderId: 'NAME-ONLY' },
  { orderId: 'NO-HUB' }
].map(row => ({ ...row, amount: 100, cogs: 100, riskType: 'prelost', date: '2026-11-18' }));
context.lostFixture = { rows: reportOrders };
context.FLMSupabaseRisk.prelostData = reportOrders;
context.FLMHubOrders = { active: false, query: '' };
context.uiDateLabel = value => value;
context.flmClaimsLabel_ = value => value;
context.flmClaimsMoney_ = () => '';
context.flmTeamTable_ = (headers, rows) => '<table>' + rows.join('') + '</table>';
context.flmClaimsPagination_ = () => '';
context.flmClaimsKnown_ = () => 100;
context.flmClaimsMissing_ = () => 0;
const fakeTab = control({ clScopeView: 'zone' });
const fakeHub = control({ clDrillHub: orders[0].hub });
const fakeZone = control({ clDrillZone: 'one@example.test' });
const fakeDetail = control({ clDetail: 'VISIBLE-ONE' });
const fakeModal = control({ clHubOrders: 'A' });
buttons.set('[data-cl-scope-view]', [fakeTab]);
buttons.set('[data-cl-drill-zone]', [fakeZone]);
buttons.set('[data-cl-drill-hub]', [fakeHub]);
buttons.set('[data-cl-detail]', [fakeDetail]);
buttons.set('[data-cl-hub-orders]', [fakeModal]);
const fakeScope = control({});
controls.set('drillSupSelect', fakeScope);
const staleResults = { innerHTML: '' };
controls.set('flmClaimResults', staleResults);
const event = { preventDefault() {} };
context.flmClaimsBind_();

async function verifyRoleViews() {
  for (const tab of reports) {
    context.FLMClaims.tab = tab;
    for (const topRank of ['ROM', ' aDmIn ', 'SAOM']) {
      rank = topRank;
      context.state.drillPath = {};
      context.FLMClaims.hubFilter = 'all';
      context.FLMClaims.manualScopeView = 'invalid';
      assert.equal(context.flmGetActiveScopeView_(), 'zone');
      assert.equal((context.flmClaimsScopeTabs_('zone').match(/data-cl-scope-view=/g) || []).length, 3);
      for (const view of ['zone', 'hub', 'orders']) {
        context.FLMClaims.manualScopeView = view;
        assert.equal(context.flmGetActiveScopeView_(), view);
      }
      fakeTab.onclick();
      fakeZone.onclick(event);
      assert.equal(context.state.drillPath.aomEmail, 'one@example.test');
      assert.equal(context.flmGetActiveScopeView_(), 'hub');
      fakeHub.onclick(event);
      assert.equal(context.flmGetActiveScopeView_(), 'orders');
      assert.equal(context.FLMClaims.hubFilter, orders[0].hub);
      context.state.drillPath.supEmail = 'sup@example.test';
      context.FLMClaims.hubFilter = 'all';
      fakeScope.change();
      assert.equal(context.flmGetActiveScopeView_(), 'orders');
    }

    allData = false;
    rank = ' aom ';
    allowedNodes = allowedNodes.slice(0, 2);
    context.state.selectedHubCodes = ['a', 'A', 'C'];
    context.FLMClaims.manualScopeView = 'orders';
    context.FLMClaims.hubFilter = orders[2].hub;
    fakeTab.onclick();
    fakeHub.onclick(event);
    fakeZone.onclick(event);
    fakeModal.onclick(event);
    fakeDetail.onclick();
    context.flmOpenHubOrdersModal_('A');
    context.flmClaimsUpdate_();
    assert.equal(context.FLMHubOrders.active, false);
    assert.equal(context.FLMClaims.expanded['VISIBLE-ONE'], undefined);
    assert.equal(staleResults.innerHTML, '');
    assert.equal(context.FLMClaims.manualScopeView, 'orders');
    assert.equal(context.flmGetActiveScopeView_(), 'hub');
    const model = context.flmClaimsModel_();
    assert.equal(model.activeHub, '');
    assert.equal(model.rawOrders.map(row => row.orderId).join(','), 'VISIBLE-ONE,NAME-ONLY');
    const html = context.flmClaimsTable_(model);
    assert.match(html, /id="claims-all-hubs-title"/);
    assert.doesNotMatch(html, /data-cl-scope-view|data-cl-drill-hub|flmClaimResults|VISIBLE-ONE|Synthetic unauthorized/);
    assert.equal((html.match(/<th scope="col">/g) || []).length, 11);
    assert.ok(!html.includes('<td>B</td>') && !html.includes('<td>C</td>'));
    context.flmClaimsExport_();
    const aggregateCsv = await downloads.at(-1).text();
    assert.match(aggregateCsv, /"Mã HUB"/);
    assert.match(aggregateCsv, /"A","2","200"/);
    assert.doesNotMatch(aggregateCsv, /"B"|"C"|VISIBLE-|NAME-ONLY|Shipment ID/);
    context.FLMHubOrders.active = true;
    context.FLMHubOrders.hubCode = 'A';
    const beforeModalExport = downloads.length;
    context.flmExportHubOrdersCsv_();
    assert.equal(downloads.length, beforeModalExport);
    context.flmRenderHubOrdersModal_();
    assert.equal(context.FLMHubOrders.active, false);

    context.state.selectedHubCodes = [];
    headerHub = 'B';
    assert.equal(context.flmClaimsModel_().rawOrders[0].orderId, 'VISIBLE-TWO');
    headerHub = '';
    assert.equal(context.flmClaimsModel_().rawOrders.length, 3, 'Same source ref refreshes when effective HUBs change');
    context.state.selectedHubCodes = ['C'];
    assert.equal(context.flmClaimsModel_().rawOrders.length, 0, 'Empty scoped selection stays empty');
    context.state.selectedHubCodes = [];

    for (const detailRank of ['HUB', ' lead 2 ', 'LEAD', 'SUP']) {
      rank = detailRank;
      allowedNodes = orders.slice(0, detailRank === 'HUB' || detailRank.trim() === 'lead 2' ? 1 : 2)
        .map(order => ({ label: order.hub, value: order.hubCode }));
      context.FLMClaims.manualScopeView = 'hub';
      context.FLMClaims.hubFilter = orders[2].hub;
      assert.equal(context.flmGetActiveScopeView_(), 'orders');
      const detailModel = context.flmClaimsModel_();
      assert.equal(detailModel.activeHub, '', 'Disallowed stale HUB filters cannot hide authorized rows');
      const detailHtml = context.flmClaimsTable_(detailModel);
      assert.match(detailHtml, /flmClaimResults/);
      assert.match(detailHtml, /VISIBLE-ONE/);
      assert.doesNotMatch(detailHtml, /data-cl-scope-view|OTHER-HUB|NO-HUB/);
      context.flmClaimsExport_();
      const orderCsv = await downloads.at(-1).text();
      assert.match(orderCsv, /VISIBLE-ONE/);
      assert.doesNotMatch(orderCsv, /OTHER-HUB|NO-HUB/);
      assert.ok(context.flmClaimsModalHub_('A'));
      assert.equal(context.flmClaimsModalHub_('C'), undefined);
    }

    rank = 'CUSTOM';
    assert.equal(context.flmGetActiveScopeView_(), 'hub');
    assert.equal(context.flmClaimsScopeTabs_('hub'), '');
    allData = true;
    allowedNodes = orders.map(order => ({ label: order.hub, value: order.hubCode }));
  }
  console.log('PASS: Lost and At-Risk role views, stale state, scope events, scoped source rows, direct action guards, and summary/detail exports.');
}
verifyRoleViews().catch(error => { console.error(error); process.exitCode = 1; });

// Exercise the actual bind → date availability → ranged request path using
// synthetic PostgREST responses, including an out-of-order completion.
async function verifyLostReportLoading() {
  const endpoint = 'https://db.example.test/rest/v1/lost_claims';
  const requests = [];
  const allRows = [
    ['2026-10-15', 'OUT-OF-RANGE-001'],
    ['2026-10-16', 'PREVIOUS-MONTH-1'],
    ['2026-11-01', 'CURRENT-MONTH-01'],
    ['2026-11-14', 'CURRENT-MONTH-14'],
    ['2026-11-15', 'AFTER-CLOSING-01']
  ].map(([claim_date, order_id], id) => ({ id, claim_date, order_id, hub_code: 'A', hub: 'Hub A' }));
  let utc = '2026-11-17T18:00:00Z';
  let latest = '2026-11-14';
  let holdRolling = true;
  let failNext = false;
  let completeRolling;
  let paints = 0;
  let riskLoads = 0;
  let selector = '';
  const periodButtons = ['mtd', 'l30d'].map(clPeriod => ({ dataset: { clPeriod } }));
  const drillButton = { dataset: { sopOpen: 'compensated' } };
  const report = vm.createContext({
    URL, performance, setTimeout, clearTimeout,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [utc])); }
      static now() { return Date.parse(utc); }
    },
    state: { page: 'compensated' },
    FLMClaims: { tab: 'lost', period: 'mtd' },
    SnapshotOps: {},
    FLMTeam: { claims: {} },
    FLMHubOrders: { active: false },
    FLMSupabaseBench: {
      url: endpoint + '?select=id,claim_date,order_id&area=eq.HCM&claim_date=gte.1999-01-01',
      apiKey: 'fixture-key',
      liveData: [{ id: 'legacy-unbounded' }]
    },
    FLMSupabaseRisk: {},
    FLMSourceUI: { slots: {} },
    flmTeamIsPage_: () => report.state.page === 'compensated',
    fmPendingIsView_: () => false,
    flmTeamClientSlot_: () => report.FLMTeam.claims,
    flmTeamClientRequest_: () => ({}),
    flmTeamClientKey_: () => 'scope',
    flmGetScopeInfo_: () => ({
      allowedNodes: [], scopeKey: 'all', hasScopeRestriction: false, findHub: () => null
    }),
    user: () => ({ email: 'staff@example.test' }),
    accessInfo: () => ({ rank: 'ADMIN' }),
    currentOrgHubCodes: () => [],
    flmFetchSupabaseLiveRisk_: () => { riskLoads++; },
    flmResolveLostReason_: row => row.reason || 'Fixture reason',
    flmResolveLostAmount_: row => row.amount || 0,
    flmSourcePaint_: () => report.render(),
    e: value => String(value || ''),
    uiDateLabel: value => value,
    flmClaimsTabIsLoaded_: () => true,
    flmClaimsSummary_: () => '<summary>Totals</summary>',
    flmClaimsInsights_: () => '',
    flmClaimsTable_: () => '',
    flmClaimsTime_: () => '',
    flmClaimsLabel_: value => value,
    flmClaimsModel_() {
      const source = report.flmBuildSupabaseLostSource_();
      return { source, data: source, total: source.total, lost: true };
    },
    snapshotOpsDate_: () => '2026-10-12',
    renderForPageNavigation_(page) { report.state.page = page; report.render(); },
    render() { paints++; report.flmClaimsBind_(); },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: value => value === selector ? (value === '[data-sop-open]' ? [drillButton] : periodButtons) : []
    },
    fetch(value, options) {
      const url = new URL(value);
      assert.equal(url.origin + url.pathname, endpoint);
      assert.equal(url.searchParams.get('area'), 'eq.HCM');
      assert.equal(options.headers.apikey, 'fixture-key');
      const bounds = url.searchParams.getAll('claim_date');
      const metadata = url.searchParams.get('select') === 'claim_date';
      requests.push({ metadata, bounds, cache: options.cache });
      const ok = rows => ({ ok: true, json: async () => rows });
      if (metadata) {
        assert.equal(url.searchParams.get('limit'), '1');
        return Promise.resolve(ok(latest ? [{ claim_date: latest }] : []));
      }
      assert.equal(url.searchParams.get('order'), 'claim_date.desc,id.asc');
      assert.equal(url.searchParams.get('offset'), '0');
      if (failNext) {
        failNext = false;
        return Promise.resolve({ ok: false, status: 503, statusText: 'Fixture outage' });
      }
      if (holdRolling && bounds[0] === 'gte.2026-10-16') {
        return new Promise(resolve => { completeRolling = () => resolve(ok(allRows)); });
      }
      return Promise.resolve(ok(bounds[1] === 'lte.2026-11-14' ? allRows : []));
    }
  });
  loadActive(report, 'flmClaimsBind_', 'flmClaimsBindResults_', 'flmTeamLoad_', 'flmLostRange_',
    'flmLostSlot_', 'flmLostConfig_', 'flmLostIsActive_', 'flmLoadLostReport_', 'flmFetchSupabaseLiveLost_',
    'flmFetchSupabaseLostRows_', 'flmBuildSupabaseLostSource_', 'flmSupabaseHeaders_', 'volumeShift_',
    'flmSourceToday_', 'flmSourceRequest_', 'flmSourceKey_', 'flmSourceEntry_', 'flmSourceRelevant_',
    'flmCheckSupabaseSources_', 'flmSourceEnsure_', 'flmSourceView_', 'snapshotOpsBind_',
    'flmClaimsRender_', 'flmClaimsLoading_');
  const start = source.indexOf('var flmSourceOriginalLoad_=flmTeamLoad_;');
  const end = source.indexOf('var flmSourceOriginalSnapshotLoad_', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(source.slice(start, end), report);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const records = () => requests.filter(request => !request.metadata);
  const dates = () => Array.from(report.flmBuildSupabaseLostSource_().items || [], row => row.date);

  assert.equal(report.flmBuildSupabaseLostSource_().status, 'LOADING');
  selector = '[data-cl-period]';
  report.flmClaimsBind_();
  report.flmClaimsBind_();
  await settle();
  assert.deepEqual(requests.map(r => r.bounds), [
    ['lte.2026-11-17'], ['gte.2026-11-01', 'lte.2026-11-14']
  ]);
  assert.deepEqual(dates(), ['2026-11-01', '2026-11-14']);
  assert.equal(riskLoads, 0);

  periodButtons[1].onclick();
  await settle();
  assert.equal(report.flmBuildSupabaseLostSource_().status, 'LOADING');
  assert.match(report.flmClaimsRender_({}), /data-cl-period="l30d"[^>]*aria-pressed="true".*role="status"/);
  assert.doesNotMatch(report.flmClaimsRender_({}), /Không có đơn Lost trong kỳ này/);
  assert.deepEqual(dates(), []);
  assert.deepEqual(records()[1].bounds, ['gte.2026-10-16', 'lte.2026-11-14']);
  periodButtons[0].onclick();
  periodButtons[1].onclick();
  report.flmClaimsBind_();
  await settle();
  assert.equal(records().length, 2, 'Repeated activation shares the pending rolling request');
  periodButtons[0].onclick();
  const beforeStalePaint = paints;
  completeRolling();
  await settle();
  assert.equal(paints, beforeStalePaint, 'A rolling response does not repaint the current MTD');
  assert.deepEqual(dates(), ['2026-11-01', '2026-11-14']);

  periodButtons[1].onclick();
  assert.deepEqual(dates(), ['2026-10-16', '2026-11-01', '2026-11-14']);
  assert.equal(records().length, 2, 'The completed range is reused');
  assert.deepEqual(Object.keys(report.flmBuildSupabaseLostSource_().periods), ['l30d']);
  failNext = true;
  holdRolling = false;
  await Promise.all([report.flmTeamLoad_(true), report.flmTeamLoad_(true)]);
  assert.equal(records().length, 3);
  assert.equal(records()[2].cache, 'no-store');
  assert.equal(report.flmBuildSupabaseLostSource_().status, 'ERROR');
  assert.match(report.flmClaimsRender_({}), /role="alert".*Fixture outage.*id="flmTeamRetry"/);
  assert.deepEqual(dates(), []);
  await report.flmTeamLoad_(true);
  assert.equal(records().length, 4);
  assert.deepEqual(dates(), ['2026-10-16', '2026-11-01', '2026-11-14']);

  utc = '2026-12-01T18:00:00Z';
  latest = null;
  periodButtons[0].onclick();
  await settle();
  assert.deepEqual(requests.at(-2).bounds, ['lte.2026-12-01']);
  assert.deepEqual(records().at(-1).bounds, ['gte.2026-12-01', 'lte.2026-12-01']);
  assert.equal(report.flmBuildSupabaseLostSource_().status, 'OK');
  assert.match(report.flmClaimsRender_({}), /Không có đơn Lost trong kỳ này/);
  assert.deepEqual(dates(), []);
  const afterEmpty = requests.length;
  report.flmClaimsBind_();
  await settle();
  assert.equal(requests.length, afterEmpty, 'An empty range is cached');

  report.state.page = 'dashboard';
  selector = '[data-sop-open]';
  report.snapshotOpsBind_();
  selector = '[data-cl-period]';
  drillButton.onclick();
  await settle();
  assert.equal(report.FLMClaims.period, 'l30d');
  assert.equal(requests.length, afterEmpty + 1, 'The drill supplies the closing date and skips availability checks');
  assert.deepEqual(records().at(-1).bounds, ['gte.2026-09-12', 'lte.2026-10-11']);
  assert.equal(riskLoads, 0);
  report.FLMClaims.tab = 'risk';
  report.flmClaimsBind_();
  assert.equal(riskLoads, 1);
  console.log('PASS: Lost initial load uses one date check and one bounded MTD request; rolling, empty, refresh, rollover and Dashboard requests are range-specific.');
}
verifyLostReportLoading().catch(error => { console.error(error); process.exitCode = 1; });
