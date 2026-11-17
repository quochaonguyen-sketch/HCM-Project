/** Read the two aggregate tabs, never the shipment-level raw sheet. */
const FM_PENDING_CFG=Object.freeze({spreadsheetId:'1q-GyZsksjnYLA9kZ6m9rjwnLMT3VMSBoaL_DkLrR5Qo',visualId:344409718,deckId:1233387831,cacheSeconds:30,pollSeconds:60,maxRows:10000,version:'fm-pending-live-v1'});
function fmPendingNumber_(value){
  if(value==null||String(value).trim()===''||value==='—'||value==='-')return null;
  const text=String(value).replace(/[,\s]/g,'');
  if(!/^-?\d+(?:\.\d+)?$/.test(text))throw Error('FM_SOURCE_VALUE_INVALID: '+String(value).slice(0,40));
  return Number(text);
}
function fmPendingKey_(row){return flmTeamAlias_(row.hubName)}
function fmPendingAges_(row,start){const result={};['d2','d3','d4','dgt4','total'].forEach((key,i)=>result[key]=fmPendingNumber_(row[start+i]));return result}
function fmPendingChannels_(row,start){return {mp:fmPendingAges_(row,start),rv:fmPendingAges_(row,start+6),nss:fmPendingAges_(row,start+12),totalCombine:fmPendingNumber_(row[start+17])}}
function fmPendingHeader_(rows,hub){return rows.findIndex((r,i)=>i<12&&String(r[1]).trim()==='Zone'&&(!hub||String(r[2]).trim()==='Hub Name'))}
function fmPendingValidate_(rows,header,starts){
  if(header<0)throw Error('FM_SOURCE_SCHEMA_CHANGED: Missing Zone / HUB header');
  starts.forEach(start=>{['2','3','4','>4','Total'].forEach((label,i)=>{if(String(rows[header][start+i]).trim()!==label)throw Error('FM_SOURCE_SCHEMA_CHANGED: Aging columns moved')})});
}
function fmPendingParse_(deck,visual){
  const dh=fmPendingHeader_(deck,false),vh=fmPendingHeader_(visual,true);
  fmPendingValidate_(deck,dh,[2,8,14]);fmPendingValidate_(visual,vh,[3,9,15,46,52,61,67]);
  [[21,'Morning'],[22,'Now'],[25,'D0'],[26,'D-1'],[29,'W0'],[30,'W-1']].forEach(spec=>{if(String(deck[dh][spec[0]]).trim()!==spec[1])throw Error('FM_SOURCE_SCHEMA_CHANGED: Comparison columns moved')});
  if(String(visual[vh][45]).trim()!=='Hub Name'||String(visual[vh][60]).trim()!=='Hub Name')throw Error('FM_SOURCE_SCHEMA_CHANGED: Preorder HUB columns moved');
  const topHeader=deck.findIndex((r,i)=>i>dh&&String(r[0]).trim()==='Zone'&&String(r[1]).trim()==='Hub Name');
  if(topHeader<0)throw Error('FM_SOURCE_SCHEMA_CHANGED: Priority HUB table missing');
  if(!/^(Hạng|Rank)$/i.test(String(deck[topHeader][33]).trim())||!/backlog/i.test(String(deck[topHeader][34])))throw Error('FM_SOURCE_SCHEMA_CHANGED: Priority columns moved');
  const zoneRows=[],topHubRows=[],hubs=new Map(),preorder=new Map();
  for(let i=dh+1;i<topHeader;i++){
    const r=deck[i],zone=String(r[1]||'').trim();
    if(!zone||zone==='FLM HCM'||!/^[-\d,\s]+$/.test(String(r[19]||'')))continue;
    zoneRows.push(Object.assign({zone:zone},fmPendingChannels_(r,2),fmPendingComparisons_(r)));
  }
  let zone='';
  for(let i=topHeader+1;i<deck.length;i++){
    const r=deck[i];if(r[0])zone=String(r[0]).trim();
    if(!r[1]||fmPendingNumber_(r[33])==null)continue;
    topHubRows.push(Object.assign({zone:zone,hubName:String(r[1]).trim(),rank:fmPendingNumber_(r[33]),backlogGte4:fmPendingNumber_(r[34]),sharePct:r[35]||null,cumulativePct:r[36]||null},fmPendingChannels_(r,2),fmPendingComparisons_(r)));
  }
  // Each horizontal block is independently sorted. Join by HUB, never row number.
  [44,59].forEach(start=>{
    for(let i=vh+1;i<visual.length;i++){const r=visual[i];if(!r[start+1])continue;const name=String(r[start+1]).trim();preorder.set(flmTeamAlias_(name),{nonPreorder:fmPendingAges_(r,start+2),preorder:fmPendingAges_(r,start+8),preorderCombine:fmPendingNumber_(r[start+13])})}
  });
  zone='';
  for(let i=vh+1;i<visual.length;i++){
    const r=visual[i];if(r[1])zone=String(r[1]).trim();if(!r[2])continue;
    const row=Object.assign({zone:zone,hubName:String(r[2]).trim()},fmPendingChannels_(r,3)),key=fmPendingKey_(row);
    if(hubs.has(key))throw Error('FM_SOURCE_DUPLICATE_HUB: '+row.hubName);
    Object.assign(row,preorder.get(key)||{nonPreorder:{},preorder:{},preorderCombine:null});hubs.set(key,row);
  }
  const times=deck[dh-2]||[];
  return {trackerMeta:{title:String((deck[0]||[])[1]||'Pending PU Master Tracker'),timestamps:{morning:times[21]||null,now:times[22]||null,dMinus1:times[26]||null,wMinus1:times[30]||null}},validationMeta:{rule:String((visual[0]||[])[2]||''),note:String((visual[0]||[])[3]||'')},zoneRows:zoneRows,topHubRows:topHubRows,hubDetails:Array.from(hubs.values())};
}
function fmPendingComparisons_(r){return {d0MorningNow:{morning:fmPendingNumber_(r[21]),now:fmPendingNumber_(r[22])},d0VsDMinus1:{d0:fmPendingNumber_(r[25]),dMinus1:fmPendingNumber_(r[26])},w0VsWMinus1:{w0:fmPendingNumber_(r[29]),wMinus1:fmPendingNumber_(r[30])}}}
function fmPendingRead_(force){
  const cfg=FM_PENDING_CFG,cache=CacheService.getScriptCache(),key=cfg.version+':'+cfg.spreadsheetId;
  if(!force){try{const hit=cache.get(key);if(hit)return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(hit))).getDataAsString('UTF-8'))}catch(ignored){}}
  const book=SpreadsheetApp.openById(cfg.spreadsheetId);
  function read(id,width,name){const sheet=book.getSheetById(id);if(!sheet||sheet.getName()!==name)throw Error('FM_SOURCE_TAB_MISSING: '+name);const rows=sheet.getLastRow();if(rows>cfg.maxRows)throw Error('FM_SOURCE_TOO_LARGE: '+name);return sheet.getRange(1,1,Math.max(4,rows),width).getDisplayValues()}
  const data=fmPendingParse_(read(cfg.deckId,37,'3_Deck_HCM'),read(cfg.visualId,73,'2_Visual'));
  data.readAt=new Date().toISOString();data.localFixture=book.__localFixture===true;
  try{const packed=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(data),'application/json')).getBytes());if(packed.length<90000)cache.put(key,packed,cfg.cacheSeconds)}catch(ignored){}
  return data;
}
function fmPendingBacklog_(r){return flmTeamSum_(['mp','rv','nss'].flatMap(ch=>[r[ch].d4,r[ch].dgt4]))}
function fmPendingScoped_(data,ctx){
  const allowed=row=>Object.prototype.hasOwnProperty.call(ctx.aliases,fmPendingKey_(row));
  const details=data.hubDetails.filter(allowed),tops=data.topHubRows.filter(allowed),topByName=new Map(tops.map(row=>[fmPendingKey_(row),row]));
  const zoneNames=details.length===data.hubDetails.length?data.zoneRows.map(r=>r.zone):Array.from(new Set(details.map(r=>r.zone)));
  const zones=zoneNames.map(zone=>{
    const all=data.hubDetails.filter(r=>r.zone===zone),rows=details.filter(r=>r.zone===zone),source=data.zoneRows.find(r=>r.zone===zone);
    if(source&&all.length===rows.length)return source;
    const out={zone:zone};['mp','rv','nss'].forEach(ch=>{out[ch]={};['d2','d3','d4','dgt4','total'].forEach(k=>out[ch][k]=flmTeamSum_(rows.map(r=>r[ch][k])))});
    out.totalCombine=flmTeamSum_(rows.map(r=>r.totalCombine));
    out.d0MorningNow={now:flmTeamSum_(rows.map(fmPendingBacklog_)),morning:flmTeamSum_(rows.map(r=>{const t=topByName.get(fmPendingKey_(r));return t?t.d0MorningNow.morning:null}))};
    out.d0VsDMinus1={d0:out.d0MorningNow.now,dMinus1:flmTeamSum_(rows.map(r=>{const t=topByName.get(fmPendingKey_(r));return t?t.d0VsDMinus1.dMinus1:null}))};
    out.w0VsWMinus1={w0:flmTeamSum_(rows.map(r=>{const t=topByName.get(fmPendingKey_(r));return t?t.w0VsWMinus1.w0:null})),wMinus1:flmTeamSum_(rows.map(r=>{const t=topByName.get(fmPendingKey_(r));return t?t.w0VsWMinus1.wMinus1:null}))};
    return out;
  });
  // Source percentages use all HCM; the tracker recalculates them from authorized HUBs.
  const scopedTops=tops.map(row=>Object.assign({},row,{sharePct:null,cumulativePct:null}));
  return {trackerMeta:data.trackerMeta,validationMeta:data.validationMeta,zoneRows:zones,topHubRows:scopedTops,hubDetails:details,scope:ctx.scope,source:{spreadsheetId:FM_PENDING_CFG.spreadsheetId,deckGid:FM_PENDING_CFG.deckId,visualGid:FM_PENDING_CFG.visualId,readAt:data.readAt,pollSeconds:FM_PENDING_CFG.pollSeconds,mode:data.localFixture?'csv-fixture':'google-sheets',matchedHubs:details.length,requestedHubs:ctx.codes.length}};
}
function getFmPendingSnapshot(request){
  const r=request||{},ctx=flmTeamContext_('backlog',r); // Authorize before reading a shared cache.
  const result=fmPendingScoped_(fmPendingRead_(r.forceRefresh===true),ctx);
  const payload=JSON.stringify(result),bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,payload.replace(/"readAt":"[^"]*"/g,'"readAt":""'));
  const revision=Utilities.base64EncodeWebSafe(bytes),checkedAt=new Date().toISOString();
  if(r.ifRevision===revision)return {unchanged:true,revision:revision,checkedAt:checkedAt,source:result.source};
  return Object.assign(result,{revision:revision,checkedAt:checkedAt});
}
