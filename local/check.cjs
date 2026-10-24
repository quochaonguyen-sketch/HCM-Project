const vm = require('node:vm');
const { sources, read } = require('./source.cjs');
const backend = sources().filter(n => n.endsWith('.gs')).map(n => '\n// ' + n + '\n' + read(n)).join('\n');
new vm.Script(backend, { filename: 'apps-script-combined.gs' });
// Check the exported D0 file on its own: local API overrides must not mask
// an omitted section or a transform that discards hourly production data.
const d0 = {};
vm.runInNewContext(read('D0Data.gs'), d0, { filename: 'D0Data.gs' });
const hourlySheet = 'Throughput Hourly D0';
const hourlyField = 'lm_hub_received_in_system_order_qty_1h';
if (Array.from(d0.d0SectionSheets_('hourly')).join() !== hourlySheet) {
  throw Error('D0Data.gs must support the hourly section for production.');
}
const hourly = d0.d0SnapshotSection_(d0.d0SummarySnapshot_({ sheets: {
  [hourlySheet]: [{ hub_code: 'CHECK', station_id: 1, grass_date: '2026-10-19', hour: '00:00', [hourlyField]: 0 }]
} }), 'hourly');
if (hourly.section !== 'hourly' || hourly.sheets[hourlySheet]?.[0]?.[hourlyField] !== 0) {
  throw Error('Production D0 hourly data must survive summary and section filtering.');
}
for (const file of sources().filter(n => n.endsWith('.html'))) {
  const content = read(file);
  for (const match of content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const js = match[1].replace(/<\?!=[\s\S]*?\?>/g, '{}');
    new vm.Script(js, { filename: file });
  }
}
const { page } = require('./server.cjs');
const rendered = page();
if (/<\?/.test(rendered)) throw Error('Unresolved template');
// Catch startup regressions: the adapter must exist before any UI code runs,
// without fetching an external script first.
const firstScript = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/i.exec(rendered);
const browser = { window: {}, document: { addEventListener() {} } };
vm.runInNewContext(firstScript[1], browser);
if (typeof browser.window.google?.script?.run?.getHubMap !== 'function') {
  throw Error('Local Apps Script adapter missing before UI startup');
}
console.log('PASS: combined backend syntax, frontend script syntax, local template includes.');
console.log('PASS: local Apps Script adapter initialized before UI startup.');
