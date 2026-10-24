const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { read } = require('./source.cjs');
let runtime;
function getRuntime() {
  if (!runtime) runtime = require('./apps-script-runtime.cjs').createRuntime();
  return runtime;
}
function page() {
  const app = getRuntime();
  const boot = app.call('getWorkspaceBootstrapFast', [false]);
  let html = read('index.html').replace(/<\?!=\s*include\('([A-Za-z0-9_-]+)'\);?\s*\?>/g, (_, name) => read(name + '.html'));
  html = html.replace(/<\?!=\s*boot\s*\?>/g, JSON.stringify(boot).replace(/</g, '\\u003c'));
  if (/<\?/.test(html)) throw Error('Unresolved Apps Script template expression');
  // Initialize the Apps Script adapter synchronously in the document. The UI
  // starts immediately and must not depend on a separate script request.
  const bridge = 'window.__LOCAL_DATA__ = ' + JSON.stringify({
    mode:app.provenance.mode,hubs:app.provenance.hubs,mockCellsAndRows:app.provenance.mockCellsAndRows
  }).replace(/</g,'\\u003c') + ';\n' + fs.readFileSync(path.join(__dirname, 'bridge.js'), 'utf8');
  return html.replace('<head>', () => '<head><script data-local-bridge>' + bridge + '</script>');
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  try {
    if (req.method === 'GET' && req.url === '/') return send(200, 'text/html; charset=utf-8', page());
    if (req.method === 'GET' && req.url === '/local-bridge.js') return send(200, 'text/javascript; charset=utf-8', fs.readFileSync(path.join(__dirname, 'bridge.js')));
    if (req.method === 'GET' && req.url === '/health') return send(200, 'application/json', JSON.stringify({ ok: true, mode: 'local-xlsx-and-mock' }));
    if (req.method === 'GET' && req.url === '/api/local-data') {
      const {ledger,...summary}=getRuntime().provenance;
      return send(200,'application/json; charset=utf-8',JSON.stringify(summary));
    }
    if (req.method === 'POST' && req.url === '/api/rpc') {
      // Reject cross-origin mutation requests; bind to loopback only.
      if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return send(403, 'application/json', JSON.stringify({ error: 'Origin denied' }));
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 1048576) return send(413, 'application/json', JSON.stringify({ error: 'Request too large' })); }
      const { method, args } = JSON.parse(body);
      if (typeof method !== 'string' || !Array.isArray(args)) throw Error('Invalid RPC request');
      const started=Date.now();
      const result=getRuntime().call(method,args);
      console.log('[LOCAL XLSX]',method,Date.now()-started+'ms');
      return send(200, 'application/json; charset=utf-8', JSON.stringify(result));
    }
    send(404, 'text/plain', 'Not found');
  } catch (error) { console.error(error.stack);send(500, 'application/json', JSON.stringify({ error: error.message })); }
});
if (require.main === module) server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('HCM local: http://127.0.0.1:' + server.address().port));
module.exports = { server, page, getRuntime };
