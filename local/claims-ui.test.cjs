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
  flmGetScopeInfo_: () => ({findHub: () => null, hasScopeRestriction: false}),
  flmBuildHubToZoneMap_: () => Object.fromEntries(['A', 'B', 'C', 'D'].map(code => [code, zones[0]])),
  flmClassifyOrder_: row => ({ cogs: row.amount, isHV: row.amount >= 1000000, isFM: true, isLM: false, isRT: false, isEHA: false }),
  flmTeamFmt_: value => value==null?'—':Number(value).toLocaleString('en-US'),
  appExportIcon: () => '<svg aria-hidden="true"></svg>',
  e: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
};
vm.createContext(context);
loadActive(context,'flmRiskAddMetrics_','flmRiskTableBasis_');
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
context.flmClaimsMoney_=row=>String(row.knownCogs);
const riskZone=context.flmClaimsZoneTable_({riskPivot:true,rows:orders.map((row,i)=>({
  hubCode:row.hubCode,station:row.hub,n:4-i,knownCogs:row.amount,missingCogs:0,
  hvOrders:i===3?null:0,hvCogs:i===3?null:0
}))});
assert.doesNotMatch(riskZone,/data-cl-drill-hub-code="D"/);
assert.doesNotMatch(riskZone,/td-fm|td-lm|td-rt|td-eha/);
assert.match(riskZone,/<tfoot>.*td-backlog">10<\/td><td class="td-money">1500900<\/td><td class="td-num td-hv-order">—<\/td>/,
  'Known sums and missing coverage both include HUBs outside the top three');
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

function verifyLossReasonsCard() {
  const reason='Hàng & "<thiếu>" ở trạm có tên dài';
  const trigger={dataset:{clReasonFocus:reason}};
  const view={tab:'lost',manualScopeView:'zone',reasonFilter:'',page:3};
  let canShowOrders=true,reduced=false,focused=false,scrolled='',renders=0;
  const chart=vm.createContext({
    e:context.e,FLMClaims:view,flmClaimsLabel_:value=>value,
    flmTeamFmt_:value=>Number(value).toLocaleString('en-US'),
    flmClaimsAllowedViews_:()=>canShowOrders?['zone','hub','orders']:['hub'],
    flmClaimsTrend_:()=>'<section id="untouched-trend"></section>',
    flmTeamLoad_(){},flmClaimsBindPeriod_(){},flmClaimsBindResults_(){},
    render(){renders++;},window:{matchMedia(query){assert.equal(query,'(prefers-reduced-motion: reduce)');return {matches:reduced};}},
    document:{querySelectorAll:selector=>selector==='[data-cl-reason-focus]'?[trigger]:[],
      getElementById:id=>id==='flmLostReasonFilter'?{focus:options=>{focused=options.preventScroll;}}:null,
      querySelector:selector=>selector==='.cl-table-panel'?{scrollIntoView:options=>{scrolled=options.behavior;}}:null}
  });
  vm.runInContext('var FLMLossReasonColors=new Map();',chart);
  loadActive(chart,'flmLostReasonKey_','flmClaimsBars_','flmClaimsInsights_','flmClaimsBind_');
  const reasons=[{reason:'Bỏ sót',n:200},{reason:'Không vào top',n:1},{reason:'  '+reason+' · Chi tiết',n:2000},
    {reason:'Điều phối',n:20},{reason:'Chưa bàn giao',n:1000},{reason:'Thiếu cập nhật',n:600}];
  const model={lost:true,rows:[],data:{reasons}};
  const html=chart.flmClaimsInsights_(model);
  assert.match(html,/<h2>Top lý do mất hàng<\/h2><span>Top 5 nhóm lý do · Bấm vào tên để lọc<\/span>/);
  assert.match(html,/id="untouched-trend"/);
  assert.doesNotMatch(html,/Không vào top/);
  assert.match(html,/data-cl-reason-focus="Hàng &amp; &quot;&lt;thiếu&gt;&quot; ở trạm có tên dài"[^>]*>Hàng &amp; &quot;&lt;thiếu&gt;&quot; ở trạm có tên dài<\/button><b>2\.000<\/b>/);
  assert.doesNotMatch(html,/<button[^>]+style=/);
  assert.equal((html.match(/cl-loss-reason-marker" aria-hidden="true"/g)||[]).length,5);
  assert.deepEqual(Array.from(html.matchAll(/width:([\d.]+)%/g),match=>Number(match[1])),[100,50,30,10,1]);
  const rowsByColor=markup=>Object.fromEntries(Array.from(markup.matchAll(/cl-loss-reason-color-(\d)"[^]*?data-cl-reason-focus="([^"]+)"/g),m=>[m[2],m[1]]));
  const colors=rowsByColor(html);
  assert.equal(new Set(Object.values(colors)).size,5);
  const swapped=reasons.map(row=>({...row,n:row.n===2000?1000:row.n===1000?2000:row.n}));
  assert.deepEqual(rowsByColor(chart.flmClaimsInsights_({...model,data:{reasons:swapped}})),colors);
  // This replacement collides with a retained reason's preferred color.
  const replacement=reasons.filter(row=>row.reason!=='Điều phối');
  const changedColors=rowsByColor(chart.flmClaimsInsights_({...model,data:{reasons:replacement}}));
  assert.equal(changedColors['Điều phối'],undefined);
  assert.ok(Object.hasOwn(changedColors,'Không vào top'));
  assert.equal(new Set(Object.values(changedColors)).size,5);
  for(const key of Object.keys(changedColors).filter(key=>key!=='Không vào top'))assert.equal(changedColors[key],colors[key]);
  assert.equal(chart.FLMLossReasonColors.size,5);

  chart.flmClaimsBind_();
  canShowOrders=false;
  const readOnly=chart.flmClaimsInsights_(model);
  assert.match(readOnly,/cl-loss-reasons[\s\S]*cl-loss-reason-label/);
  assert.doesNotMatch(readOnly,/<button|Bấm vào tên để lọc/);
  trigger.onclick();
  assert.equal(view.reasonFilter,'');
  assert.equal(renders,0);
  assert.match(chart.flmClaimsInsights_({...model,data:{reasons:[]}}),/Không có dữ liệu phân tích/);
  assert.doesNotMatch(chart.flmClaimsInsights_({lost:false,rows:[],data:{}}),/cl-loss-reasons/);
  canShowOrders=true;
  trigger.onclick();
  assert.equal(view.reasonFilter,reason);
  assert.equal(view.manualScopeView,'orders');
  assert.equal(view.page,1);
  assert.equal(focused,true);
  assert.equal(scrolled,'smooth');
  reduced=true;
  trigger.onclick();
  assert.equal(scrolled,'instant');
  console.log('PASS: Loss Reasons keeps the top five, proportional bars, stable colors, escaped localized labels, role checks and reduced-motion filtering.');
}
verifyLossReasonsCard();

function verifyLostSummaryPeriodDeltaAndMonthlyRateTrend() {
  const testCtx = vm.createContext({
    e: context.e,
    flmTeamFmt_: context.flmTeamFmt_,
    FLMClaims: { tab: 'lost', period: 'mtd', rangeFilter: null },
    FLM_MONTHLY_LOSS_RATES: {
      months: ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
      rates: { HUB_A: [0.02, 0.03, 0.04, null, 0.03008], HUB_B: [0.01, 0.02, 0.01, 0.02, 0.025] }
    },
    flmClaimsAllowedViews_: () => ['orders']
  });
  loadActive(testCtx, 'flmClaimsKnown_', 'flmClaimsMissing_', 'flmClaimsDelta_', 'flmGetMonthlyLossRates_',
    'flmClaimsMonthlyRateTrend_', 'flmClaimsSummary_', 'flmClaimsInsights_', 'flmTeamTable_');

  const model = {
    lost: true,
    total: { n: 10, amount: 430396148, knownAmount: 430396148, missingAmount: 0 },
    rows: [
      { station: 'Synthetic HUB A', hubCode: 'HUB_A', lossRateNum: 0.0003008 }
    ],
    data: {
      to: '2026-11-19',
      series: [
        { date: '2026-11-01', amount: 1000000, n: 6 },
        { date: '2026-11-10', amount: 1054000, n: 4 }
      ]
    },
    hubCounts: { 'Synthetic HUB A': 10 },
    reasonCounts: { 'Mất hàng': 10 }
  };

  const summaryHtml = testCtx.flmClaimsSummary_(model);
  assert.match(summaryHtml, /TỔNG TIỀN MẤT \(LOST\)/);
  assert.match(summaryHtml, /TỶ LỆ LOSS RATE TB/);
  assert.match(summaryHtml, /430,396,148 <small class="cl-card-unit">VND<\/small>/);
  assert.match(summaryHtml, /class="cl-delta is-bad">↑ \+5,4% · Tăng<\/span><small>Nửa sau so với nửa đầu chuỗi ngày trong kỳ/);
  assert.match(summaryHtml, /class="cl-delta is-good">↓ −24,8% · Giảm<\/span><small>Tháng 11\/2026 so với tháng 09\/2026/);
  assert.equal((summaryHtml.match(/class="cl-delta/g) || []).length, 2, 'Only comparable metrics have a delta');

  const chartHtml = testCtx.flmClaimsMonthlyRateTrend_(model);
  assert.match(chartHtml, /Biểu đồ % Loss Rate TB theo tháng/);
  assert.match(chartHtml, /kpi-target-benchmark-line/);
  assert.match(chartHtml, /Chuẩn: 0\.03%/);
  assert.match(chartHtml, /class="cl-monthly-bar is-good"[^>]+><title>2026-07: 0\.020% \(Đạt chuẩn/);
  assert.match(chartHtml, /class="cl-monthly-bar is-good"[^>]+><title>2026-08: 0\.030% \(Đạt chuẩn/);
  assert.match(chartHtml, /class="cl-monthly-bar is-bad"[^>]+><title>2026-09: 0\.040% \(Vượt chuẩn/);
  assert.match(chartHtml, /<summary>Xem số liệu từng tháng<\/summary>/);
  assert.match(chartHtml, /Mục tiêu chuẩn/);
  assert.match(chartHtml, /<td>2026-08<\/td><td><b>0\.030%<\/b><\/td><td>0\.03%<\/td><td><span class="cl-delta is-good">✓ Đạt chuẩn/);
  assert.doesNotMatch(chartHtml, /&lt;(?:b|span)/);
  testCtx.FLM_MONTHLY_LOSS_RATES.rates.OUTLIER = [4, 0.03];
  const outlier = testCtx.flmClaimsMonthlyRateTrend_({ ...model, activeHub: 'OUTLIER' });
  assert.match(outlier, /class="kpi-chart-axis"[^>]+>2\.50%/, 'Axis ticks remain spaced when a HUB has a high loss rate');

  testCtx.FLMClaims.period = 'month';
  testCtx.FLMClaims.rangeFilter = { month: '2026-08' };
  const atTarget = testCtx.flmClaimsSummary_(model);
  assert.match(atTarget, /is-bad">↑ \+50,0% · Tăng<\/span><small>Tháng 08\/2026 so với tháng 07\/2026/,
    'A rate increase can be red even though the selected month meets the benchmark');
  testCtx.FLMClaims.rangeFilter.month = '2026-05';
  assert.match(testCtx.flmClaimsSummary_(model), /TỶ LỆ LOSS RATE TB.*is-neutral">Chưa đủ dữ liệu so sánh/);
  testCtx.FLMClaims.period = 'mtd';

  const hub = testCtx.flmClaimsSummary_({ ...model, activeHub: 'HUB_B', rows: [...model.rows, { hubCode: 'HUB_B', lossRateNum: 0.00025 }], filteredOrders: [
    { date: '2026-11-10', amount: 0 }, { date: '2026-11-01', amount: 1000 }
  ], total: { n: 2, amount: 1000 } });
  assert.match(hub, /is-good">↓ −100,0% · Giảm/, 'The money comparison uses the selected HUB rows and includes a valid zero');
  assert.match(hub, /<strong>0\.025%<\/strong>.*is-bad">↑ \+25,0% · Tăng<\/span><small>Tháng 11\/2026 so với tháng 10\/2026/);

  const delta = (current, baseline) => testCtx.flmClaimsDelta_(current, baseline, 'Kỳ mẫu');
  assert.match(delta(100, 100), /is-neutral">0,0% · Không đổi<\/span>/);
  for (const current of [9999, 10001]) {
    assert.match(delta(current, 10000), /is-neutral">0,0% · Không đổi ở độ chính xác hiển thị/);
    assert.doesNotMatch(delta(current, 10000), /[↑↓+−]/);
  }
  for (const [current, baseline] of [[0, 0], [null, 10], [10, null], [Infinity, 2], [10, NaN]]) {
    assert.match(delta(current, baseline), /is-neutral">Chưa đủ dữ liệu so sánh/);
    assert.doesNotMatch(delta(current, baseline), /[↑↓%]|Infinity|NaN/);
  }
  const incomplete = { ...model, data: { ...model.data, series: [model.data.series[0], { amount: 10, n: 2, missingAmount: 1 }] } };
  assert.match(testCtx.flmClaimsSummary_(incomplete), /TỔNG TIỀN MẤT.*is-neutral">Chưa đủ dữ liệu so sánh.*TỶ LỆ LOSS RATE TB/);
  const zeroTotal = { ...model, total: { n: 1, amount: 0 }, data: { series: [{ n: 1, amount: 0 }] } };
  assert.match(testCtx.flmClaimsSummary_(zeroTotal), /<strong>0 <small class="cl-card-unit">VND.*is-neutral">Chưa đủ dữ liệu so sánh/);
  const oddSeries = Array.from({ length: 5 }, () => ({ n: 2, amount: 50 }));
  const odd = testCtx.flmClaimsSummary_({ ...model, data: { ...model.data, series: oddSeries } });
  assert.match(odd, /TỔNG TIỀN MẤT.*is-neutral">Chưa đủ dữ liệu so sánh.*TỶ LỆ LOSS RATE TB/);
  assert.doesNotMatch(odd, /\+50,0%/, 'Unequal halves would manufacture an increase from identical days');

  const aggregate = { ...model, hubCounts: {}, reasonCounts: {}, data: { ...model.data,
    hubStats: [{ totalOrders: 4 }, { totalOrders: 6 }, { totalOrders: 0 }],
    reasons: [{ n: 5 }, { n: 3 }, { n: 2 }]
  } };
  const aggregateHtml = testCtx.flmClaimsSummary_(aggregate);
  assert.match(aggregateHtml, /TRẠM CÓ ĐƠN LOST<\/span><strong>2<\/strong>/);
  assert.match(aggregateHtml, /PHÂN LOẠI LÝ DO<\/span><strong>3 nhóm<\/strong>/);
  assert.doesNotMatch(aggregateHtml, /Bấm vào biểu đồ để lọc/);
  aggregate.data.hubStats = [];
  aggregate.data.reasons = [{ n: 5 }];
  assert.match(testCtx.flmClaimsSummary_(aggregate), /TRẠM CÓ ĐƠN LOST<\/span><strong>—<\/strong>.*PHÂN LOẠI LÝ DO<\/span><strong>—<\/strong>/);
  assert.match(read('Styles.html'), /@media\(max-width:1200px\)\{\.cl-page \.cl-lost-overview\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
    'Lost retains a two-column overview at 1100px');
  const emptySummary = testCtx.flmClaimsSummary_({ ...model, total: { n: 0 } });
  assert.equal((emptySummary.match(/is-neutral">Chưa đủ dữ liệu so sánh/g) || []).length, 2);

  // Loading hides both the previous comparisons and monthly values.
  const loadingModel = {
    ...model, source: { status: 'LOADING' }
  };
  const loadingSummary = testCtx.flmClaimsSummary_(loadingModel);
  assert.match(loadingSummary, /is-loading/);
  assert.match(loadingSummary, /cl-skeleton-pulse/);
  assert.match(loadingSummary, /Đang tải dữ liệu…/);
  assert.doesNotMatch(loadingSummary, /cl-delta|430,396,148|0\.030%/);
  const loadingCharts = testCtx.flmClaimsInsights_(loadingModel);
  assert.match(loadingCharts, /Đang tải dữ liệu tháng…/);
  assert.doesNotMatch(loadingCharts, /cl-monthly-bar/);

  loadActive(testCtx, 'flmClaimsSkeletonTable_');
  const skeletonTable = testCtx.flmClaimsSkeletonTable_('orders');
  assert.match(skeletonTable, /cl-table-skeleton/);
  assert.match(skeletonTable, /Mã vận đơn/);

  console.log('PASS: Lost summary directions, rounding, comparison periods, selected HUB, missing and zero amounts, monthly benchmarks, and stale-free loading.');
}
verifyLostSummaryPeriodDeltaAndMonthlyRateTrend();

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
  drill: () => ({root:{hubs:allowedNodes}}),
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
  'flmClaimsOrdersTable_', 'flmRiskOrderSummary_', 'flmClaimsTable_', 'flmClaimsResults_', 'flmClaimsUpdate_',
  'flmClaimsBindResults_', 'flmClaimsBind_', 'flmClaimsBindPeriod_', 'flmClaimsExport_', 'flmClaimsModalHub_', 'flmRiskSummaryModel_', 'flmRiskRawHubModel_',
  'flmOpenHubOrdersModal_', 'flmRenderHubOrdersModal_', 'flmCloseHubOrdersModal_',
  'flmExportHubOrdersCsv_', 'flmClaimsModel_', 'flmClaimsText_', 'flmMatchHub_',
  'flmBuildSupabaseLostSource_', 'flmLostReasonKey_', 'flmLostHubRate_', 'flmBuildSupabaseRiskSource_', 'flmRiskStationHub_', 'flmHubOrdersData_',
  'flmRiskForToday_', 'flmRiskAlertDetailDay_', 'flmRiskDateInRange_', 'flmValidDate_');
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

function verifyHubResolution() {
  const east = {value:'E',label:'Depot East'};
  const depot = {value:'D',label:'Depot'};
  const collision = {value:'X',label:'Depot Hub'};
  let rootHubs = [east, depot];
  const hubContext = vm.createContext({
    ...context,
    state: {drillPath:{}, selectedHubCodes:[]},
    currentOrgHubNodes: () => [east, depot],
    effectiveSelectedHubCodes: () => hubContext.state.selectedHubCodes.length ? hubContext.state.selectedHubCodes : ['E','D'],
    drill: () => ({
      root:{hubs:rootHubs},
      aoms:[{email:zones[0].aomEmail,hubs:[east]},{email:zones[1].aomEmail,hubs:[depot]}]
    })
  });
  loadActive(hubContext, 'normalizeClientRoleList_', 'hubMapName', 'flmClaimsAllowedViews_',
    'flmGetScopeInfo_', 'flmBuildHubToZoneMap_', 'flmClaimsZoneTable_');
  const rows = [
    {hub:'Depot Hub',amount:100},
    {hub:'Depot Eastern Annex',amount:200},
    {hub:'Unmapped',hubCode:'MISSING',amount:400}
  ];
  const html = hubContext.flmClaimsZoneTable_({lost:true,rawOrders:rows});
  const groups = html.split('<tbody class="cl-zone-body">');
  assert.equal(groups.length,4);
  assert.match(groups[1], /Zone &lt;One&gt;/);
  assert.doesNotMatch(groups[1], /data-cl-drill-hub=/);
  assert.match(groups[2], /Zone Two.*data-cl-drill-hub="Depot" data-cl-drill-hub-code="D"/s);
  assert.match(groups[3], /Chưa phân Zone.*Unmapped.*Depot Eastern Annex/s);
  assert.doesNotMatch(groups[3], /data-cl-drill-zone=/);
  assert.match(groups[3], /tr-network-total.*<td class="td-money">700<\/td>/s);

  rootHubs = [east,depot,collision];
  hubContext.state.selectedHubCodes = ['D'];
  hubContext.state.drillPath = {aomEmail:zones[1].aomEmail};
  hubContext.currentOrgHubNodes = () => [depot];
  const scope = hubContext.flmGetScopeInfo_();
  assert.equal(scope.isRecordInScope({hub:'Depot'}), false);
  assert.equal(scope.isRecordInScope({hub:'Depot Hub'}), false);
  assert.equal(scope.isRecordInScope({hub:'Depot East'}), false);
  assert.equal(scope.isRecordInScope({hub:'Depot',hubCode:'D'}), true);
  assert.equal(scope.isRecordInScope({hub:'Depot',hubCode:'X'}), false);
  const selected = hubContext.flmClaimsZoneTable_({lost:true,rawOrders:rows.concat({hub:'Depot',hubCode:'D',amount:800})});
  assert.doesNotMatch(selected, /Chưa phân Zone|Unmapped|Depot Eastern Annex/);
  assert.match(selected, /tr-network-total.*<td class="td-money">800<\/td>/s);
  hubContext.state.drillPath = {};
  hubContext.state.selectedHubCodes = [];
  const ambiguous = hubContext.flmClaimsZoneTable_({lost:true,rawOrders:[rows[0]]}).split('<tbody class="cl-zone-body">');
  assert.doesNotMatch(ambiguous[2],/data-cl-drill-hub=/);
  assert.match(ambiguous[3],/Chưa phân Zone.*Depot Hub/s);
  console.log('PASS: code-free aliases fail closed across the full directory, and Zone uses canonical HUBs or exact mappings.');
}
verifyHubResolution();

// Supabase publishable keys belong in apikey, not in a Bearer JWT header.
const headersHelper = source.match(/function flmSupabaseHeaders_\(key\)\{[\s\S]*?\n\}/);
assert.ok(headersHelper, 'Supabase headers helper must exist');
const headers = vm.runInNewContext(headersHelper[0] + '\nflmSupabaseHeaders_');
const publishable = headers('sb_publishable_example');
assert.equal(publishable.apikey, 'sb_publishable_example');
assert.equal(publishable.Authorization, undefined);
assert.equal(headers('legacy.example.key').Authorization, 'Bearer legacy.example.key');
console.log('PASS: Supabase publishable and legacy key headers.');

const lostDefault = source.match(/^var FLM_LOST_DEFAULT_URL=.*;$/m)[0];
const lostDatePattern = source.match(/^var FLM_LOST_ISO_DATE=.*;$/m)[0];
const sourceDateFormat = source.match(/^var FLMSourceDateFormat=.*;$/m)[0];

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
  const url = 'https://example.test/rest/v1/lost_orders?ngay_chot=gte.2026-11-01&ngay_chot=lte.2026-11-17';
  const rows = await loadRows(url, {}, { table: 'lost_orders', date: 'ngay_chot', key: 'spx_tracking' });
  assert.equal(rows.length, 1001);
  assert.equal(rows.at(-1), 1000);
  assert.deepEqual(requests.map(params => params.get('offset')), ['0', '1000']);
  assert.ok(requests.every(params => params.getAll('ngay_chot').join(',') === 'gte.2026-11-01,lte.2026-11-17' && params.get('order') === 'ngay_chot.desc,spx_tracking.asc'));

  console.log('PASS: Lost pagination keeps the date filter and reads beyond 1,000 rows.');
}
verifyLostPagination().catch(error => { console.error(error); process.exitCode = 1; });

async function verifySupabaseSourceCheck() {
  const checker = source.match(/async function flmCheckSupabaseSources_\([^)]*\)\{[\s\S]*?\n\}/);
  assert.ok(checker, 'Claims source checker must exist');
  const requested = [];
  const context = {
    URL,
    AbortController, setTimeout, clearTimeout,
    window: {__LOCAL_DATA__:{}},
    FLMSupabaseBench: { apiKey: 'sb_publishable_fixture' },
    FLMSupabaseRisk: {
      prelostUrl: 'https://db.example.test/rest/v1/urgent_orders?deadline=eq.2026-11-08',
      alertUrl: 'https://db.example.test/rest/v1/alert_orders',
      apiKey: 'example'
    },
    flmSourceToday_: () => '2026-11-18',
    flmSupabaseHeaders_: key => ({ apikey: key }),
    async fetch(url, options) {
      requested.push(url.pathname.split('/').at(-1));
      const lost = url.pathname.endsWith('/lost_orders');
      if (!lost) assert.equal(url.hostname, 'db.example.test');
      const urgent=url.pathname.endsWith('/urgent_orders');
      const column=urgent?'deadline':'date';
      assert.equal(url.searchParams.get('select'),lost?'ngay_chot':'id,'+column);
      if (lost) assert.match(url.searchParams.get('ngay_chot'), /^match\./);
      assert.equal(url.searchParams.get('limit'),lost?'1':'1000');
      assert.equal(options.headers.apikey, lost ? 'sb_publishable_fixture' : 'example');
      if (!lost) assert.deepEqual(url.searchParams.getAll(column), ['gte.2026-11-17']);
      if (urgent) {
        return { ok: true, json: async () => [] };
      }
      if (!lost) return { ok: false, status: 403 };
      return { ok: true, json: async () => [{ ngay_chot: '2026-11-17' }] };
    }
  };
  vm.createContext(context);
  vm.runInContext(lostDefault + '\n' + lostDatePattern, context);
  loadActive(context, 'flmValidDate_', 'flmLostSchema_', 'flmLostIsLocal_', 'flmLostPreviewKey_',
    'volumeShift_', 'flmRiskUrl_', 'flmRiskDay_', 'flmRiskDateInRange_', 'flmRiskReadPages_', 'flmRiskLatestDay_', 'flmCheckSupabaseSources_');
  const result = await context.flmCheckSupabaseSources_();
  assert.deepEqual(requested, ['lost_orders', 'urgent_orders', 'alert_orders']);
  assert.equal(result.ok, false);
  assert.equal(result.sources.map(item => item.status).join(','), 'AVAILABLE,EMPTY,ERROR');
  assert.equal(result.sources[0].dates[0], '2026-11-17');
  console.log('PASS: Claims source checks distinguish Supabase data, empty results and denied reads.');
}
verifySupabaseSourceCheck().catch(error => { console.error(error); process.exitCode = 1; });

async function verifyDashboardSourceCheck() {
  const requests = [];
  let rpcFailure = false;
  let lostFailure = false;
  let lostTimeout = false;
  let runDeadline;
  let allowLost = true;
  let allowBacklog = true;
  let paints = 0;
  const volume = {id:'volume',status:'AVAILABLE',dates:['2026-11-15'],latestDate:'2026-11-15'};
  const backlog = {id:'backlog',status:'OLDER',dates:['2026-11-14'],latestDate:'2026-11-14'};
  const backend = {ok:false,checkedAt:'2026-11-18T00:00:00Z',dateWindow:{from:'2026-01-01'},sources:[
    volume,backlog,{id:'lost',status:'ERROR',dates:['2026-11-12'],latestDate:'2026-11-12'}
  ]};
  const dashboard = vm.createContext({
    URL,
    window: {__LOCAL_DATA__:{}},
    setTimeout(callback) { runDeadline=callback; },
    clearTimeout() {},
    state:{page:'dashboard'}, SnapshotOps:{}, FLMSourceUI:{slots:{},choices:{}},
    FLMSupabaseBench:{apiKey:'sb_publishable_fixture'}, FLMSupabaseRisk:{},
    user:() => ({email:'dashboard@example.test'}),
    accessInfo:() => ({rank:'ADMIN'}),
    currentOrgHubCodes:() => ['A'],
    snapshotOpsRequest_:() => ({selectedHubCodes:['A']}),
    snapshotOpsAllowed_:kind => kind === 'lost' ? allowLost : allowBacklog,
    flmSourceToday_:() => '2026-11-18',
    flmSourcePaint_() { paints++; },
    google:{script:{run:{
      withSuccessHandler(success) {
        return {withFailureHandler(fail) {
          return {flmTeamGetLostSourceStatus(request) {
            assert.equal(request.module,'snapshot');
            assert.deepEqual(Array.from(request.selectedHubCodes),['A']);
            requests.push('lost-metadata-rpc');
            success({latestDate:'2026-11-17'});
          },flmTeamGetSourceStatus(request) {
            assert.equal(request.module,'snapshot');
            assert.equal(request.anchorDate,'2026-11-18');
            assert.equal(request.selectedHubCodes[0],'A');
            requests.push('rpc');
            if (rpcFailure) fail(Error('Fixture volume outage')); else success(backend);
          }};
        }};
      }
    }}},
    async fetch(url,options) {
      requests.push(url);
      assert.equal(options.headers.apikey,'sb_publishable_fixture');
      if (lostTimeout) return new Promise(() => {});
      if (lostFailure) return {ok:false,status:403};
      const date = url.pathname.endsWith('/lost_orders') ? 'ngay_chot' : 'claim_date';
      assert.equal(url.searchParams.get('select'),date);
      assert.equal(url.searchParams.getAll(date)[0],'lte.2026-11-17');
      assert.equal(url.searchParams.get('limit'),'1');
      assert.equal(url.searchParams.has('offset'),false);
      return {ok:true,json:async()=>[{[date]:'2026-11-17'}]};
    }
  });
  vm.runInContext(lostDefault + '\n' + lostDatePattern, dashboard);
  loadActive(dashboard,'flmLostSchema_','flmValidDate_','flmLostConfig_','flmSupabaseHeaders_',
    'flmLostIsLocal_','flmLostPreviewKey_','flmLostRpc_',
    'volumeShift_','flmCheckSupabaseSources_','flmSourceStatusRpc_','flmSourceEnsure_',
    'flmSourceRequest_','flmSourceKey_','flmSourceEntry_','flmSourceRelevant_','flmSourceDates_',
    'flmSourceView_','flmSourceClosing_','flmSourceChoice_','flmSourceApply_');
  const check = () => dashboard.flmSourceEnsure_('snapshot',true);
  let result = (await check()).data;
  assert.equal(result.ok,true,'Ignore legacy Lost RPC error and retain the volume sources');
  assert.equal(result.sources[0],volume);
  assert.equal(result.sources[1],backlog);
  assert.equal(result.sources[2].latestDate,'2026-11-17');
  assert.equal(result.sources[2].kind,'records');
  assert.equal(result.sources[2].latestOnly,true);
  assert.equal(result.dateWindow,backend.dateWindow);
  assert.equal(requests[1].pathname,'/rest/v1/lost_orders');
  assert.equal(dashboard.flmSourceApply_('snapshot'),'2026-11-17');
  assert.equal(dashboard.SnapshotOps.anchor,'2026-11-18');
  lostFailure = true;
  result = (await check()).data;
  assert.equal(result.ok,false);
  assert.equal(result.sources[0],volume,'Lost denial preserves available volume');
  assert.equal(result.sources[2].status,'ERROR');
  assert.match(result.sources[2].message,/lost_orders.*403/);
  assert.equal(dashboard.flmSourceApply_('snapshot'),'2026-11-15');
  rpcFailure = true;
  lostFailure = false;
  dashboard.FLMSupabaseBench.url = 'https://legacy.example.test/rest/v1/lost_claims?offset=10';
  assert.equal(dashboard.flmSourceEntry_('snapshot').data,null,'Endpoint change invalidates Dashboard metadata');
  result = (await check()).data;
  assert.equal(result.sources.map(item=>item.status).join(','),'ERROR,ERROR,AVAILABLE');
  assert.equal(requests.at(-1).pathname,'/rest/v1/lost_claims');
  assert.equal(result.sources[2].latestDate,'2026-11-17');
  allowBacklog = false;
  const before = requests.length;
  result = (await check()).data;
  assert.equal(result.sources.map(item=>item.id).join(','),'lost');
  assert.equal(requests.length,before+1);
  allowBacklog = true;
  allowLost = false;
  rpcFailure = false;
  result = (await check()).data;
  assert.equal(result.sources.map(item=>item.id).join(','),'volume,backlog');
  assert.equal(requests.at(-1),'rpc');
  allowLost = true;
  lostTimeout = true;
  const pending = check();
  await Promise.resolve();
  runDeadline();
  result = (await pending).data;
  assert.equal(result.sources.map(item=>item.status).join(','),'AVAILABLE,OLDER,ERROR');
  const beforeProduction = requests.length;
  dashboard.window = {};
  result = (await check()).data;
  assert.deepEqual(requests.slice(beforeProduction),['rpc','lost-metadata-rpc']);
  assert.equal(result.sources[2].latestDate,'2026-11-17');
  assert.ok(paints > 0);
  console.log('PASS: Dashboard uses the configured Lost date and keeps volume and Lost source failures independent.');
}
verifyDashboardSourceCheck().catch(error => { console.error(error); process.exitCode = 1; });

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
  flmSourceToday_: () => '2026-11-18',
  flmLostRange_: () => ({ from: '2026-11-01', to: '2026-11-18' }),
  flmLostSlot_: () => context.lostFixture,
  flmTeamLoad_() {},
  flmRiskScheduleMidnight_() {},
  flmRiskSyncDetails_() {},
  flmRiskOpenDetails_() {},
  flmFetchSupabaseLiveRisk_(){},
  flmRiskModalHub_:()=>null,
  flmRiskModalFeedState_:(_,feed)=>({status:'OK',rows:feed==='urgent'?context.FLMSupabaseRisk.prelostData:context.FLMSupabaseRisk.alertData}),
  flmRiskMainDetailsOpen_:()=>context.flmClaimsAllowedViews_().includes('orders'),
  flmRiskPageActive_:()=>context.FLMClaims.tab==='risk',
  flmRiskDetailKey_:()=> 'fixture',
  flmRiskFresh_:value=>Boolean(value),
  flmRiskSummaryRequest_:()=>({anchorDate:'2026-11-18',selectedHubCodes:context.effectiveSelectedHubCodes()}),
  flmRiskSummaryEntry_:()=>({data:{sources:[{id:'alert',status:'OK',dates:['2026-11-16'],hubRows:[{hubCode:'A',station:'Synthetic A',n:2,knownCogs:200,missingCogs:0,aging:{},stages:{},feedback:{}}]}]}}),
  FLMSupabaseRisk: { today: '2026-11-18', mainScopeKey: 'fixture', mainAlertDay: '2026-11-16', prelostData: [], alertData: [] },
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
vm.runInContext(lostDatePattern,context);
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

  const known={value:'A',label:'Depot A'},ambiguous={value:'B',label:'Shared Depot',hubName:'Depot B'};
  allowedNodes=[known,ambiguous];
  const directory={root:{hubs:[...allowedNodes,{value:'C',label:'Shared Depot'}]}};
  context.drill=()=>directory;
  Object.assign(context.state,{drillPath:{},selectedHubCodes:[]});
  Object.assign(context.FLMClaims,{tab:'risk',riskFilter:'alert',hubFilter:'all',query:'',manualScopeView:'orders'});
  context.FLMSupabaseRisk.prelostData=[];
  context.FLMSupabaseRisk.alertData=[
    {orderId:'SYNCED-KNOWN',hub:'Depot A',reason:'Kiểm tra bàn giao',cogsKnown:true},
    {orderId:'SYNCED-AMBIGUOUS',hub:'Shared Depot'},
    {orderId:'SYNCED-UNKNOWN',hub:'Unknown Depot'},
    {orderId:'DIFFERENT-DAY',hub:'Depot A',date:'2026-11-18',cogs:5000,cogsKnown:true}
  ].map(row=>({date:'2026-11-16',cogs:100,...row}));
  rank='SUP';
  allData=false;
  assert.equal(context.flmHubOrdersData_(known).alert[0].stage,'Kiểm tra bàn giao');
  context.flmClaimsExport_();
  const scopedCsv=await downloads.at(-1).text();
  assert.match(scopedCsv,/"SYNCED-KNOWN","2026-11-16","Depot A","A",[^\r\n]*"Kiểm tra bàn giao"/);
  assert.doesNotMatch(scopedCsv,/SYNCED-AMBIGUOUS|SYNCED-UNKNOWN|DIFFERENT-DAY/);
  context.FLMSupabaseRisk.liveFetchedAt='fixture';
  context.flmRiskMainDetailsOpen_=()=>false;
  context.flmClaimsExport_();
  assert.match(await downloads.at(-1).text(),/"A","1","100"/,'Raw-HUB CSV overrides count only the selected Alert day');
  context.flmRiskMainDetailsOpen_=()=>true;
  rank='ADMIN';
  allData=true;
  context.flmClaimsExport_();
  const unrestrictedCsv=await downloads.at(-1).text();
  assert.doesNotMatch(unrestrictedCsv,/SYNCED-AMBIGUOUS|SYNCED-UNKNOWN|DIFFERENT-DAY/);
  const scopedSummary=context.flmRiskSummaryEntry_,savedNodes=allowedNodes;
  const h01={value:'H01',hubName:'Depot A/B',label:'Depot A/B',station:'Collision'};
  allowedNodes=[h01];
  context.flmRiskSummaryEntry_=()=>({data:{basis:'supabase',stationAliases:{H01:'H01','DEPOT A/B':'H01'},
    sources:[{id:'alert',status:'OK',dates:['2026-11-16'],hubRows:[]}]}});
  const previousPrelost=context.FLMSupabaseRisk.prelostData;
  context.FLMSupabaseRisk.prelostData=['H01',' Depot A / B Hub ','Collision','Depot A/B Annex','H02'].map((hub,i)=>({
    orderId:'CANONICAL-'+i,hub,date:'2026-11-18',cogs:100,feedback:'Chưa phản hồi'
  }));
  context.FLMClaims.riskFilter='urgent';
  const canonical=context.flmClaimsModel_();
  assert.deepEqual(Array.from(canonical.filteredOrders,r=>[r.orderId,r.hubCode,r.feedback]),[
    ['CANONICAL-0','H01','Chưa xác định'],['CANONICAL-1','H01','Chưa xác định']
  ]);
  assert.equal(canonical.pendingCount,null);
  assert.deepEqual(Array.from(context.flmHubOrdersData_(h01).urgent,r=>[r.shipmentId,r.feedback]),[
    ['CANONICAL-0','Chưa xác định'],['CANONICAL-1','Chưa xác định']
  ]);
  context.flmClaimsExport_();
  const canonicalCsv=await downloads.at(-1).text();
  assert.match(canonicalCsv,/"CANONICAL-0","2026-11-18","H01","H01".*"Chưa xác định"/);
  assert.match(canonicalCsv,/"CANONICAL-1","2026-11-18"," Depot A \/ B Hub ","H01".*"Chưa xác định"/);
  assert.doesNotMatch(canonicalCsv,/CANONICAL-[234]|Chưa phản hồi/);
  allowedNodes=savedNodes;
  context.flmRiskSummaryEntry_=scopedSummary;
  context.FLMSupabaseRisk.prelostData=previousPrelost;
  context.FLMClaims.riskFilter='alert';
  const alertRows=context.FLMSupabaseRisk.alertData;
  context.FLMSupabaseRisk.alertData=alertRows.concat(
    {orderId:'EXACT-A-ALIAS',hub:'  dEpoT   a HUB  ',date:'2026-11-16',cogs:101},
    {orderId:'EXACT-B-ALIAS',hub:'Depot B Hub',date:'2026-11-16',cogs:102},
    {orderId:'A-PREFIX-ONLY',hub:'Depot A Extension',date:'2026-11-16',cogs:103}
  );
  headerHub='A';
  assert.equal(context.FLMClaims.hubFilter,'all');
  const toolbarHtml=context.flmClaimsOrdersTable_(context.flmClaimsModel_());
  assert.match(toolbarHtml,/SYNCED-KNOWN/);
  assert.match(toolbarHtml,/EXACT-A-ALIAS/);
  assert.doesNotMatch(toolbarHtml,/EXACT-B-ALIAS|A-PREFIX-ONLY|SYNCED-AMBIGUOUS|SYNCED-UNKNOWN/);
  context.flmClaimsExport_();
  const toolbarCsv=await downloads.at(-1).text();
  assert.match(toolbarCsv,/"SYNCED-KNOWN","2026-11-16","Depot A","A",/);
  assert.match(toolbarCsv,/"EXACT-A-ALIAS","2026-11-16",[^\r\n]*,"A",/);
  assert.doesNotMatch(toolbarCsv,/EXACT-B-ALIAS|A-PREFIX-ONLY|SYNCED-AMBIGUOUS|SYNCED-UNKNOWN/);
  headerHub='';
  assert.ok(context.flmClaimsModel_().filteredOrders.some(row=>row.orderId==='EXACT-B-ALIAS'),'Clearing the toolbar restores authorized HUB B');
  context.FLMSupabaseRisk.alertData=alertRows;
  const summaryEntry=context.flmRiskSummaryEntry_;
  context.flmRiskSummaryEntry_=()=>({data:{sources:[{id:'alert',status:'EMPTY',dates:[],hubRows:[]}]}});
  context.FLMSupabaseRisk.mainAlertDay=null;
  context.FLMSupabaseRisk.alertData=context.FLMSupabaseRisk.alertData.slice();
  context.flmClaimsExport_();
  assert.match(await downloads.at(-1).text(),/"DIFFERENT-DAY","2026-11-18"/,'Explicit detail keeps the independent Alert window');
  context.FLMSupabaseRisk.prelostData=[{hub:'Depot A',date:'2026-11-18',cogs:250,cogsKnown:true}];
  context.flmRiskMainDetailsOpen_=()=>false;
  context.flmClaimsExport_();
  assert.match(await downloads.at(-1).text(),/"A","1","250"/,'Independent Alert rows never enter the aggregate CSV override');
  context.flmRiskMainDetailsOpen_=()=>true;
  context.flmRiskSummaryEntry_=summaryEntry;
  context.FLMSupabaseRisk.mainAlertDay='2026-11-16';
  console.log('PASS: synced Alert reasons reach the modal and CSV, and export uses only canonical HUB codes within scope.');

  loadActive(context,'flmRiskReport_');
  const pivotRow=(hubCode,n,knownCogs,metrics)=>({hubCode,station:'Depot '+hubCode,n,knownCogs,missingCogs:0,aging:{},stages:{},feedback:{},...metrics});
  const pivotData={sources:[
    {id:'alert',status:'OK',dates:['2026-11-16'],hubRows:[pivotRow('A',1,1200000,{hvOrders:1,hvCogs:1200000})]},
    {id:'urgent',status:'OK',dates:['2026-11-18'],hubRows:[pivotRow('A',1,0,{hvOrders:0,hvCogs:0})]}
  ]};
  context.flmRiskSummaryEntry_=()=>({data:pivotData});
  context.flmClaimsSummary_=()=>'';
  context.flmClaimsInsights_=()=>'';
  context.flmRiskMainDetailsOpen_=()=>false;
  context.FLMSupabaseRisk.alertData=[{hub:'Depot A',date:'2026-11-16',cogs:900000,cogsKnown:true,status:'LM'}];
  context.FLMSupabaseRisk.prelostData=[{hub:'Depot A',date:'2026-11-18',cogs:0,cogsKnown:true,status:'RT'}];
  for(const liveFetchedAt of [null,'fixture']){
    context.FLMSupabaseRisk.liveFetchedAt=liveFetchedAt;
    context.FLMClaims.manualScopeView='hub';
    const hubHtml=context.flmRiskReport_();
    assert.match(hubHtml,/Đơn HV \(≥1M\)<\/th><th scope="col">COGS đơn HV<\/th>/);
    assert.doesNotMatch(hubHtml,/>FM<\/th>.*>EHA<\/th>/);
    assert.match(hubHtml,/<td><span class="cl-hv-count">1<\/span><\/td><td>1,200,000<\/td>/);
    assert.match(hubHtml,/Tổng hợp từ bảng pivot/);
    context.FLMClaims.manualScopeView='zone';
    const zoneHtml=context.flmRiskReport_();
    assert.doesNotMatch(zoneHtml,/scope="colgroup" class="th-group-urgent">Phân loại vận hành/);
    assert.doesNotMatch(zoneHtml,/<td class="td-num td-fm">/);
    context.flmClaimsExport_();
    const csv=await downloads.at(-1).text();
    assert.match(csv,/"Mã HUB","Tổng đơn nguy cơ"/);
    assert.match(csv,/"A","2","1200000","1","1200000"/);
    assert.doesNotMatch(csv,/"FM","LM","RT","EHA"/);
  }
  const [urgentPivot]=pivotData.sources[1].hubRows;
  pivotData.sources[1].hubRows[0]=pivotRow('A',1,0,{hvOrders:null,hvCogs:null});
  const enriched=context.flmRiskReport_();
  assert.match(enriched,/Tổng hợp từ bảng pivot và chỉ số từ chi tiết \(Supabase\)/);
  assert.match(enriched,/<td class="td-num td-hv-order"><span class="cl-hv-count">1<\/span><\/td><td class="td-money td-hv-cogs">1,200,000<\/td>/);
  context.flmClaimsExport_();
  assert.match(await downloads.at(-1).text(),/"A","2","1200000","1","1200000"/,
    'Matching Prelost supplies HV metrics');
  context.FLMSupabaseRisk.prelostData.push({hub:'Depot A',date:'2026-11-18',cogs:2000000,cogsKnown:true});
  assert.doesNotMatch(context.flmRiskReport_(),/chỉ số từ chi tiết/,'Different counts preserve the pivot population');
  context.FLMSupabaseRisk.prelostData=[{hub:'Depot A',date:'2026-11-19',cogs:0,cogsKnown:true,status:'RT'}];
  assert.doesNotMatch(context.flmRiskReport_(),/chỉ số từ chi tiết/,'Equal counts on different days do not join the sources');
  const bPivot=pivotRow('B',1,0,{missingCogs:1,hvOrders:1,hvCogs:null});
  // The pivot has A on Nov 18 and B on Nov 19. The same day and HUB marginals also allow the reverse.
  pivotData.sources[1].dates.push('2026-11-19');
  pivotData.sources[1].hubRows.push(bPivot);
  context.FLMSupabaseRisk.prelostData.push({hub:'Depot B',date:'2026-11-18',cogs:0,cogsKnown:true,status:'EHA'});
  context.flmClaimsExport_();
  assert.match(await downloads.at(-1).text(),/"A","2","1200000","",""/,
    'Multi-date HUB/day swaps leave unknown pivot metrics blank');
  context.FLMSupabaseRisk.liveFetchedAt=null;
  pivotData.sources[1].hubRows[0]=urgentPivot;
  const zoneHtml=context.flmRiskReport_();
  assert.match(zoneHtml,/<tfoot>.*td-hv-order">2<\/td><td class="td-money td-hv-cogs">—<\/td>/);
  assert.doesNotMatch(zoneHtml,/td-eha/);
  context.flmClaimsExport_();
  assert.match(await downloads.at(-1).text(),/"B","1","","1",""/);
  pivotData.sources[1].status='UNAVAILABLE';
  context.FLMSupabaseRisk.liveFetchedAt='fixture';
  context.flmClaimsExport_();
  assert.match(await downloads.at(-1).text(),/"A","1","1200000","",""/,'Unavailable feed leaves combined optional metrics blank');
  context.flmRiskSummaryEntry_=summaryEntry;
  context.FLMSupabaseRisk.liveFetchedAt='fixture';
  context.FLMSupabaseRisk.alertData=alertRows;
  context.flmRiskMainDetailsOpen_=()=>true;
  console.log('PASS: At-Risk Zone, HUB and aggregate CSV preserve exact optional metrics across matched detail, incomplete coverage and scope/date mismatches.');

  loadActive(context,'flmTeamTable_');
  rank='SUP';
  allData=false;
  context.FLMSupabaseRisk.prelostData=[{orderId:'SYNCED-PRELOST',date:'2026-11-18',hub:'Depot A',aging:8,cogs:250,reason:'Đối soát',feedback:'Chưa phản hồi'}];
  Object.assign(context.FLMClaims,{riskFilter:'all',riskSort:'cogs-desc',page:1,pageSize:1});
  const riskHtml=context.flmClaimsOrdersTable_(context.flmClaimsModel_());
  assert.match(riskHtml,/id="flmRiskOrderTitle" tabindex="-1">Đơn nguy cơ<\/h2><p id="flmRiskOrderCount" role="status"><b>2 đơn<\/b><span>Tổng COGS <b>350 VND/);
  assert.match(riskHtml,/data-cl-risk-pill="all"[^>]*aria-pressed="true">Tất cả <span>2<\/span>/);
  assert.match(riskHtml,/data-cl-risk-pill="alert"[^>]*aria-pressed="false">Alert <span>1<\/span>/);
  assert.match(riskHtml,/data-cl-risk-pill="urgent"[^>]*aria-pressed="false">Prelost <span>1<\/span>/);
  for(const id of ['flmClaimSearch','flmLostHubFilter','flmRiskOrderSort']){
    assert.match(riskHtml,new RegExp('<label[^>]* for="'+id+'">[^<]+</label><(?:input|select) id="'+id+'"'));
  }
  assert.match(riskHtml,/class="flm-team-scroll cl-table-risk-orders-wrap" tabindex="0" aria-label="Bảng đơn nguy cơ"/);
  assert.match(riskHtml,/<th scope="col">Mã vận đơn<\/th><th scope="col">Phân loại<\/th>/);
  assert.match(riskHtml,/SYNCED-PRELOST<\/b><\/td><td><span class="cl-badge-prelost">Prelost<\/span>/);
  assert.match(riskHtml,/<td>Đối soát<\/td><td>8<\/td><td>Chưa phản hồi<\/td><td><b class="cl-money">250<\/b>/);
  assert.doesNotMatch(riskHtml,/SYNCED-KNOWN|🚨|⏳|🔘|style=/);

  const nextPage=control({clPage:'2',viewFocus:'risk-page-next'});
  buttons.set('[data-cl-page]',[nextPage]);
  let focusRestored=false;
  context.document.querySelector=selector=>selector==='#flmClaimResults .cl-pagination'?{
    scrollIntoView(){},querySelectorAll:()=>[{dataset:{viewFocus:'risk-page-prev'},focus(){focusRestored=true;}}]
  }:null;
  context.flmClaimsBindResults_();
  nextPage.onclick();
  assert.equal(context.FLMClaims.page,2);
  assert.match(staleResults.innerHTML,/SYNCED-KNOWN/);
  assert.equal(focusRestored,true,'Pagination keeps keyboard focus on an available control');

  const counter={innerHTML:''},exportControl={disabled:false},search={value:'no results'};
  controls.set('flmRiskOrderCount',counter);
  controls.set('clExport',exportControl);
  controls.set('flmClaimSearch',search);
  context.clearTimeout=()=>{};
  context.setTimeout=run=>run();
  context.flmClaimsBind_();
  search.oninput();
  assert.match(staleResults.innerHTML,/Không tìm thấy đơn nguy cơ phù hợp/);
  assert.match(counter.innerHTML,/<b>0 đơn<\/b><span>Tổng COGS <b>0 VND/);
  assert.equal(exportControl.disabled,true);
  search.value='SYNCED-KNOWN';
  search.oninput();
  assert.match(staleResults.innerHTML,/SYNCED-KNOWN/);
  assert.match(staleResults.innerHTML,/<span class="cl-badge-alert">Alert<\/span>/);
  assert.match(counter.innerHTML,/<b>1 đơn<\/b><span>Tổng COGS <b>100 VND/);
  assert.equal(exportControl.disabled,false);
  console.log('PASS: At-Risk detail layout keeps labeled controls and fields, updates search count and CSV availability, and restores pagination focus.');

  const grouped='Đối soát';
  context.lostFixture={rows:[
    {orderId:'GROUP-ONE',reason:'  '+grouped.normalize('NFD')+' · Chi tiết'},
    {orderId:'GROUP-TWO',reason:grouped},
    {orderId:'OVERLAPPING',reason:'Đối soát lại'},
    {orderId:'SUFFIX-ONLY',reason:'Giao chậm · Nhờ đối soát'},
    {orderId:'NO-REASON',reason:' · Chi tiết'},
    {orderId:'ALL-LITERAL',reason:'all'}
  ].map(row=>({date:'2026-11-18',hub:'Depot A',amount:100,...row}))};
  Object.assign(context.FLMClaims,{tab:'lost',reasonFilter:grouped,query:'',page:1,pageSize:10});
  const exact=context.flmClaimsModel_();
  assert.deepEqual(Object.fromEntries(exact.source.reasons.map(row=>[row.reason,row.n])),{...exact.reasonCounts});
  assert.equal(exact.reasonCounts[grouped],2);
  assert.equal(exact.reasonCounts['Chưa ghi lý do'],1);
  assert.deepEqual(Array.from(exact.filteredOrders,row=>row.orderId),['GROUP-ONE','GROUP-TWO']);
  const lostHtml=context.flmClaimsOrdersTable_(exact);
  assert.match(lostHtml,/<label class="cl-tool-label" for="flmLostReasonFilter">Lý do mất hàng<\/label><select id="flmLostReasonFilter"><option value="">/);
  assert.match(lostHtml,/<option value="Đối soát" selected>Đối soát \(2\)<\/option>/);
  context.FLMClaims.reasonFilter='all';
  assert.deepEqual(Array.from(context.flmClaimsModel_().filteredOrders,row=>row.orderId),['ALL-LITERAL']);
  Object.assign(context.FLMClaims,{reasonFilter:'',query:'doi soat'});
  assert.deepEqual(Array.from(context.flmClaimsModel_().filteredOrders,row=>row.orderId),['GROUP-ONE','GROUP-TWO','OVERLAPPING','SUFFIX-ONLY']);
  console.log('PASS: Lost reason counts and the labeled filter share exact normalized keys while free-text search still matches full reasons.');
}
verifyRoleViews().catch(error => { console.error(error); process.exitCode = 1; });

// Exercise the actual bind → date availability → ranged request path using
// synthetic PostgREST responses, including an out-of-order completion.
async function verifyLostReportLoading() {
  const legacyEndpoint = 'https://db.example.test/rest/v1/lost_claims';
  const requests = [];
  const allRows = [
    ['2026-10-18', 'OUT-OF-RANGE-001'],
    ['2026-10-19', 'PREVIOUS-MONTH-1'],
    ['2026-11-01', 'CURRENT-MONTH-01'],
    ['2026-11-17', 'SHORT-ID'],
    ['2026-11-18', 'AFTER-CLOSING-01'],
    ['2026-11-170', 'INVALID-ISO-SHAPE'],
    ['2026-10-99', 'INVALID-CALENDAR-DAY'],
    ['17/11/2026', 'LEGACY-TEXT-DATE']
  ].map(([ngay_chot, spx_tracking]) => ({ ngay_chot, spx_tracking, hub: 'Hub A' }));
  allRows[1].log_loi_cuoi = '404';
  Object.assign(allRows[2], {
    loai_yeu_cau: 'Đền bù D0', trang_thai_he_thong: 'FMHub_Pickup', co_log_loi: 'Không',
    log_loi_cuoi: '{"reason":"Log reason","amount":2400,"error":"Details"}',
    cod_cogs: 9000, so_tien_den_bu: '0'
  });
  Object.assign(allRows[3], {
    co_log_loi: ' Có ', log_loi_cuoi: '{Parcel lost log', last_user: 'last-user',
    rider: '[555] Demo', last_status_spx: 'LMHub_Delivered', trang_thai_he_thong: 'Lost',
    thoi_gian_trang_thai_cuoi: '2026-11-17T19:23:00+07:00',
    thoi_gian_log_loi: '2026-11-17T20:00:00+07:00', khu_vuc: 'HCM',
    cod_cogs: '1200000', so_tien_den_bu: '500000', ly_do: 'Chốt mất', ket_qua: 'EHA'
  });
  allRows.push({ ngay_chot: '2026-11-17', spx_tracking: 'UNAUTHORIZED', hub: 'Hub A Extension' });
  let utc = '2026-11-17T18:00:00Z';
  let latest = '2026-11-17';
  let holdRolling = true;
  let failNext = false;
  let completeRolling;
  let completeMonth;
  let paints = 0;
  let riskLoads = 0, riskSummaryLoads = 0;
  let selector = '';
  let csv;
  const month = { value: '' };
  const rolling = {};
  function chooseMonth(value) {
    month.value = value;
    month.onchange();
  }
  const drillButton = { dataset: { sopOpen: 'compensated' } };
  const report = vm.createContext({
    window: {__LOCAL_DATA__:{}},
    URL: class extends URL {
      static createObjectURL(blob) { csv = blob; return 'blob:fixture'; }
      static revokeObjectURL() {}
    },
    Blob, performance, setTimeout, clearTimeout,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [utc])); }
      static now() { return Date.parse(utc); }
    },
    state: { page: 'compensated' },
    FLMClaims: { tab: 'lost', period: 'mtd', page: 1, pageSize: 20 },
    clientPageAllowed_: () => true,
    SnapshotOps: {},
    FLMTeam: { claims: {} },
    FLMHubOrders: { active: false },
    FLMSupabaseBench: {
      apiKey: 'sb_publishable_fixture',
      liveData: [{ id: 'legacy-unbounded' }]
    },
    FLMSupabaseRisk: {},
    flmBuildSupabaseRiskSource_: () => ({items:[]}),
    FLMSourceUI: { slots: {} },
    flmTeamIsPage_: () => report.state.page === 'compensated',
    fmPendingIsView_: () => false,
    flmTeamClientSlot_: () => report.FLMTeam.claims,
    flmTeamClientRequest_: () => ({}),
    flmTeamClientKey_: request => JSON.stringify([report.accessInfo().rank,request]),
    effectiveSelectedHubCodes: () => ['A'],
    currentOrgHubNodes: () => [{value:'A', label:'Hub A'}],
    drill: () => ({root:{hubs:report.currentOrgHubNodes()}}),
    user: () => ({ email: 'staff@example.test' }),
    accessInfo: () => ({ rank: 'SUP', allData: false }),
    currentOrgHubCodes: () => [],
    flmFetchSupabaseLiveRisk_: () => { riskLoads++; },
    flmLoadRiskSummary_: () => { riskSummaryLoads++; },
    flmRiskMainDetailsOpen_: () => false,
    flmRiskSyncDetails_(){},
    flmRiskModalFeedState_:()=>({status:'LOADING'}),
    flmSourcePaint_: () => report.render(),
    e: value => String(value || ''),
    uiDateLabel: value => value,
    designNavIcon: () => '<svg aria-hidden="true"></svg>',
    flmClaimsTabIsLoaded_: () => true,
    flmClaimsSummary_: () => '<summary>Totals</summary>',
    flmClaimsInsights_: () => '',
    flmClaimsTable_: () => '',
    flmClaimsTime_: () => '',
    flmClaimsLabel_: value => value,
    snapshotOpsDate_: () => '2026-10-12',
    renderForPageNavigation_(page) { report.state.page = page; report.render(); },
    render() { paints++; report.flmClaimsBind_(); },
    document: {
      getElementById: id => id === 'flmLostMonth' ? month : null,
      createElement: () => ({ click() {} }),
      querySelector: value => value === '[data-cl-period="l30d"]' ? rolling : null,
      querySelectorAll: value => value === '[data-sop-open]' && value === selector ? [drillButton] : []
    },
    fetch(value, options) {
      const url = new URL(value);
      const legacy = url.origin + url.pathname === legacyEndpoint;
      const dateColumn = legacy ? 'claim_date' : 'ngay_chot';
      if (legacy) {
        assert.equal(url.searchParams.get('area'), 'eq.HCM');
      } else {
        assert.equal(url.origin + url.pathname, new URL(report.FLM_LOST_DEFAULT_URL).origin + '/rest/v1/lost_orders');
        assert.equal(url.searchParams.has('claim_date'), false);
        const match = url.searchParams.getAll(dateColumn).find(filter => filter.startsWith('match.'));
        assert.ok(match, 'Exclude non-ISO values at the source');
        const iso = new RegExp(match.slice(6));
        assert.ok(iso.test('2026-11-17'));
        assert.ok(!iso.test('2026-11-170') && !iso.test('17/11/2026'));
      }
      assert.equal(options.headers.apikey, 'sb_publishable_fixture');
      assert.equal(options.headers.Authorization, undefined);
      const bounds = url.searchParams.getAll(dateColumn).filter(filter => !filter.startsWith('match.'));
      const metadata = url.searchParams.get('select') === dateColumn;
      const offset = url.searchParams.get('offset');
      requests.push({ metadata, bounds, offset, cache: options.cache });
      const ok = rows => ({ ok: true, json: async () => rows });
      if (metadata) {
        assert.equal(url.searchParams.get('limit'), '1');
        assert.equal(url.searchParams.has('offset'), false);
        assert.equal(url.searchParams.get('order'), dateColumn + '.desc.nullslast');
        return Promise.resolve(ok(latest ? [{ [dateColumn]: latest }] : []));
      }
      assert.equal(url.searchParams.get('order'), legacy ? 'claim_date.desc,id.asc' : 'ngay_chot.desc,spx_tracking.asc');
      assert.equal(url.searchParams.get('limit'), '1000');
      if (!legacy && bounds.join('|') === 'gte.2026-10-01|lte.2026-10-31') {
        if (offset === '1000') return Promise.resolve(ok([allRows[1]]));
        assert.equal(offset, '0');
        return new Promise(resolve => { completeMonth = () => resolve(ok(Array(1000).fill(allRows[2]))); });
      }
      assert.equal(offset, '0');
      if (legacy) {
        assert.equal(url.searchParams.get('select'), 'id,claim_date,order_id,hub_code,hub,error_log');
        return Promise.resolve(ok([{ id: 42, claim_date: '2026-11-17', order_id: 'LEGACY-ORDER-042', hub_code: 'A', hub: 'Hub A', error_log:'{"amount":700}' }]));
      }
      const fields = url.searchParams.get('select').split(',');
      for (const field of ['spx_tracking', 'ngay_chot', 'cod_cogs', 'so_tien_den_bu', 'log_loi_cuoi']) assert.ok(fields.includes(field));
      assert.ok(!fields.includes('hub_code') && !fields.includes('rider_id'));
      if (failNext) {
        failNext = false;
        return Promise.resolve({ ok: false, status: 403, statusText: 'Fixture denied' });
      }
      if (holdRolling && bounds[0] === 'gte.2026-10-19') {
        return new Promise(resolve => { completeRolling = () => resolve(ok(allRows)); });
      }
      return Promise.resolve(ok(bounds[1] === 'lte.2026-11-17' ? allRows : []));
    }
  });
  vm.runInContext(lostDefault + '\n' + lostDatePattern + '\n' + sourceDateFormat, report);
  loadActive(report, 'flmValidDate_', 'flmLostSchema_', 'flmNormalizeLostRow_', 'flmResolveLostReason_', 'flmResolveLostAmount_',
    'flmGetScopeInfo_', 'flmClaimsAllowedViews_', 'hubMapName', 'normalizeClientRoleList_', 'flmClassifyOrder_', 'flmClaimsHubRows_', 'flmHubOrdersData_',
    'flmClaimsBind_', 'flmClaimsBindResults_', 'flmClaimsBindPeriod_', 'flmClaimsSetPeriod_', 'flmTeamLoad_', 'flmLostRange_', 'flmBindHubOrdersModal_',
    'flmLostClosingDate_', 'flmClaimsPeriodControls_',
    'flmLostSlot_', 'flmLostSlotKey_', 'flmLostConfig_', 'flmLostIsActive_', 'flmLoadLostReport_', 'flmFetchSupabaseLiveLost_',
    'flmLostIsLocal_', 'flmLostPreviewKey_', 'flmLostHubRate_', 'flmLostRpc_', 'flmLostLocalRows_', 'flmLostAccessRequest_',
    'flmFetchSupabaseLostRows_', 'flmBuildSupabaseLostSource_', 'flmLostReasonKey_', 'flmSupabaseHeaders_', 'volumeShift_',
    'flmSourceToday_', 'flmSourceRequest_', 'flmSourceKey_', 'flmSourceEntry_', 'flmSourceRelevant_',
    'flmCheckSupabaseSources_', 'flmSourceEnsure_', 'flmSourceView_', 'snapshotOpsBind_',
    'flmClaimsRender_', 'flmClaimsLoading_', 'flmClaimsModel_', 'flmClaimsText_', 'flmGetActiveScopeView_', 'flmClaimsExport_');
  const start = source.indexOf('var flmSourceOriginalLoad_=flmTeamLoad_;');
  const end = source.indexOf('var flmSourceOriginalSnapshotLoad_', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(source.slice(start, end), report);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const records = () => requests.filter(request => !request.metadata);
  const dates = () => Array.from(report.flmBuildSupabaseLostSource_().items || [], row => row.date);

  assert.equal(report.flmBuildSupabaseLostSource_().status, 'LOADING');
  assert.match(report.flmClaimsRender_({}), /<select id="flmLostMonth"[^>]* disabled>/);
  report.flmClaimsBind_();
  report.flmClaimsBind_();
  await settle();
  assert.deepEqual(requests.map(r => r.bounds), [
    ['lte.2026-11-17'], ['gte.2026-11-01', 'lte.2026-11-17']
  ]);
  assert.deepEqual(dates(), ['2026-11-01', '2026-11-17']);
  const initial = report.flmBuildSupabaseLostSource_();
  const [zero, latestOrder] = initial.items;
  assert.equal(initial.total.amount, 500000);
  assert.equal(zero.hasError, false);
  assert.equal(zero.status, 'FMHub_Pickup');
  assert.equal(zero.amount, 0);
  assert.equal(zero.errorLog.error, 'Details');
  const normalized = JSON.parse(JSON.stringify(latestOrder));
  assert.deepEqual(normalized, {
    id:'SHORT-ID', orderId:'SHORT-ID', date:'2026-11-17', hub:'Hub A', hubCode:'', area:'HCM',
    status:'LMHub_Delivered', statusTime:'2026-11-17 19:23:00', rider:'[555] Demo', riderId:'',
    hasError:true, errorTime:'2026-11-17 20:00:00', errorLog:{error:'{Parcel lost log'},
    claimType:'Đền bù D0', lastUser:'last-user', amount:500000, reason:'Chốt mất', cogs:1200000, feedback:'EHA'
  });
  const hub = report.flmClaimsHubRows_(initial.items,true)[0];
  assert.equal(hub.totalCogs, 500000);
  assert.equal(hub.hvCogs, 1200000);
  assert.equal(hub.hubCode,'A');
  assert.equal(hub.fm, 1);
  assert.equal(hub.lm, 1);
  assert.equal(hub.eha, 1);
  const modal = report.flmHubOrdersData_({value:'A'}).lost;
  assert.equal(modal.length,2);
  assert.equal(modal[0].amount,0);
  assert.equal(modal[1].shipmentId,'SHORT-ID');
  assert.equal(riskLoads, 0);

  rolling.onclick();
  await settle();
  assert.equal(report.flmBuildSupabaseLostSource_().status, 'LOADING');
  assert.match(report.flmClaimsRender_({}), /data-cl-period="l30d"[^>]*aria-pressed="true".*role="status"/);
  assert.doesNotMatch(report.flmClaimsRender_({}), /Không có đơn Lost trong kỳ này/);
  assert.deepEqual(dates(), []);
  assert.deepEqual(records()[1].bounds, ['gte.2026-10-19', 'lte.2026-11-17']);
  chooseMonth('mtd');
  rolling.onclick();
  report.flmClaimsBind_();
  await settle();
  assert.equal(records().length, 2, 'Repeated activation shares the pending rolling request');
  chooseMonth('mtd');
  const beforeStalePaint = paints;
  completeRolling();
  await settle();
  assert.equal(paints, beforeStalePaint, 'A rolling response does not repaint the current MTD');
  assert.deepEqual(dates(), ['2026-11-01', '2026-11-17']);

  rolling.onclick();
  assert.deepEqual(dates(), ['2026-10-19', '2026-11-01', '2026-11-17']);
  assert.equal(records().length, 2, 'The completed range is reused');
  assert.deepEqual(Object.keys(report.flmBuildSupabaseLostSource_().periods), ['l30d']);
  assert.equal(report.flmBuildSupabaseLostSource_().items[0].errorLog.error,'404');
  assert.equal(report.flmBuildSupabaseLostSource_().items[0].reason,'404');
  for (const log of ['false','null','[]','{}','"quoted"']) {
    assert.equal(report.flmNormalizeLostRow_({log_loi_cuoi:log},false).errorLog.error,log);
  }
  assert.equal(report.flmValidDate_('2024-02-29'),true);
  assert.equal(report.flmValidDate_('2026-02-29'),false);
  assert.equal(report.flmValidDate_('2026-02-30'),false);
  failNext = true;
  holdRolling = false;
  await Promise.all([report.flmTeamLoad_(true), report.flmTeamLoad_(true)]);
  assert.equal(records().length, 3);
  assert.equal(records()[2].cache, 'no-store');
  assert.equal(report.flmBuildSupabaseLostSource_().status, 'ERROR');
  assert.match(report.flmClaimsRender_({}), /role="alert".*lost_orders \(HTTP 403 Fixture denied\).*id="flmTeamRetry"/);
  assert.deepEqual(dates(), []);
  await report.flmTeamLoad_(true);
  assert.equal(records().length, 4);
  assert.deepEqual(dates(), ['2026-10-19', '2026-11-01', '2026-11-17']);

  const previousCount = requests.length;
  const controls = report.flmClaimsRender_({});
  assert.match(controls, /<select id="flmLostMonth"[^>]*aria-label="Chọn tháng báo cáo Lost"/);
  assert.ok(controls.includes('<option value="" disabled selected>Chọn tháng</option>'));
  assert.ok(controls.includes('<option value="mtd">Tháng này (MTD)</option><option value="2026-10">Tháng 10/2026</option>'));
  assert.equal((controls.match(/<option value="[0-9]{4}-[0-9]{2}"/g) || []).length, 36);
  assert.doesNotMatch(controls, /Ngày chốt đền bù|flmLostRangeForm|<option value="2026-(11|12)"/);
  for (const invalid of ['2026-12', '2026-11', '2026-99', '']) chooseMonth(invalid);
  assert.equal(report.FLMClaims.period, 'l30d');
  assert.equal(month.value, '');
  assert.equal(requests.length, previousCount);

  chooseMonth('mtd');
  assert.equal(report.FLMClaims.period, 'mtd');
  assert.deepEqual(dates(), ['2026-11-01', '2026-11-17']);
  assert.equal(requests.length, previousCount, 'MTD reuses the current month bounds');
  assert.match(report.flmClaimsRender_({}), /<option value="mtd" selected>/);
  for (const [value, end] of [['2024-02', '29'], ['2025-02', '28'], ['2025-12', '31']]) {
    chooseMonth(value);
    await settle();
    assert.deepEqual(records().at(-1).bounds, ['gte.' + value + '-01', 'lte.' + value + '-' + end]);
  }

  const beforeMonth = requests.length;
  chooseMonth('2026-10');
  chooseMonth('2026-10');
  await settle();
  assert.equal(report.FLMClaims.period, 'month');
  assert.equal(report.flmBuildSupabaseLostSource_().status, 'LOADING');
  assert.equal(requests.length, beforeMonth + 1, 'Repeated month selection shares the pending range');
  assert.match(report.flmClaimsRender_({}), /<option value="2026-10" selected>/);
  rolling.onclick();
  const beforeMonthPaint = paints;
  completeMonth();
  await settle();
  assert.equal(paints, beforeMonthPaint, 'A month response does not repaint a newer preset');
  assert.deepEqual(records().slice(-2).map(r => [r.bounds, r.offset]), [
    [['gte.2026-10-01', 'lte.2026-10-31'], '0'],
    [['gte.2026-10-01', 'lte.2026-10-31'], '1000']
  ]);
  assert.deepEqual(dates(), ['2026-10-19', '2026-11-01', '2026-11-17']);
  chooseMonth('2026-10');
  assert.equal(requests.length, beforeMonth + 2, 'Completed month pages are reused');
  assert.deepEqual(dates(), ['2026-10-19']);
  const filteredModel = report.flmClaimsModel_();
  assert.equal(filteredModel.total.n, 1);
  assert.deepEqual(Array.from(filteredModel.orderShown, row => row.orderId), ['PREVIOUS-MONTH-1']);
  report.flmClaimsExport_();
  const exportText = await csv.text();
  assert.match(exportText, /"PREVIOUS-MONTH-1","2026-10-19"/);
  assert.doesNotMatch(exportText, /SHORT-ID|CURRENT-MONTH-01|UNAUTHORIZED/);
  assert.deepEqual(Array.from(report.flmHubOrdersData_({value:'A'}).lost, row => row.shipmentId), ['PREVIOUS-MONTH-1']);
  rolling.onclick();

  utc = '2026-12-01T18:00:00Z';
  latest = null;
  chooseMonth('mtd');
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
  drillButton.onclick();
  await settle();
  assert.equal(report.FLMClaims.period, 'l30d');
  assert.equal(requests.length, afterEmpty + 1, 'The drill supplies the closing date and skips availability checks');
  assert.deepEqual(records().at(-1).bounds, ['gte.2026-09-12', 'lte.2026-10-11']);
  assert.equal(riskLoads, 0);
  report.FLMSupabaseBench.url = legacyEndpoint + '?select=id,claim_date,order_id,hub_code,hub,error_log&area=eq.HCM&claim_date=gte.1999-01-01&offset=42';
  report.FLMClaims.closingDate = '2026-11-17';
  latest = '2026-11-17';
  const metadata = await report.flmCheckSupabaseSources_(['lost'], '2026-11-17');
  assert.equal(metadata.sources[0].status, 'AVAILABLE');
  assert.equal(metadata.sources[0].dates[0], latest);
  assert.deepEqual(requests.at(-1).bounds, ['lte.2026-11-17']);
  await report.flmTeamLoad_(false);
  assert.deepEqual(records().at(-1).bounds, ['gte.2026-10-19','lte.2026-11-17']);
  const legacyOrder = report.flmBuildSupabaseLostSource_().items[0];
  assert.equal(legacyOrder.orderId, 'LEGACY-ORDER-042');
  assert.equal(legacyOrder.id, 42);
  assert.equal(legacyOrder.hubCode, 'A');
  assert.equal(legacyOrder.amount, 700);
  chooseMonth('mtd');
  await settle();
  assert.deepEqual(records().at(-1).bounds, ['gte.2026-11-01','lte.2026-11-17']);
  assert.equal(report.flmBuildSupabaseLostSource_().items[0].orderId, 'LEGACY-ORDER-042');
  rolling.onclick();
  report.FLMSupabaseBench.url = '';
  report.FLMClaims.closingDate = '2026-10-99';
  latest = '2026-10-99';
  await report.flmTeamLoad_(true);
  assert.equal(report.flmSourceEntry_('compensated','lost').data.sources[0].status, 'ERROR');
  assert.deepEqual(requests.at(-1).bounds, ['gte.2026-11-02','lte.2026-12-01']);
  assert.equal(report.flmBuildSupabaseLostSource_().to,'2026-12-01');
  report.FLMClaims.tab = 'risk';
  report.flmClaimsBind_();
  assert.equal(riskLoads, 0);
  assert.equal(riskSummaryLoads, 1);
  console.log('PASS: Lost initial load uses one date check and one bounded MTD request; month dropdown, pagination, presets, refresh, rollover and Dashboard requests use the active range.');

  const browserRequests = requests.length;
  report.currentDrillView = () => ({type:'HUB',value:'A'});
  report.FLMClaims.tab = 'lost';
  report.FLMClaims.closingDate = '2026-11-17';
  report.FLMSupabaseBench.apiKey = '';
  await report.flmTeamLoad_(true);
  const synthetic = report.flmBuildSupabaseLostSource_();
  assert.equal(synthetic.status,'OK',synthetic.error||'Synthetic report should finish loading');
  assert.equal(synthetic.items[0].orderId, 'DEMO-LOST-1');
  assert.equal(requests.length, browserRequests, 'Local synthetic Lost should stay offline');

  const rpc = [];
  let failure = 'fixture raw error', metadataFailure = false;
  let summary = null;
  report.window = {};
  report.FLMClaims.closingDate = '';
  report.google = {script:{run:{withSuccessHandler(success){return {withFailureHandler(fail){return {
    flmTeamGetLostSourceStatus(request){
      rpc.push({kind:'metadata',...request});
      if(metadataFailure)fail(Error('Synthetic metadata error'));
      else success({latestDate:'2026-11-17'});
    },
    flmTeamGetLostReport(request){
      rpc.push({kind:'report',...request});
      if(failure)fail(Error(failure));
      else if(summary)success({summary});
      else success({rows:[{spx_tracking:'RPC-LOST',ngay_chot:request.to,hub:'Hub A',hubCode:'A',so_tien_den_bu:123}]});
    }
  }}}}}}};
  await report.flmTeamLoad_(true);
  assert.deepEqual(rpc.map(r=>r.kind), ['metadata','report']);
  assert.equal(rpc[0].module,'compensated');
  assert.deepEqual(Array.from(rpc[1].selectedHubCodes),['A']);
  assert.equal(rpc[1].to,'2026-11-17');
  assert.match(report.flmClaimsRender_({}),/role="alert".*Không thể đọc dữ liệu Lost.*id="flmTeamRetry"/);
  assert.doesNotMatch(report.flmClaimsRender_({}),/fixture raw error/);
  failure = '';
  await report.flmTeamLoad_(true);
  assert.equal(report.flmBuildSupabaseLostSource_().items[0].orderId,'RPC-LOST');
  assert.equal(report.flmBuildSupabaseLostSource_().items[0].hubCode,'A');
  report.accessInfo = () => ({rank:'AOM',allData:false});
  report.flmTeamVolumeHub_ = () => '';
  summary = {total:{n:1,amount:321,knownAmount:321,missingAmount:0},series:[],reasons:[],hubStats:[
    {station:'Hub A',hubCode:'A',totalOrders:1,totalCogs:321,hvOrders:0,hvCogs:0,fm:0,lm:1,rt:0,eha:0}
  ]};
  await report.flmTeamLoad_(true);
  const model = report.flmClaimsModel_();
  assert.equal(model.rawOrders.length,0,'Summary roles never receive the details cached for a different role');
  assert.equal(model.total.n,1);
  assert.equal(model.rows[0].knownAmount,321);
  report.flmClaimsExport_();
  assert.match(await csv.text(),/"Hub A","A","1","321"/);
  report.effectiveSelectedHubCodes = () => [];
  const beforeEmptyScope = rpc.length;
  await report.flmTeamLoad_(true);
  assert.equal(rpc.length,beforeEmptyScope,'An empty selection must never ask the server for the whole scope');
  assert.equal(report.flmBuildSupabaseLostSource_().items.length,0);
  assert.equal(requests.length,browserRequests,'Production Lost should use Apps Script only');
  console.log('PASS: production Lost uses scoped metadata and data RPCs, retries safely and keeps aggregate CSV separate from order detail; local synthetic Lost stays offline.');

  const lostTab={dataset:{clModalTab:'lost'}}, modalStates=[];
  report.FLMClaims.tab='risk';
  report.FLMClaims.closingDate='';
  report.FLMClaims.period='mtd';
  report.FLMHubOrders={active:true,tab:'urgent',hubCode:'A',query:''};
  report.effectiveSelectedHubCodes=()=>['A'];
  report.accessInfo=()=>({rank:'SUP',allData:false});
  report.FLMSourceUI.slots={};
  report.FLMSupabaseBench.ranges=Object.create(null);
  report.document.querySelectorAll=selector=>selector==='[data-cl-modal-tab]'?[lostTab]:[];
  report.flmRenderHubOrdersModal_=()=>modalStates.push(report.flmBuildSupabaseLostSource_().status);
  report.flmBindHubOrdersModal_();
  const beforeModal=rpc.length;
  summary=null;
  lostTab.onclick();
  await settle();
  assert.deepEqual(rpc.slice(beforeModal).map(call=>call.kind),['metadata','report']);
  assert.deepEqual(modalStates,['LOADING','OK']);
  assert.equal(report.flmHubOrdersData_({value:'A'}).lost[0].shipmentId,'RPC-LOST');
  assert.equal(riskLoads,0);
  report.FLMSourceUI.slots={};
  report.FLMSupabaseBench.ranges=Object.create(null);
  metadataFailure=true;
  const beforeFailure=rpc.length;
  lostTab.onclick();
  await settle();
  assert.deepEqual(rpc.slice(beforeFailure).map(call=>call.kind),['metadata']);
  assert.equal(modalStates.at(-1),'ERROR','Cold Lost modal surfaces a failed availability check');
  console.log('PASS: Cold Lost modal from At-Risk uses its own metadata and bounded report and paints metadata errors.');
}
verifyLostReportLoading().catch(error => { console.error(error); process.exitCode = 1; });

async function verifyRiskDateWindow() {
  let utc = '2026-11-18T16:59:59Z';
  const requests = [], signals = [], storage = new Map(), timers = new Map(), events = {}, hub = {value:'A',label:'Depot A'};
  const cacheKey = 'flm_supabase_risk_orders_cache_v4';
  const response = rows => ({ok:true,json:async()=>rows});
  let id=0;
  const row = (tracking,day,station='Depot A',fields={}) => ({id:++id,spx_tracking:tracking,date:day,deadline:day,fleet_final_station:station,cogs:100,...fields});
  const prelost = url => url.pathname.endsWith('/urgent_orders');
  const offset = url => url.searchParams.get('offset');
  const probe = url => /^id,(?:deadline|date)$/.test(url.searchParams.get('select'));
  const tableUrl = name => source.match(new RegExp("^  "+name+"Url: '([^']+)'",'m'))[1];
  let fetchRows, alertDay=null;
  let paints = 0, modalPaints = 0, timerId = 0, detailConsent = true, modalConsentRevoked = false;
  const risk = vm.createContext({
    URL, performance, AbortController,
    window:{addEventListener:(name,run)=>{events[name]=run;}},
    document:{hidden:false,addEventListener:(name,run)=>{events[name]=run;}},
    Date:class extends Date { constructor(...args){super(...(args.length?args:[utc]));} static now(){return Date.parse(utc);} },
    setTimeout(run,delay){timers.set(++timerId,{run,delay});return timerId;},
    clearTimeout:id=>timers.delete(id),
    state:{page:'compensated'}, FLMClaims:{tab:'risk',riskFilter:'all'}, FLMHubOrders:{active:false},
    clientPageAllowed_:()=>true,
    FLMRiskSummary:null, flmRiskPageActive_:()=>risk.FLMClaims.tab==='risk', flmLoadRiskSummary_(){},
    flmRiskAlertDetailDay_:()=>alertDay,
    flmRiskSummaryRequest_:()=>({}),flmRiskSummaryEntry_:()=>({}),
    flmRiskMainDetailsOpen_:()=>detailConsent,flmRiskDetailKey_:()=> 'fixture',
    flmRiskModalHub_:()=>risk.FLMHubOrders.active?hub:null,flmFetchSupabaseRiskModal_(){},
    flmRiskSyncDetails_(){if(risk.FLMHubOrders.active&&risk.FLMSupabaseRisk.today==='2026-11-20'&&!modalConsentRevoked){detailConsent=false;modalConsentRevoked=true;}},
    FLM_LOST_DEFAULT_URL:'https://db.example.test/lost_orders', FLMSupabaseBench:{}, flmLostPreviewKey_:()=>'',
    FLMSupabaseRisk:{
      prelostUrl:tableUrl('prelost'),alertUrl:tableUrl('alert')
    },
    flmGetScopeInfo_:()=>({scopeKey:'A',directory:hub,allowedNodes:[hub],hasScopeRestriction:true,
      findHub:r=>r.hubCode==='A'||r.hub==='Depot A'?hub:null}),
    sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    render(){paints++;},
    flmRenderHubOrdersModal_(){modalPaints++;},
    async fetch(url,options){
      requests.push(url);
      signals.push(options.signal);
      assert.ok(prelost(url)||url.pathname.endsWith('/alert_orders'));
      const column=prelost(url)?'deadline':'date';
      const exactDay=!prelost(url)&&!probe(url)&&alertDay;
      assert.deepEqual(url.searchParams.getAll(column),exactDay?
        ['gte.'+risk.volumeShift_(exactDay,-1),'lt.'+risk.volumeShift_(exactDay,2)]:
        ['gte.'+risk.volumeShift_(risk.flmSourceToday_(),-1)]);
      assert.equal(url.searchParams.has('claim_date'),false);
      const order=probe(url)?column+'.desc.nullslast,id.asc':'id.asc';
      assert.equal(url.searchParams.get('order'),order);
      if(!probe(url)){
        const common=['id',column,'spx_tracking','fleet_final_station','region','aging','cogs','yeu_cau_claim'];
        assert.deepEqual(url.searchParams.get('select').split(','),common.concat(prelost(url)?
          ['fleet_final_status','hub_cover','cot']:['timing_date']));
      }
      return fetchRows(url);
    }
  });
  vm.runInContext(lostDatePattern+'\n'+sourceDateFormat+'\nvar FLMRiskMidnightTimer=null; var FLM_RISK_ORDERS_CACHE_KEY='+JSON.stringify(cacheKey)+';',risk);
  loadActive(risk,'flmSourceToday_','flmValidDate_','flmSupabaseHeaders_','flmRiskUrl_','flmRiskDay_','flmRiskDateInRange_',
    'flmRiskReadPages_','flmReadRiskFeed_','flmNormalizeRiskOrder_','flmRiskLatestDay_','flmRiskFresh_',
    'flmRiskForToday_','flmRiskIsActive_','flmRiskScheduleMidnight_','flmRiskRecheck_','flmRiskPaint_','volumeShift_',
    'flmFetchSupabaseLiveRisk_','flmBuildSupabaseRiskSource_','flmRiskStationHub_','flmCheckSupabaseSources_');
  const listenerStart = source.indexOf("document.addEventListener('visibilitychange',flmRiskRecheck_);");
  assert.ok(listenerStart>=0);
  vm.runInContext(source.slice(listenerStart,source.indexOf('function flmFetchSupabaseLiveRisk_',listenerStart)),risk);
  const build = () => risk.flmBuildSupabaseRiskSource_();
  const ids = data => Array.from(data.items,r=>r.orderId);
  const load = force => risk.flmFetchSupabaseLiveRisk_(force);
  const currentTimer = () => timers.get(risk.FLMRiskMidnightTimer);

  assert.equal(risk.flmSourceToday_(),'2026-11-18');
  for(const [date,expected] of [
    ['2026-11-18','2026-11-18'],['2026-11-18 10:20:30.123456','2026-11-18'],['2026-11-18T09:00','2026-11-18'],
    ['2026-11-17T17:00:00Z','2026-11-18'],['2026-11-18 02:00:00+14','2026-11-17'],
    ['2026-11-17T18:00:00+0000','2026-11-18'],['2026-11-31 18:00:00',null],['2026-11-18T24:00:00',null],
    ['2026-11-18 10:60:00',null],['2026-11-18T10:00:00+14:01',null],['18/11/2026',null],['2026-11-18FOO',null]
  ])assert.equal(risk.flmRiskDay_(date),expected,date);
  const obsoleteCache=JSON.stringify({today:'2026-11-18',fetchedAt:utc,prelost:[
    {orderId:'OBSOLETE-TABLE',date:'2026-11-18',hubCode:'A'}
  ],alert:[]});
  storage.set('flm_supabase_risk_cache_v5',obsoleteCache);
  storage.set('flm_supabase_risk_orders_cache_v1',obsoleteCache);
  storage.set('flm_supabase_risk_orders_cache_v2',obsoleteCache);
  storage.set('flm_supabase_risk_orders_cache_v3',obsoleteCache);
  fetchRows = () => response([]);
  await load(false);
  assert.equal(requests.length,2,'Cache entries from old tables or projections are ignored');
  assert.deepEqual(ids(build()),[]);
  risk.FLMSupabaseRisk.today='';
  requests.length=0;
  storage.set(cacheKey,JSON.stringify({today:'2026-11-18',alertDay:null,prelost:[
    {orderId:'CACHED-YESTERDAY',date:'2026-11-17',hubCode:'A'},
    {orderId:'CACHED-FUTURE',date:'2026-11-20',hubCode:'A'},
    {orderId:'CACHED-INVALID',date:'2026-11-31',hubCode:'A'}
  ],alert:[],fetchedAt:utc}));
  await load(false);
  assert.equal(requests.length,0);
  assert.deepEqual(ids(build()),['CACHED-FUTURE']);

  const makeRows = urgent => {
    const prefix = urgent?'P':'A';
    const common = {region:'Fixture region',aging:'8',cogs:'250'};
    const sourceFields=urgent?{date:'1900-01-01',yeu_cau_claim:'Cần kiểm tra',fleet_final_status:'Depot stage',hub_cover:'Zone A',cot:'COT A'}:
      {deadline:'1900-01-01',timing_date:'4',yeu_cau_claim:'Kiểm tra bàn giao'};
    const mixed = [row(prefix+'-OLD','2026-11-17'),row(prefix+'-TODAY','2026-11-18 10:20:30','Depot A',{...common,...sourceFields}),
      row(prefix+'-TIMEZONE','2026-11-17T17:00:00Z'),row(prefix+'-FUTURE','2026-11-20'),row(prefix+'-FUTURE','2026-11-20'),
      row(prefix+'-BAD-DAY','2026-11-31'),row(prefix+'-BAD-FORMAT','2026-11-19-nope'),row(prefix+'-OTHER-HUB','2026-11-29','Depot B')];
    return urgent?mixed.concat(Array.from({length:992},(_,i)=>row('OLD-'+i,'2026-11-17')),row('P-LATER','2026-11-22')):mixed;
  };
  const urgentRows = makeRows(true), alertRows = makeRows(false);
  fetchRows = url => {
    if(probe(url))return response(prelost(url)?[row('INVALID-PROBE','N/A'),row('VALID-PROBE','2026-11-20T23:15:00Z')]:
      offset(url)==='0'?[row('PREVIOUS','2026-11-17T00:00:00+07:00')]:[]);
    const rows = prelost(url)?urgentRows:alertRows;
    return response(rows.slice(Number(offset(url)),Number(offset(url))+500));
  };
  const probes = await risk.flmCheckSupabaseSources_(['urgent','alert']);
  assert.deepEqual(Array.from(probes.sources,s=>[s.id,s.status]),[['urgent','AVAILABLE'],['alert','EMPTY']]);
  assert.equal(probes.sources[0].dates[0],'2026-11-21');
  await load(true);
  const mixed = build();
  assert.deepEqual(ids(mixed),['P-TODAY','P-TIMEZONE','P-FUTURE','P-FUTURE','P-LATER','A-TODAY','A-TIMEZONE','A-FUTURE','A-FUTURE']);
  assert.equal(mixed.latestPrelostDate,'2026-11-22');
  assert.equal(mixed.latestAlertDate,'2026-11-20');
  assert.equal(mixed.total.n,9);
  assert.deepEqual(requests.filter(url=>prelost(url)&&!probe(url)).map(offset),['0','500','1000','1001']);
  const urgentDetail=mixed.items.find(r=>r.orderId==='P-TODAY');
  const alertDetail=mixed.items.find(r=>r.orderId==='A-TODAY');
  assert.deepEqual([urgentDetail.date,urgentDetail.hub,urgentDetail.aging,urgentDetail.amount,urgentDetail.cogs],['2026-11-18','Depot A',8,250,250]);
  assert.deepEqual([urgentDetail.reason,urgentDetail.status,urgentDetail.lastUser,urgentDetail.feedback],['Cần kiểm tra','Depot stage','Zone A','Chưa phản hồi']);
  assert.deepEqual([alertDetail.date,alertDetail.reason,alertDetail.status,alertDetail.lastUser],['2026-11-18','Kiểm tra bàn giao','','Timing: 4h']);
  assert.equal(risk.FLMSupabaseRisk.prelostData[0].area,'Fixture region');
  assert.equal(risk.FLMSupabaseRisk.prelostData[0].cot,'COT A');

  let finishAlert;
  fetchRows = url => !prelost(url)&&offset(url)==='0'?new Promise(resolve=>{finishAlert=resolve;}):response([]);
  alertDay='2026-11-16';
  const oldAlert=load(false), oldAlertSignal=signals.at(-1);
  alertDay=undefined;
  const beforeSummary=requests.length;
  await load(false);
  assert.equal(requests.length,beforeSummary,'Main detail waits for the scoped summary day');
  assert.equal(build().status,'LOADING','A stale Alert day cannot surface while the summary changes');
  alertDay='2026-11-17';
  fetchRows = url => offset(url)==='0'?response(prelost(url)?[row('CURRENT-PRELOST','2026-11-18'),row('OLD-PRELOST','2026-11-17')]:[
    row('ALERT-FROM-DAY-BEFORE','2026-11-16T17:01:00Z'),row('ALERT-FROM-DAY-AFTER','2026-11-18T00:01:00+14:00'),
    row('ALERT-EARLIER','2026-11-16'),row('ALERT-LATER','2026-11-18')]):response([]);
  await load(false);
  await oldAlert;
  assert.equal(oldAlertSignal.aborted,true);
  finishAlert(response([row('STALE-ALERT','2026-11-16')]));
  assert.deepEqual(ids(build()),['CURRENT-PRELOST','ALERT-FROM-DAY-BEFORE','ALERT-FROM-DAY-AFTER']);
  assert.equal(JSON.parse(storage.get(cacheKey)).alertDay,'2026-11-17');
  risk.FLMSupabaseRisk.today='';
  const beforeExactCache=requests.length;
  await load(false);
  assert.equal(requests.length,beforeExactCache,'Reload reuses a cache entry for the same Alert day');
  assert.deepEqual(ids(build()),['CURRENT-PRELOST','ALERT-FROM-DAY-BEFORE','ALERT-FROM-DAY-AFTER']);
  alertDay=null;

  let finishOld, finishNew;
  fetchRows = url => prelost(url)&&offset(url)==='0'?new Promise(resolve=>{finishOld=resolve;}):response([]);
  const old = load(true);
  risk.flmRiskScheduleMidnight_();
  assert.equal(currentTimer().delay,1000);
  utc = '2026-11-18T17:00:00Z';
  assert.equal(risk.flmSourceToday_(),'2026-11-19','Vietnam midnight occurs before the UTC date changes');
  fetchRows = url => prelost(url)&&offset(url)==='0'?new Promise(resolve=>{finishNew=resolve;}):
    response(!prelost(url)&&offset(url)==='0'?[row('A-ONLY-FUTURE','2026-11-24')]:[]);
  const beforeMidnightPaint = paints;
  const current = currentTimer().run();
  assert.equal(build().status,'LOADING');
  assert.equal(paints,beforeMidnightPaint+1,'Mounted page clears previous-day data immediately at midnight');
  assert.equal(requests.at(-1).searchParams.get('date'),'gte.2026-11-18');
  const previousStorage = storage.get(cacheKey), previousPaints = paints;
  finishOld(response([row('STALE','2026-11-26')]));
  await old;
  assert.equal(risk.FLMSupabaseRisk.liveLoading,true);
  assert.equal(paints,previousPaints);
  assert.equal(storage.get(cacheKey),previousStorage);
  finishNew(response([row('P-ONLY-FUTURE','2026-11-23')]));
  await current;
  assert.deepEqual(ids(build()),['P-ONLY-FUTURE','A-ONLY-FUTURE']);
  assert.equal(JSON.parse(storage.get(cacheKey)).today,'2026-11-19');

  fetchRows = () => ({ok:false,status:503});
  await load(true);
  assert.equal(build().status,'ERROR');
  const beforeRetry = requests.length;
  await load(false);
  assert.equal(requests.length,beforeRetry,'Same-day rerenders preserve the retry state');
  risk.FLMClaims.tab = 'lost';
  risk.FLMHubOrders = {active:true,tab:'alert'};
  risk.document.hidden = true;
  events.visibilitychange();
  assert.equal(currentTimer(),undefined);
  utc = '2026-11-19T17:00:00Z';
  risk.document.hidden = false;
  fetchRows = url => response(offset(url)==='0'?[row('ONLY-OLD','2026-11-19'),row('ONLY-INVALID','2026-11-31')]:[]);
  const beforeModal=modalPaints, beforeResume=requests.length;
  await events.pageshow();
  assert.equal(requests.length,beforeResume,'Resuming at midnight requires a fresh detail action');
  assert.equal(modalPaints,beforeModal);
  detailConsent=true;
  await load(false);
  assert.equal(modalPaints,beforeModal+1);
  const empty = build();
  assert.equal(empty.status,'OK');
  assert.equal(empty.total.n,0);
  assert.equal(empty.latestPrelostDate,null);
  assert.equal(empty.latestAlertDate,null);

  const beforeExpiry = requests.length;
  utc = '2026-11-19T17:29:59Z';
  await events.focus();
  assert.equal(requests.length,beforeExpiry,'A fresh empty result can be reused');
  utc = '2026-11-19T17:30:00Z';
  await events.visibilitychange();
  assert.equal(requests.length,beforeExpiry+4,'A same-day empty result expires after 30 minutes');
  risk.FLMSupabaseRisk.today = '';
  utc = '2026-11-19T18:00:00Z';
  await load(false);
  assert.equal(requests.length,beforeExpiry+8,'Expired session data must also be refreshed');

  let completeStalled;
  fetchRows = () => new Promise(resolve=>{completeStalled=resolve;});
  const stalled = load(true);
  const stalledSignal = signals.at(-1);
  const deadline = Array.from(timers.values()).find(timer=>timer.delay===45000);
  assert.ok(deadline);
  deadline.run();
  await stalled;
  assert.equal(stalledSignal.aborted,true);
  assert.equal(build().status,'ERROR');
  assert.match(build().error,/phản hồi quá lâu/);
  fetchRows = url => response(offset(url)==='0'?[row('RECOVERED','2026-11-20')]:[]);
  await load(true);
  completeStalled(response([row('TIMED-OUT','2026-11-25')]));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ids(build()),['RECOVERED','RECOVERED']);

  let finishSuperseded;
  fetchRows = url => prelost(url)?new Promise(resolve=>{finishSuperseded=resolve;}):response([]);
  const superseded = load(true);
  const supersededSignal = signals.at(-1);
  fetchRows = url => response(offset(url)==='0'?[row('EXPLICIT-RETRY','2026-11-21')]:[]);
  await load(true);
  await superseded;
  assert.equal(supersededSignal.aborted,true);
  finishSuperseded(response([row('SUPERSEDED','2026-11-25')]));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ids(build()),['EXPLICIT-RETRY','EXPLICIT-RETRY']);

  const repeated = row('DUPLICATE-ID','2026-11-20');
  fetchRows = url => response(prelost(url)?[repeated]:[]);
  await load(true);
  assert.equal(build().status,'ERROR');
  assert.match(build().error,/thứ tự phân trang bị trùng/);

  const beforeLimit = requests.length;
  fetchRows = url => response(prelost(url)?[row('PAGE-'+offset(url),'2026-11-20')]:[]);
  await load(true);
  assert.equal(requests.length,beforeLimit+101,'A source that never ends has a bounded page budget');
  assert.equal(build().status,'ERROR','A partial scan must never become a successful report');

  risk.state.page='dashboard';
  risk.flmRiskScheduleMidnight_();
  assert.equal(currentTimer(),undefined,'Leaving At-Risk cancels the scoped timer');
  const beforeInactive = requests.length;
  await events.pageshow();
  assert.equal(requests.length,beforeInactive);
  console.log('PASS: Synced Risk tables, field mappings and Vietnam dates, short pages and stable IDs, midnight, retry, and cache invalidation.');
}
verifyRiskDateWindow().catch(error => { console.error(error); process.exitCode = 1; });
