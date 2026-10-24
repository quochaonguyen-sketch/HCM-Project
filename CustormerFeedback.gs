/** Feedback is private to its signed-in author and ADMIN. No anonymous RPC. */
const CUSTOMER_FEEDBACK_CFG=Object.freeze({sheet:'Customer Feedback',headers:['ID','REQUEST_ID','CREATED_AT','EMAIL','NAME','ROLE','CATEGORY','RATING','SUBJECT','MESSAGE','PAGE','STATUS','ADMIN_REPLY','UPDATED_AT','UPDATED_BY','VERSION'],categories:['BUG','DATA','FEATURE','OTHER'],statuses:['NEW','IN_PROGRESS','RESOLVED'],pageSize:20});
function customerFeedbackText_(value,min,max,label){
  const text=String(value==null?'':value).replace(/\r\n?/g,'\n').replace(/\u0000/g,'').trim();
  if(text.length<min||text.length>max)throw Error(label+': cần từ '+min+' đến '+max+' ký tự.');return text;
}
function customerFeedbackCell_(value){const s=String(value==null?'':value);return /^[=+@'\-\u200b]/.test(s)?'\u200b'+s:s}
function customerFeedbackUncell_(value){const s=String(value==null?'':value);return s.charAt(0)==='\u200b'?s.slice(1):s}
function customerFeedbackSheet_(create){
  const db=getDb_(),cfg=CUSTOMER_FEEDBACK_CFG;let sheet=db.getSheetByName(cfg.sheet);
  if(!sheet&&create){sheet=db.insertSheet(cfg.sheet);sheet.getRange(1,1,1,cfg.headers.length).setValues([cfg.headers]);sheet.setFrozenRows(1)}
  if(sheet){const headers=sheet.getRange(1,1,1,cfg.headers.length).getValues()[0];if(cfg.headers.some((h,i)=>headers[i]!==h))throw Error('FEEDBACK_SCHEMA_MISMATCH: kiểm tra header sheet Customer Feedback.')}return sheet;
}
function customerFeedbackRows_(sheet){
  if(!sheet||sheet.getLastRow()<2)return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,CUSTOMER_FEEDBACK_CFG.headers.length).getValues().map((r,i)=>({row:i+2,id:String(r[0]||''),requestId:customerFeedbackUncell_(r[1]),createdAt:customerFeedbackStamp_(r[2]),email:customerFeedbackUncell_(r[3]),name:customerFeedbackUncell_(r[4]),role:String(r[5]),category:String(r[6]),rating:r[7]===''||r[7]==null?null:Number(r[7]),subject:customerFeedbackUncell_(r[8]),message:customerFeedbackUncell_(r[9]),page:customerFeedbackUncell_(r[10]),status:String(r[11]),reply:customerFeedbackUncell_(r[12]),updatedAt:customerFeedbackStamp_(r[13]),updatedBy:String(r[14]||''),version:Number(r[15])||1})).filter(r=>r.id);
}
function customerFeedbackStamp_(v){if(!v)return '';const date=new Date(v);return isFinite(+date)?date.toISOString():''}
function customerFeedbackPublic_(r,admin){const out={id:r.id,createdAt:r.createdAt,category:r.category,rating:r.rating,subject:r.subject,message:r.message,page:r.page,status:r.status,reply:r.reply,updatedAt:r.updatedAt,version:r.version};if(admin){out.email=r.email;out.name=r.name;out.role=r.role;out.updatedBy=r.updatedBy}return out}
function submitCustomerFeedback(payload){
  const access=requireAccess_(),p=payload||{},cfg=CUSTOMER_FEEDBACK_CFG;
  const requestId=String(p.requestId||'');if(!/^[a-zA-Z0-9-]{16,80}$/.test(requestId))throw Error('FEEDBACK_REQUEST_ID_INVALID');
  const category=String(p.category||'OTHER');if(cfg.categories.indexOf(category)<0)throw Error('FEEDBACK_CATEGORY_INVALID');
  const subject=customerFeedbackText_(p.subject,3,120,'Tiêu đề'),message=customerFeedbackText_(p.message,10,4000,'Nội dung'),page=customerFeedbackText_(p.page||'',0,80,'Trang liên quan');
  const rating=p.rating==null||p.rating===''?null:Number(p.rating);if(rating!==null&&(!Number.isInteger(rating)||rating<1||rating>5))throw Error('FEEDBACK_RATING_INVALID');
  const lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw Error('Feedback đang bận, vui lòng thử lại.');
  try{
    const sheet=customerFeedbackSheet_(true),rows=customerFeedbackRows_(sheet),existing=rows.find(r=>r.requestId===requestId);
    if(existing){if(existing.email!==access.email||existing.subject!==subject||existing.message!==message||existing.category!==category||existing.rating!==rating||existing.page!==page)throw Error('FEEDBACK_REQUEST_CONFLICT');return {ok:true,duplicate:true,feedback:customerFeedbackPublic_(existing,false)}}
    const stamp=new Date().toISOString(),id='FB-'+Utilities.getUuid(),record={id,requestId,createdAt:stamp,email:access.email,name:access.displayName||'',role:access.rank,category,rating,subject,message,page,status:'NEW',reply:'',updatedAt:stamp,updatedBy:'',version:1};
    const values=[id,requestId,stamp,access.email,record.name,access.rank,category,rating==null?'':rating,subject,message,page,'NEW','',stamp,'',1];
    sheet.getRange(sheet.getLastRow()+1,1,1,cfg.headers.length).setValues([values.map(v=>typeof v==='string'?customerFeedbackCell_(v):v)]);
    return {ok:true,duplicate:false,feedback:customerFeedbackPublic_(record,false)};
  }finally{lock.releaseLock()}
}
function getCustomerFeedback(options){
  const access=requireAccess_(),p=options||{},admin=p.admin===true;
  if(admin)requireAdmin_();
  const status=String(p.status||''),category=String(p.category||'');
  if(status&&CUSTOMER_FEEDBACK_CFG.statuses.indexOf(status)<0)throw Error('FEEDBACK_STATUS_INVALID');
  if(category&&CUSTOMER_FEEDBACK_CFG.categories.indexOf(category)<0)throw Error('FEEDBACK_CATEGORY_INVALID');
  const all=customerFeedbackRows_(customerFeedbackSheet_(false)).filter(r=>admin||r.email===access.email),query=String(p.query||'').trim().toLowerCase().slice(0,120);
  const summary={NEW:0,IN_PROGRESS:0,RESOLVED:0};all.forEach(r=>{if(Object.prototype.hasOwnProperty.call(summary,r.status))summary[r.status]++});
  const filtered=all.filter(r=>(!status||r.status===status)&&(!category||r.category===category)&&(!query||[r.id,r.subject,r.message,admin?r.email:''].join(' ').toLowerCase().indexOf(query)>=0)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  const pages=Math.max(1,Math.ceil(filtered.length/CUSTOMER_FEEDBACK_CFG.pageSize)),page=Math.max(1,Math.min(pages,Math.floor(Number(p.page)||1)));
  return {admin:admin,summary:summary,total:filtered.length,page:page,pages:pages,rows:filtered.slice((page-1)*CUSTOMER_FEEDBACK_CFG.pageSize,page*CUSTOMER_FEEDBACK_CFG.pageSize).map(r=>customerFeedbackPublic_(r,admin))};
}
function getCustomerFeedbackDetail(id){
  const access=requireAccess_(),row=customerFeedbackRows_(customerFeedbackSheet_(false)).find(r=>r.id===String(id));
  if(!row||(access.rank!=='ADMIN'&&row.email!==access.email))throw Error('FEEDBACK_NOT_FOUND_OR_DENIED');
  return customerFeedbackPublic_(row,access.rank==='ADMIN');
}
function updateCustomerFeedback(payload){
  const admin=requireAdmin_(),p=payload||{},status=String(p.status||''),reply=customerFeedbackText_(p.reply||'',0,4000,'Phản hồi Admin');
  if(CUSTOMER_FEEDBACK_CFG.statuses.indexOf(status)<0)throw Error('FEEDBACK_STATUS_INVALID');
  const lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw Error('Feedback đang bận, vui lòng thử lại.');
  try{
    const sheet=customerFeedbackSheet_(false),row=customerFeedbackRows_(sheet).find(r=>r.id===String(p.id));if(!row)throw Error('FEEDBACK_NOT_FOUND');
    if(row.status===status&&row.reply===reply)return {ok:true,feedback:customerFeedbackPublic_(row,true)};
    if(!Number.isInteger(p.version)||row.version!==p.version)throw Error('Feedback đã được người khác cập nhật. Hãy tải lại trước khi lưu.');
    const stamp=new Date().toISOString();sheet.getRange(row.row,12,1,5).setValues([[status,customerFeedbackCell_(reply),stamp,admin.email,row.version+1]]);
    return {ok:true,feedback:customerFeedbackPublic_(Object.assign(row,{status,reply,updatedAt:stamp,updatedBy:admin.email,version:row.version+1}),true)};
  }finally{lock.releaseLock()}
}
