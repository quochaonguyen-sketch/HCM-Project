const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { sources, read } = require('./source.cjs');

function createRuntime() {
  const file = path.join(__dirname,'workbooks.private.json');
  if (!fs.existsSync(file)) throw Error('Run local/import-workbooks.py first.');
  const data = JSON.parse(fs.readFileSync(file,'utf8'),(_,v)=>v&&v.$date?new Date(v.$date.length===10?v.$date+'T00:00:00+07:00':v.$date+'+07:00'):v);
  const { prepareData } = require('./sample-data.cjs');
  const provenance = prepareData(data);
  // Real hourly sample: never fill missing HUBs or hours with mock values.
  const hourlyFile=path.join(__dirname,'hourly.private.json');
  if(fs.existsSync(hourlyFile))data.backend.sheets['Throughput Hourly D0']=JSON.parse(fs.readFileSync(hourlyFile,'utf8'));
  const stateFile=path.join(__dirname,'state.private.json');
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
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz||'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d).map(p=>[p.type,p.value]));
    return pattern.replace(/'([^']*)'|yyyy|MMMM|MMM|MM|dd|HH|mm|ss|XXX|Z/g,(token,literal)=>literal!==undefined?literal:({yyyy:parts.year,MM:parts.month,dd:parts.day,HH:parts.hour,mm:parts.minute,ss:parts.second,XXX:'+07:00',Z:'+0700',MMM:new Intl.DateTimeFormat('en-US',{timeZone:tz,month:'short'}).format(d),MMMM:new Intl.DateTimeFormat('en-US',{timeZone:tz,month:'long'}).format(d)})[token]);
  }
  const noOpChain=new Proxy({}, {get:(_,k)=>k==='then'?undefined:()=>noOpChain});
  class Sheet {
    constructor(book,name){this.book=book;this.name=name;this.rows=data[book].sheets[name];}
    getName(){return this.name;}getParent(){return books[this.book];}getSheetId(){return Object.keys(data[this.book].sheets).indexOf(this.name)+1;}
    getLastRow(){return this.rows.length;}getLastColumn(){return Math.max(1,...this.rows.map(r=>r.length));}getMaxRows(){return Math.max(1000,this.rows.length);}getMaxColumns(){return this.getLastColumn();}
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
    getSheetByName:n=>b.sheets[n]?new Sheet(id,n):null,getSheets:()=>Object.keys(b.sheets).map(n=>new Sheet(id,n)),
    insertSheet(n){if(b.sheets[n])throw Error('Sheet exists');b.sheets[n]=[];const s=new Sheet(id,n);s.changed();return s;}
  }]));
  const context=vm.createContext({Date,console,Buffer,Set,Map,
    Session:{getActiveUser:()=>({getEmail:()=>'admin@example.test'}),getEffectiveUser:()=>({getEmail:()=>'admin@example.test'}),getScriptTimeZone:()=>'Asia/Ho_Chi_Minh'},
    SpreadsheetApp:{openById:id=>{if(!books[id])throw Error('Unknown local workbook: '+id);return books[id];},getActiveSpreadsheet:()=>books.frontend,flush(){},newDataValidation:()=>noOpChain},
    PropertiesService:{getScriptProperties:()=>propertyStore(props,true),getUserProperties:()=>propertyStore(userProps),getDocumentProperties:()=>propertyStore(props,true)},
    CacheService:{getScriptCache:()=>cacheApi,getUserCache:()=>cacheApi,getDocumentCache:()=>cacheApi},
    LockService:{getScriptLock:()=>({tryLock:()=>true,waitLock(){},releaseLock(){}}),getDocumentLock:()=>({tryLock:()=>true,waitLock(){},releaseLock(){}})},
    Utilities:{formatDate,getUuid:()=>crypto.randomUUID(),sleep(){},newBlob:blob,gzip:v=>blob(zlib.gzipSync(Buffer.from(v.getBytes()))),ungzip:v=>blob(zlib.gunzipSync(Buffer.from(v.getBytes()))),base64Encode:v=>Buffer.from(v).toString('base64'),base64Decode:v=>[...Buffer.from(v,'base64')],base64EncodeWebSafe:v=>Buffer.from(v).toString('base64url')},
    ScriptApp:{getService:()=>({getUrl:()=>'/'}),getProjectTriggers:()=>[],getScriptId:()=>'local-only'},
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
      return vm.runInContext('globalThis[__rpcMethod].apply(null,__rpcArgs)',context,{timeout:25000});
    }
  };
}
module.exports={createRuntime};
