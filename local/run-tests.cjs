const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {writeFixtures} = require('./test-fixtures.cjs');
const root = path.resolve(__dirname,'..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(),'hcm-tests-'));
let failed = false;
try {
  console.log('HCM tests: isolated synthetic data; no production services.');
  for(const file of ['check.cjs','runtime.test.cjs','people.test.cjs','hourly.test.cjs','claims-ui.test.cjs']) {
    // Each suite gets fresh state so writes cannot leak into other tests.
    const suiteDir=path.join(directory,file);
    fs.mkdirSync(suiteDir);
    writeFixtures(suiteDir);
    const result=spawnSync(process.execPath,[path.join(__dirname,file)],{cwd:root,env:{...process.env,HCM_LOCAL_DATA_DIR:suiteDir},stdio:'inherit',timeout:120000});
    if(result.error)console.error(result.error.message);
    if(result.error||result.status!==0)failed=true;
  }
} finally {
  // Delete only the unique temporary directory created above, never local data.
  fs.rmSync(directory,{recursive:true,force:true});
}
process.exitCode=failed?1:0;
