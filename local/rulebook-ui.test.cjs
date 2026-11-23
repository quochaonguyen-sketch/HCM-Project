const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../Javascript.html'), 'utf8');
const start = source.indexOf('var rulebookTopics=');
const end = source.indexOf('// Tracking is independent', start);
const listeners = [];
const document = { addEventListener: (_, listener) => listeners.push(listener), querySelectorAll: () => [], getElementById: () => null };
const context = vm.createContext({
  document, renderMain() {}, bind() {}, state: { page: 'rulebook' },
  isNormalAccount: () => false, designFooter: () => '',
  e: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
});
vm.runInContext(source.slice(start, end), context);
const { rulebookRules: rules, rulebookTopics: topics } = context;

assert.equal(rules.length, new Set(rules.map(r => r.id)).size);
for (const id of [
  'page-dashboard','page-kpi','page-d0','page-fm-pending','page-volume','page-dtc','page-forecast',
  'page-people','page-workforce','page-claims','page-updates',
  'report-reading','missing-values','coverage','kpi-month','fm-ontime','lm-ontime',
  'delivery-success','correct-sop','rider-productivity','sorter-productivity','final-point','grade',
  'kpi-status','kpi-daily','comparison','kpi-colors','d0-reading','lm-backlog','lm-received','lm-volume',
  'fm-volume','backlog-aging','rider-performance','attendance','attendance-shifts','dtc','dtc-colors',
  'historical-forecast','volume-reading','volume-backlog-fm','volume-backlog-lm','volume-flows',
  'volume-forecast','volume-dtc','volume-risk','claims-reading','claims-cogs','claims-feedback',
  'lost-period','access-scope','source-health','cache-refresh','eod'
]) {
  assert.ok(context.rbFind_(id), id);
}

for (const r of rules) {
  assert.ok(topics.some(t => t[0] === r.topic), r.id);
  assert.ok(r.title && r.formula, r.id + ': has title and formula');
  if (r.daily) assert.deepEqual(Array.from(r.daily.source), ['Data Suite']);
}

const technical = /Supabase|BigQuery|hubops_pilot|[a-z]+_[a-z]+|KPI Result|kpis daily archive|KPI Date|Hub Code|Station Name|bảng\/tab|rb-source-location/i;
for (const r of rules) {
  assert.ok(!('location' in r), r.id + ': location data removed');
  if (r.topic === 'kpi' || r.id === 'page-kpi') assert.deepEqual(Array.from(r.source), ['Data Suite']);
  if (['d0', 'rider'].includes(r.topic) || ['page-d0', 'page-workforce', 'eod'].includes(r.id)) assert.deepEqual(Array.from(r.source), ['FMS']);
}

assert.doesNotMatch(context.rulebookPage(), technical);

const rows = rules.map(r => ({dataset:{ruleEntry:r.id},textContent:[r.title,r.formula,r.source.join(' '),JSON.stringify(r.rules)].join(' ')}));
const sections = topics.map(t => ({dataset:{rulebookSection:t[0]}, querySelectorAll:() => rows.filter(row => context.rbFind_(row.dataset.ruleEntry).topic === t[0]), querySelector:() => ({textContent:t[1]})}));
const input = {value:''}, results = {}, empty = {};
document.getElementById = id => id === 'rulebookSearch' ? input : id === 'rulebookResults' ? results : null;
document.querySelectorAll = selector => selector === '[data-rulebook-section]' ? sections : [];
document.querySelector = selector => selector === '.rulebook-empty' ? empty : null;
function search(query) {input.value=query;context.rulebookFilter();return rows.filter(r=>!r.hidden);}

assert.ok(search('rider').length);
assert.ok(search('pickup').length);
assert.ok(search('FMS').some(r=>r.dataset.ruleEntry==='page-d0'));
assert.ok(search('Data Suite').some(r=>r.dataset.ruleEntry==='kpi-daily'));
assert.equal(search('non-existent-xyz-query').length, 0);
assert.equal(empty.hidden, false);

context.Rulebook.selectedTopic='kpi';
assert.ok(search('').every(r=>context.rbFind_(r.dataset.ruleEntry).topic==='kpi'));
context.Rulebook.selectedTopic='ALL';context.Rulebook.allOpen=true;
assert.equal(search('').length, rules.length);
assert.ok(rows.every(r=>r.open));

context.RuleHelp.id='fm-ontime';context.RuleHelp.context='daily';
const dialog={};document.getElementById=id=>id==='ruleHelpDialog'?dialog:null;
context.ruleHelpRender_();
assert.match(dialog.innerHTML,/data-rule-full="fm-ontime"/);
assert.match(dialog.innerHTML,/data-rule-context-switch="daily" aria-pressed="true"/);
assert.match(dialog.innerHTML,/Source: Data Suite/);
assert.match(dialog.innerHTML,/aria-label="Close help"/);

assert.ok(listeners.length, 'Shared help/copy/topic event delegation remains bound');
console.log('Rulebook: English sources, stable IDs, thresholds, search, topic filter, and contextual help all PASSED.');
