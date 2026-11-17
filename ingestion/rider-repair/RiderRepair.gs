/** Missing-table bootstrap ONLY. Install in ONE ingestion project owned by Anh Phi.
 * Does not run from app requests, does not create triggers, never writes FTE.
 * Public entrypoints are owner-only. Pause/guard legacy Rider writer first (README).
 */
var FLMRR_CFG=Object.freeze({owner:'anhphi.nguyenhoang@spxexpress.com',project:'root-opus-497613-d8',dataset:'hubops_pilot',location:'asia-southeast1',target:'flm_rider_resource_v1',source:'1mZU0OayQFHY36Udz64tVxKlxl1RJ_pVpc51GBy0mXE4',candidate:'FLMRR_CANDIDATE',pending:'FLMRR_PENDING',success:'FLMRR_LAST_SUCCESS'});
function FLMRR_report_(v){console.log(JSON.stringify(v));return v;}
function FLMRR_owner_(){if(String(Session.getEffectiveUser().getEmail()).trim().toLowerCase()!==FLMRR_CFG.owner)throw Error('RIDER_REPAIR_OWNER_ONLY');}
function FLMRR_locked_(f){FLMRR_owner_();var l=LockService.getScriptLock();if(!l.tryLock(1000))return {state:'BUSY'};try{return f(PropertiesService.getScriptProperties());}finally{l.releaseLock();}}
function FLMRR_hash_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function FLMRR_ref_(t){if(t!==FLMRR_CFG.target&&!/^_flmrr_rider_[a-f0-9]{32}$/.test(t))throw Error('RIDER_INVALID_DESTINATION');return {projectId:FLMRR_CFG.project,datasetId:FLMRR_CFG.dataset,tableId:t};}
function FLMRR_jobRef_(id){return {projectId:FLMRR_CFG.project,location:FLMRR_CFG.location,jobId:id};}
function FLMRR_schema_(){return [['module','STRING'],['employee_id','STRING'],['employee_name','STRING'],['station','STRING'],['position','STRING'],['join_date','DATE'],['last_work_date','DATE'],['quality','STRING'],['issues','STRING'],['ingested_at','TIMESTAMP']].map(function(x){return {name:x[0],type:x[1],mode:'NULLABLE'};});}
function FLMRR_missing_(e){var s=String(e&&e.message||e),code=Number(e&&(e.code||(e.details&&e.details.code)));return code===404||/\bNot found: Table\b/i.test(s);}
function FLMRR_target_(){try{return BigQuery.Tables.get(FLMRR_CFG.project,FLMRR_CFG.dataset,FLMRR_CFG.target);}catch(e){if(FLMRR_missing_(e))return null;throw e;}}
function FLMRR_dataset_(){var d=BigQuery.Datasets.get(FLMRR_CFG.project,FLMRR_CFG.dataset);if(String(d.location||'').toLowerCase()!==FLMRR_CFG.location)throw Error('RIDER_DATASET_LOCATION_MISMATCH');}
function FLMRR_metaCheck_(m,table,rows){
  if(!m||m.type!=='TABLE'||!m.tableReference||m.tableReference.projectId!==FLMRR_CFG.project||m.tableReference.datasetId!==FLMRR_CFG.dataset||m.tableReference.tableId!==table)throw Error('RIDER_TABLE_REFERENCE_INVALID');
  var f={};(m.schema&&m.schema.fields||[]).forEach(function(x){f[x.name]=x;});var bad=FLMRR_schema_().filter(function(x){return !f[x.name]||f[x.name].type!==x.type||f[x.name].mode==='REPEATED';});if(bad.length)throw Error('RIDER_SCHEMA_INVALID: '+bad.map(function(x){return x.name;}).join(','));
  if(rows!=null&&String(m.numRows)!==String(rows))throw Error('RIDER_TABLE_COUNT_MISMATCH');if(m.streamingBuffer)throw Error('RIDER_TABLE_HAS_STREAMING_BUFFER');
}
function FLMRR_noLegacyPending_(p){if(p.getProperty('FLMPI_PENDING_RIDER'))throw Error('LEGACY_RIDER_PENDING: reconcile old job first; do not delete checkpoint');}
function FLMRR_read_(p){
  var ranges=["'Danh sách nhân viên'!A:K","'Danh sách nghỉ việc 2026 - RIDER'!A:K"],d=Sheets.Spreadsheets.Values.batchGet(FLMRR_CFG.source,{ranges:ranges,valueRenderOption:'UNFORMATTED_VALUE'});
  if(!d.valueRanges||d.valueRanges.length!==2)throw Error('RIDER_SOURCE_INCOMPLETE');
  var x=FLMRPC.normalize(d.valueRanges[0].values||[],d.valueRanges[1].values||[],'RIDER',new Date().toISOString());
  if(x.audit.duplicateMasterIds||x.audit.offboardingConflictingDates)throw Error('RIDER_SOURCE_CONFLICTS');
  var previous=Number(p.getProperty('FLMPI_ROWS_RIDER')||0);if(previous&&x.records.length<previous*.9)throw Error('RIDER_SOURCE_SHRINK_GT_10_PERCENT');
  x.hash=FLMRR_hash_(JSON.stringify(x.records.map(function(o){var a=Object.assign({},o);delete a.ingested_at;return a;})));return x;
}
function FLMRR_existing_(m){FLMRR_metaCheck_(m,FLMRR_CFG.target,null);return {state:'TARGET_EXISTS_NO_WRITE',table:FLMRR_CFG.target,records:Number(m.numRows),note:'Bootstrap never refreshes/overwrites an existing table. Use normal sync after verification.'};}
function flmRiderRepairPreview(){return FLMRR_report_(FLMRR_locked_(function(p){
  if(p.getProperty(FLMRR_CFG.pending))return {state:'PENDING_USE_CONTINUE'};FLMRR_noLegacyPending_(p);FLMRR_dataset_();var m=FLMRR_target_();if(m)return FLMRR_existing_(m);
  var x=FLMRR_read_(p);p.setProperty(FLMRR_CFG.candidate,JSON.stringify({hash:x.hash,rows:x.records.length,at:Date.now()}));return {state:'READY_FOR_START',table:FLMRR_CFG.target,records:x.records.length,audit:x.audit,note:'Preview only; no BigQuery write.'};
}));}
function flmRiderRepairStart(){return FLMRR_report_(FLMRR_locked_(function(p){
  if(p.getProperty(FLMRR_CFG.pending))return {state:'PENDING_USE_CONTINUE'};FLMRR_noLegacyPending_(p);FLMRR_dataset_();var m=FLMRR_target_();if(m)return FLMRR_existing_(m);
  var c=JSON.parse(p.getProperty(FLMRR_CFG.candidate)||'null');if(!c||Date.now()-c.at>1800000)throw Error('RIDER_PREVIEW_REQUIRED_OR_EXPIRED');var x=FLMRR_read_(p);if(x.hash!==c.hash)throw Error('RIDER_SOURCE_CHANGED: rerun Preview after source export is complete');
  var suffix=Utilities.getUuid().replace(/-/g,'').toLowerCase();if(!/^[a-f0-9]{32}$/.test(suffix))throw Error('RIDER_UUID_INVALID');
  var r={version:1,phase:'LOAD',stage:'_flmrr_rider_'+suffix,loadId:'flmrr_load_'+suffix,rows:x.records.length,hash:x.hash,stamp:x.records[0].ingested_at,audit:x.audit};p.setProperty(FLMRR_CFG.pending,JSON.stringify(r));
  try{BigQuery.Jobs.insert({jobReference:FLMRR_jobRef_(r.loadId),configuration:{load:{destinationTable:FLMRR_ref_(r.stage),createDisposition:'CREATE_IF_NEEDED',writeDisposition:'WRITE_EMPTY',sourceFormat:'NEWLINE_DELIMITED_JSON',maxBadRecords:0,ignoreUnknownValues:false,schema:{fields:FLMRR_schema_()}}}},FLMRR_CFG.project,Utilities.newBlob(x.records.map(function(v){return JSON.stringify(v);}).join('\n'),'application/octet-stream'));}
  catch(e){throw Error('RIDER_SUBMISSION_UNCONFIRMED: inspect saved load job '+r.loadId+'; use Continue, never resubmit blindly');}
  return {state:'BQ_RUNNING',phase:r.phase,jobId:r.loadId,records:r.rows};
}));}
function FLMRR_job_(r){
  var id=r.phase==='LOAD'?r.loadId:r.copyId,j;
  try{j=BigQuery.Jobs.get(FLMRR_CFG.project,id,{location:FLMRR_CFG.location});}catch(e){if(FLMRR_missing_(e)||/\bNot found: Job\b/i.test(String(e.message||e)))throw Error('RIDER_JOB_UNCONFIRMED: '+id+'; no resubmission was attempted');throw e;}
  var ref=j.jobReference;if(!ref||ref.projectId!==FLMRR_CFG.project||ref.jobId!==id||String(ref.location||'').toLowerCase()!==FLMRR_CFG.location)throw Error('RIDER_JOB_REFERENCE_INVALID');
  var cfg=j.configuration&&(r.phase==='LOAD'?j.configuration.load:j.configuration.copy),dest=cfg&&cfg.destinationTable,want=r.phase==='LOAD'?r.stage:FLMRR_CFG.target;
  if(!dest||dest.projectId!==FLMRR_CFG.project||dest.datasetId!==FLMRR_CFG.dataset||dest.tableId!==want)throw Error('RIDER_JOB_DESTINATION_INVALID');
  if(cfg.writeDisposition!=='WRITE_EMPTY')throw Error('RIDER_JOB_WRITE_MODE_INVALID');
  if(r.phase==='COPY'){var src=cfg.sourceTable;if(!src||src.projectId!==FLMRR_CFG.project||src.datasetId!==FLMRR_CFG.dataset||src.tableId!==r.stage)throw Error('RIDER_COPY_SOURCE_INVALID');}
  if(!j.status||j.status.state!=='DONE')return null;
  if(j.status.errorResult)throw Error('RIDER_JOB_FAILED: '+id+'; reason='+String(j.status.errorResult.reason||'unknown')+'; inspect job in BQ; checkpoint retained');
  if(j.status.errors&&j.status.errors.length)throw Error('RIDER_JOB_WARNINGS_REQUIRE_REVIEW: '+id);
  return j;
}
function flmRiderRepairContinue(){return FLMRR_report_(FLMRR_locked_(function(p){
  FLMRR_noLegacyPending_(p);var r=JSON.parse(p.getProperty(FLMRR_CFG.pending)||'null');if(!r)return {state:'NO_PENDING_JOB',lastSuccess:JSON.parse(p.getProperty(FLMRR_CFG.success)||'null')};
  if(r.version!==1||['LOAD','COPY','VERIFY'].indexOf(r.phase)<0||!Number.isInteger(r.rows)||r.rows<1)throw Error('RIDER_CHECKPOINT_INVALID');FLMRR_ref_(r.stage);
  if(r.phase==='VERIFY')return FLMRR_finish_(r,p);
  var j=FLMRR_job_(r);if(!j)return {state:'BQ_RUNNING',phase:r.phase,jobId:r.phase==='LOAD'?r.loadId:r.copyId};
  if(r.phase==='LOAD'){
    if(!j.statistics||!j.statistics.load||Number(j.statistics.load.outputRows)!==r.rows||Number(j.statistics.load.badRecords||0)!==0)throw Error('RIDER_LOAD_COUNT_MISMATCH');
    FLMRR_metaCheck_(BigQuery.Tables.get(FLMRR_CFG.project,FLMRR_CFG.dataset,r.stage),r.stage,r.rows);
    if(FLMRR_target_())throw Error('RIDER_TARGET_APPEARED: stop; never overwrite or assume success');
    r.phase='COPY';r.copyId='flmrr_copy_'+Utilities.getUuid().replace(/-/g,'').toLowerCase();p.setProperty(FLMRR_CFG.pending,JSON.stringify(r));
    try{BigQuery.Jobs.insert({jobReference:FLMRR_jobRef_(r.copyId),configuration:{copy:{sourceTable:FLMRR_ref_(r.stage),destinationTable:FLMRR_ref_(FLMRR_CFG.target),createDisposition:'CREATE_IF_NEEDED',writeDisposition:'WRITE_EMPTY'}}},FLMRR_CFG.project);}
    catch(e){throw Error('RIDER_SUBMISSION_UNCONFIRMED: inspect saved copy job '+r.copyId+'; use Continue, never resubmit blindly');}
    return {state:'BQ_RUNNING',phase:r.phase,jobId:r.copyId,records:r.rows};
  }
  r.phase='VERIFY';p.setProperty(FLMRR_CFG.pending,JSON.stringify(r));return FLMRR_finish_(r,p);
}));}
function FLMRR_finish_(r,p){
  var m=BigQuery.Tables.get(FLMRR_CFG.project,FLMRR_CFG.dataset,FLMRR_CFG.target);FLMRR_metaCheck_(m,FLMRR_CFG.target,r.rows);
  var out={state:'SUCCESS',project:FLMRR_CFG.project,dataset:FLMRR_CFG.dataset,table:FLMRR_CFG.target,records:r.rows,sourceAsOf:r.stamp,verifiedAt:new Date().toISOString(),tableRevision:String(m.lastModifiedTime||''),loadJob:r.loadId,copyJob:r.copyId,stage:r.stage,audit:r.audit,note:'Source normalized, LOAD/COPY successful, target schema/count verified; app scope/PII visibility requires host acceptance.'};
  p.setProperty(FLMRR_CFG.success,JSON.stringify(out));p.deleteProperty(FLMRR_CFG.pending);p.deleteProperty(FLMRR_CFG.candidate);return out;
}
function flmRiderRepairStatus(){FLMRR_owner_();var p=PropertiesService.getScriptProperties();return FLMRR_report_({pending:JSON.parse(p.getProperty(FLMRR_CFG.pending)||'null'),lastSuccess:JSON.parse(p.getProperty(FLMRR_CFG.success)||'null'),legacyPending:!!p.getProperty('FLMPI_PENDING_RIDER')});}
