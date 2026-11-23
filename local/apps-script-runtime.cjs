const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const cp = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { sources, read } = require('./source.cjs');
const dataDir = process.env.HCM_LOCAL_DATA_DIR || __dirname;

let syncWorker = null;
let syncSab = null;
let syncInt32 = null;

function getSyncWorker() {
  if (!syncWorker) {
    syncSab = new SharedArrayBuffer(10 * 1024 * 1024);
    syncInt32 = new Int32Array(syncSab);
    const workerPath = path.resolve(__dirname, 'sync-fetch-worker.cjs');
    syncWorker = new Worker(workerPath, { workerData: { sab: syncSab } });
    syncWorker.unref();
  }
  return { syncWorker, sab: syncSab, int32: syncInt32 };
}

function syncFetch(url, options = {}) {
  if (url.includes('example.test') || url.includes('synthetic-d0') || !/^https?:\/\//i.test(url)) {
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ code: 0, msg: 'ok' }),
      getHeaders: () => ({}),
      getBlob: () => blob('')
    };
  }
  try {
    const { syncWorker: w, sab, int32 } = getSyncWorker();
    int32[0] = 0;
    w.postMessage({ url, options });
    Atomics.wait(int32, 0, 0);
    const len = int32[1];
    const status = int32[2];
    const text = Buffer.from(sab, 16, len).toString('utf8');
    if (status >= 400 && !options.muteHttpExceptions) {
      throw Error('Request failed for ' + url + ' returned code ' + status + '. Server response: ' + text);
    }
    return {
      getResponseCode: () => status,
      getContentText: () => text,
      getHeaders: () => ({}),
      getBlob: () => blob(text)
    };
  } catch (err) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    const args = ['-s', '-S', '-w', '\n__HTTP_STATUS__:%{http_code}', '-X', method];
    for (const [k, v] of Object.entries(headers)) args.push('-H', k + ': ' + v);
    if (options.payload) args.push('-d', typeof options.payload === 'string' ? options.payload : JSON.stringify(options.payload));
    args.push(url);
    const res = cp.spawnSync('curl', args, { maxBuffer: 50 * 1024 * 1024 });
    if (res.error) throw res.error;
    const raw = res.stdout.toString('utf8');
    const splitIdx = raw.lastIndexOf('\n__HTTP_STATUS__:');
    const body = splitIdx !== -1 ? raw.slice(0, splitIdx) : raw;
    const status = splitIdx !== -1 ? parseInt(raw.slice(splitIdx + 17).trim(), 10) : 200;
    if (status >= 400 && !options.muteHttpExceptions) {
      throw Error('Request failed for ' + url + ' returned code ' + status + '. Server response: ' + body);
    }
    return {
      getResponseCode: () => status,
      getContentText: () => body,
      getHeaders: () => ({}),
      getBlob: () => blob(body)
    };
  }
}

function createRuntime() {
  const file = path.join(dataDir,'workbooks.private.json');
  if (!fs.existsSync(file)) throw Error('Run local/import-workbooks.py first.');
  const data = JSON.parse(fs.readFileSync(file,'utf8'),(_,v)=>v&&v.$date?new Date(v.$date.length===10?v.$date+'T00:00:00+07:00':v.$date+'+07:00'):v);
  const peopleFile=path.join(dataDir,'people-source.private.json');
  if(fs.existsSync(peopleFile))Object.assign(data.backend.sheets,JSON.parse(fs.readFileSync(peopleFile,'utf8'),(_,v)=>v&&v.$date?new Date(v.$date+'+07:00'):v).sheets);
  const { prepareData } = require('./sample-data.cjs');
  const provenance = prepareData(data, dataDir);
  const fmFile=path.join(dataDir,'fm-source.private.json');
  if(fs.existsSync(fmFile)){const fm=JSON.parse(fs.readFileSync(fmFile,'utf8'));data[fm.spreadsheetId]=fm;}
  // Real hourly sample: never fill missing HUBs or hours with mock values.
  const hourlyFile=path.join(dataDir,'hourly.private.json');
  if(fs.existsSync(hourlyFile))data.backend.sheets['Throughput Hourly D0']=JSON.parse(fs.readFileSync(hourlyFile,'utf8'));
  const stateFile=path.join(dataDir,'state.private.json');
  const saved=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{};
  const props=Object.assign({APP_DB_SHEET_ID:'frontend',D0_DB_SHEET_ID:'backend',KPI_DAILY_DB_SHEET_ID:'frontend'},saved.properties||{});
  // Rebuild derived caches from the imported workbook on every server restart.
  Object.keys(props).filter(k=>k.startsWith('spx:')).forEach(k=>delete props[k]);
  const userProps={};
  const cache=new Map();
  const mutations={...saved.sheets};
  for(const [id,rows] of Object.entries(mutations)) { const [book,name]=JSON.parse(id);if(data[book])data[book].sheets[name]=rows; }
  function persist(){fs.writeFileSync(stateFile,JSON.stringify({properties:Object.fromEntries(Object.entries(props).filter(([k])=>!k.startsWith('spx:'))),sheets:mutations}));}
  function propertyStore(store,persistent=false){return {
    getProperty:k=>store[k]??null,getProperties:()=>({...store}),
    setProperty(k,v){store[k]=String(v);if(persistent&&!k.startsWith('spx:'))persist();return this;},
    setProperties(values,replace){if(replace)Object.keys(store).forEach(k=>delete store[k]);Object.assign(store,values);if(persistent)persist();return this;},
    deleteProperty(k){delete store[k];if(persistent)persist();return this;},
    deleteAllProperties(){Object.keys(store).forEach(k=>delete store[k]);if(persistent)persist();return this;}
  };}
  const cacheApi={
    get(k){const x=cache.get(k);return x&&x.until>Date.now()?x.value:null;},
    put(k,v,ttl=600){cache.set(k,{value:String(v),until:Date.now()+ttl*1000});},
    remove:k=>cache.delete(k),removeAll:keys=>keys.forEach(k=>cache.delete(k)),
    getAll(keys){return Object.fromEntries(keys.map(k=>[k,this.get(k)]).filter(x=>x[1]!=null));},
    putAll(values,ttl){Object.entries(values).forEach(([k,v])=>this.put(k,v,ttl));}
  };
  function blob(v){const b=Buffer.isBuffer(v)?v:Buffer.from(Array.isArray(v)?v:String(v??''));return {getBytes:()=>[...b],getDataAsString:()=>b.toString('utf8')};}
  function formatDate(value,tz,pattern){
    const d=new Date(value);if(!isFinite(+d))return '';
    const vnMs=+d+25200000;
    const vn=new Date(vnMs);
    const yyyy=vn.getUTCFullYear();
    const MM=String(vn.getUTCMonth()+1).padStart(2,'0');
    const dd=String(vn.getUTCDate()).padStart(2,'0');
    const HH=String(vn.getUTCHours()).padStart(2,'0');
    const mm=String(vn.getUTCMinutes()).padStart(2,'0');
    const ss=String(vn.getUTCSeconds()).padStart(2,'0');
    return pattern.replace(/'([^']*)'|yyyy|MMMM|MMM|MM|dd|HH|mm|ss|XXX|Z/g,(token,literal)=>{
      if(literal!==undefined)return literal;
      switch(token){
        case 'yyyy':return yyyy;
        case 'MM':return MM;
        case 'dd':return dd;
        case 'HH':return HH;
        case 'mm':return mm;
        case 'ss':return ss;
        case 'XXX':return '+07:00';
        case 'Z':return '+0700';
        case 'MMM':return new Intl.DateTimeFormat('en-US',{timeZone:tz||'Asia/Ho_Chi_Minh',month:'short'}).format(d);
        case 'MMMM':return new Intl.DateTimeFormat('en-US',{timeZone:tz||'Asia/Ho_Chi_Minh',month:'long'}).format(d);
        default:return '';
      }
    });
  }
  const noOpChain=new Proxy({}, {get:(_,k)=>k==='then'?undefined:()=>noOpChain});
  class Sheet {
    constructor(book,name){this.book=book;this.name=name;this.rows=data[book].sheets[name];}
    getName(){return this.name;}getParent(){return books[this.book];}getSheetId(){return data[this.book].sheetIds?.[this.name]||Object.keys(data[this.book].sheets).indexOf(this.name)+1;}
    getLastRow(){return this.rows.length;}getLastColumn(){return Math.max(1,...this.rows.map(r=>r?r.length:0));}getMaxRows(){return Math.max(1000,this.rows.length);}getMaxColumns(){return this.getLastColumn();}
    changed(){mutations[JSON.stringify([this.book,this.name])]=this.rows;persist();}
    getDataRange(){return this.getRange(1,1,Math.max(1,this.getLastRow()),this.getLastColumn());}
    getRange(row,col,numRows=1,numCols=1){
      if(typeof row==='string') {const m=/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(row);if(!m)throw Error('Unsupported A1 range: '+row);const column=s=>[...s].reduce((a,c)=>a*26+c.charCodeAt(0)-64,0);col=column(m[1]);row=+m[2];numRows=m[4]?+m[4]-row+1:1;numCols=m[3]?column(m[3])-col+1:1;}
      const sheet=this;
      const range={
        getValues:()=>Array.from({length:numRows},(_,i)=>Array.from({length:numCols},(_,j)=>sheet.rows[row+i-1]?.[col+j-1]??'')),
        getDisplayValues(){return this.getValues().map(r=>r.map(v=>v instanceof Date?formatDate(v,'Asia/Ho_Chi_Minh','yyyy-MM-dd'):String(v??'')));},
        getValue(){return this.getValues()[0][0];},getDisplayValue(){return this.getDisplayValues()[0][0];},
        setValues(values){values.forEach((r,i)=>r.forEach((v,j)=>{sheet.rows[row+i-1]??=[];sheet.rows[row+i-1][col+j-1]=v;}));sheet.changed();return this;},
        setValue(v){return this.setValues([[v]]);},clearContent(){return this.setValues(Array.from({length:numRows},()=>Array(numCols).fill('')));},
        getRow:()=>row,getColumn:()=>col,getNumRows:()=>numRows,getNumColumns:()=>numCols,getSheet:()=>sheet,
        getNumberFormats:()=>Array.from({length:numRows},()=>Array(numCols).fill('General')),
        getNotes:()=>Array.from({length:numRows},()=>Array(numCols).fill('')),
        createTextFinder(text){return {matchEntireCell(){return this;},matchCase(){return this;},findAll(){return range.getValues().flatMap((r,i)=>r.flatMap((v,j)=>String(v)===String(text)?[sheet.getRange(row+i,col+j)]:[]));},findNext(){return this.findAll()[0]||null;}};}
      };
      for(const method of ['setNumberFormat','setNumberFormats','setFontWeight','setBackground','setFontColor','setWrap','setVerticalAlignment','setHorizontalAlignment','setNote','setNotes','setBorder'])range[method]=()=>range;
      return range;
    }
    appendRow(row){this.rows.push(row);this.changed();return this;}deleteRow(row){this.rows.splice(row-1,1);this.changed();return this;}
    clearContents(){this.rows.length=0;this.changed();return this;}clear(){return this.clearContents();}
    insertRowsAfter(){return this;}insertColumnsAfter(){return this;}setFrozenRows(){return this;}autoResizeColumns(){return this;}hideSheet(){return this;}
  }
  const books=Object.fromEntries(Object.entries(data).map(([id,b])=>[id,{
    getId:()=>id,getName:()=>b.name,getUrl:()=>'/#dashboard',getSpreadsheetTimeZone:()=>'Asia/Ho_Chi_Minh',
    getSheetByName:n=>b.sheets[n]?new Sheet(id,n):null,getSheetById:gid=>{const name=Object.keys(b.sheets).find(n=>(b.sheetIds?.[n]||Object.keys(b.sheets).indexOf(n)+1)===gid);return name?new Sheet(id,name):null;},getSheets:()=>Object.keys(b.sheets).map(n=>new Sheet(id,n)),__localFixture:!!b.importedAt,
    insertSheet(n){if(b.sheets[n])throw Error('Sheet exists');b.sheets[n]=[];const s=new Sheet(id,n);s.changed();return s;}
  }]));
  const context=vm.createContext({Date,console,Buffer,Set,Map,
    Session:{getActiveUser:()=>({getEmail:()=>'admin@example.test'}),getEffectiveUser:()=>({getEmail:()=>'admin@example.test'}),getScriptTimeZone:()=>'Asia/Ho_Chi_Minh'},
    SpreadsheetApp:{openById:id=>{if(!books[id])throw Error('Unknown local workbook: '+id);return books[id];},getActiveSpreadsheet:()=>books.frontend,flush(){},newDataValidation:()=>noOpChain},
    PropertiesService:{getScriptProperties:()=>propertyStore(props,true),getUserProperties:()=>propertyStore(userProps),getDocumentProperties:()=>propertyStore(props,true)},
    CacheService:{getScriptCache:()=>cacheApi,getUserCache:()=>cacheApi,getDocumentCache:()=>cacheApi},
    LockService:{getScriptLock:()=>({tryLock:()=>true,waitLock(){},releaseLock(){}}),getDocumentLock:()=>({tryLock:()=>true,waitLock(){},releaseLock(){}})},
    Utilities:{formatDate,getUuid:()=>crypto.randomUUID(),sleep(){},newBlob:blob,gzip:v=>blob(zlib.gzipSync(Buffer.from(v.getBytes()))),ungzip:v=>blob(zlib.gunzipSync(Buffer.from(v.getBytes()))),base64Encode:v=>Buffer.from(v).toString('base64'),base64Decode:v=>[...Buffer.from(v,'base64')],base64EncodeWebSafe:v=>Buffer.from(v).toString('base64url'),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'UTF-8'},computeDigest:(algo,value)=>[...crypto.createHash(algo).update(String(value)).digest()]},
    UrlFetchApp:{fetch:syncFetch},
    ScriptApp:(function(){
      let triggers=[];
      return {
        getService:()=>({getUrl:()=>'/'}),
        getProjectTriggers:()=>triggers.slice(),
        deleteTrigger:(t)=>{triggers=triggers.filter(x=>x!==t);},
        newTrigger:(handler)=>{
          let t={getHandlerFunction:()=>handler,getUniqueId:()=>'tr-'+Math.random().toString(36).slice(2,8),timeBased:()=>t,atHour:()=>t,nearMinute:()=>t,everyDays:()=>t,inTimezone:()=>t,create:()=>{triggers.push(t);return t;}};
          return t;
        },
        getScriptId:()=>'local-only'
      };
    })(),
    Logger:console,
  });
  const code=sources().filter(n=>n.endsWith('.gs')).map(n=>'\n// '+n+'\n'+read(n)).join('\n');
  vm.runInContext(code,context,{timeout:20000});
  const apiNames=new Set([...code.matchAll(/^function\s+([A-Za-z]\w*)\s*\(/gm)].map(m=>m[1]).filter(n=>!n.endsWith('_')));
  const mocks=require('./mock-bigquery.cjs')(data,context);
  Object.assign(context,mocks);
  return {
    context,data,provenance,
    call(method,args=[]){
      if(!apiNames.has(method))throw Error('LOCAL_API_UNAVAILABLE: '+method);
      context.__rpcMethod=method;context.__rpcArgs=args;
      return vm.runInContext('globalThis[__rpcMethod].apply(null,__rpcArgs)',context,{timeout:120000});
    }
  };
}
module.exports={createRuntime,dataDir};
