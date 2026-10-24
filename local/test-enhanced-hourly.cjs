const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {createRuntime}=require('./apps-script-runtime.cjs');
const r=createRuntime();
const result=r.call('getD0Snapshot',[false,'hourly']);
const rows=result.sheets['Throughput Hourly D0'];

const js=fs.readFileSync(path.join(__dirname,'..','Javascript.html'),'utf8');
const startIndex=js.indexOf('var LmHourly={');
const endIndex=js.indexOf('// Rider page changes only replace');
const snippet=js.slice(startIndex,endIndex);

const ctx={
  D0:{loading:false,data:{sheets:{'Throughput Hourly D0':rows}}},
  d0SectionReady:()=>true,
  d0Scoped:()=>Array.from(new Set(rows.map(x=>x.hub_code))).map(code=>({code})),
  d0Num:v=>typeof v==='number'&&isFinite(v)?v:null,
  d0Fmt:n=>n==null?'-':String(n),
  d0Time:d=>d||'',
  d0LatestUpdated:()=>'12:00',
  uiDateLabel:d=>d,
  e:s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
  document:{getElementById:()=>null,querySelectorAll:()=>[]},
  bind:()=>{},
  Set
};
vm.createContext(ctx);
vm.runInContext(snippet,ctx);

// 1. Test combined multi-model
ctx.LmHourly.mode='combined';
ctx.LmHourly.hub='';
let multi=ctx.lmHourlyMultiModel_();
assert.equal(multi.hubs.length, 100);
assert.equal(multi.totals.received, 295061);
assert.equal(multi.totals.assigned, 463058);
assert.equal(multi.totals.delivered, 289118);
assert.equal(multi.peaks.received.hour, 5);
assert.equal(multi.peaks.assigned.hour, 8);
assert.equal(multi.peaks.delivered.hour, 10);

// 2. Test Combined Panel HTML
let htmlCombined=ctx.lmHourlyPanel_();
assert(htmlCombined.includes('Biểu đồ phân tích luồng đơn theo giờ'));
assert(htmlCombined.includes('Biểu đồ tổng hợp (Multi-Flow)'));
assert(htmlCombined.includes('295061'));
assert(htmlCombined.includes('463058'));
assert(htmlCombined.includes('289118'));
assert(htmlCombined.includes('lm-hourly-bar-rec'));
assert(htmlCombined.includes('lm-hourly-bar-ass'));
assert(htmlCombined.includes('lm-hourly-bar-del'));
assert(htmlCombined.includes('Xem số liệu đối soát theo giờ'));

// 3. Test Combined with Line View
ctx.LmHourly.combinedType='line';
let htmlCombinedLine=ctx.lmHourlyPanel_();
assert(htmlCombinedLine.includes('lm-chart-line-rec'));
assert(htmlCombinedLine.includes('lm-chart-line-ass'));
assert(htmlCombinedLine.includes('lm-chart-line-del'));

// 4. Test Single Metric Mode
ctx.LmHourly.mode='single';
ctx.LmHourly.metric='assigned';
ctx.LmHourly.singleType='bar';
let htmlSingle=ctx.lmHourlyPanel_();
assert(htmlSingle.includes('Chi tiết từng chỉ số (Single Metric)'));
assert(htmlSingle.includes('Assigned'));
assert(htmlSingle.includes('Đường TB'));

// 6. Test Time Window Selection (Attendance-like window picker)
ctx.LmHourly.window='06-12';
let htmlWindow=ctx.lmHourlyPanel_();
assert(htmlWindow.includes('lm-time-controls'));
assert(htmlWindow.includes('06-12'));
assert(htmlWindow.includes('06:00'));
assert(htmlWindow.includes('12:00'));

// 7. Test Custom Hours Window
ctx.LmHourly.window='custom';
ctx.LmHourly.fromHour=4;
ctx.LmHourly.toHour=10;
let htmlCustom=ctx.lmHourlyPanel_();
assert(htmlCustom.includes('lm-custom-hours'));
assert(htmlCustom.includes('lmHourlyFrom'));
assert(htmlCustom.includes('lmHourlyTo'));

// 8. Test Wide Scrollable Canvas width & scroll hint
assert(htmlCustom.includes('lm-hourly-chart'));
assert(htmlCustom.includes('lm-scroll-hint'));
assert(htmlCustom.includes('width='));

console.log('ALL ENHANCED TESTS PASSED: Combined Multi-Flow and Single Customizable Charts behave flawlessly with Window Picker and Scrollable Canvas!');

