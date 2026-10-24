const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function sources() {
  // Deoloyments.gs is an exact duplicate of DailyKPIDirect.gs in the supplied source.
  const duplicate = path.join(root, 'Deoloyments.gs');
  if (fs.existsSync(duplicate) && fs.readFileSync(duplicate, 'utf8') !== fs.readFileSync(path.join(root, 'DailyKPIDirect.gs'), 'utf8')) {
    throw Error('Deoloyments.gs has diverged. Reconcile it with DailyKPIDirect.gs before continuing.');
  }
  return fs.readdirSync(root).filter(n => /\.(gs|html)$/.test(n) && n !== 'Deoloyments.gs').sort();
}
function read(name) { return fs.readFileSync(path.join(root, name), 'utf8'); }
module.exports = { root, sources, read };
