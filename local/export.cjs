const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { root, sources, read } = require('./source.cjs');
require('./check.cjs');
const out = path.join(root, 'dist', 'apps-script');
fs.mkdirSync(out, { recursive: true });
const manifest = {};
for (const name of sources()) {
  // Apps Script doGet requests Index, while the supplied source is named index.
  const target = name === 'index.html' ? 'Index.html' : name;
  const content = read(name);
  fs.writeFileSync(path.join(out, target), content);
  manifest[target] = crypto.createHash('sha256').update(content).digest('hex');
}
fs.writeFileSync(path.join(root, 'dist', 'source-hashes.json'), JSON.stringify(manifest, null, 2));
console.log('Production source bundle: ' + out);
console.log('No deployment performed. Preserve the existing Apps Script manifest and project settings.');
