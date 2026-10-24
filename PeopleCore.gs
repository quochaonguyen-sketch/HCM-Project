/** Pure normalization core. No services; safe to test locally. */
var FLMPC = (function(){
  function norm(v){return String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').replace(/\s+/g,' ').trim().toLowerCase();}
  function date(v){
    if(v==null||String(v).trim()==='')return {value:null};
    var s;if(v instanceof Date){if(isNaN(v.getTime()))return {invalid:true};s=typeof Utilities!=='undefined'?Utilities.formatDate(v,'Asia/Ho_Chi_Minh','yyyy-MM-dd'):v.toISOString().slice(0,10);}
    else if(typeof v==='number'&&isFinite(v))s=new Date(Math.round((Math.floor(v)-25569)*86400000)).toISOString().slice(0,10);
    else {s=String(v).trim();var m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(m)s=m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2);}
    return /^\d{4}-\d{2}-\d{2}$/.test(s)&&isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s?{value:s}:{invalid:true};
  }
  function id(v){var s=String(v==null?'':v).trim();return s&&!s.startsWith('#')?s:'';}
  function header(data,required){
    var matches=[];data.slice(0,10).forEach(function(r,i){var h=r.map(norm),ix={};if(required.every(function(k){var n=norm(k);if(h.indexOf(n)<0||h.indexOf(n)!==h.lastIndexOf(n))return false;ix[k]=h.indexOf(n);return true;}))matches.push({row:i,ix:ix});});
    if(matches.length!==1)throw Error('Header missing/ambiguous: '+required.join(', '));return matches[0];
  }
  function normalize(master,off,module,stamp){
    if(['RIDER','FTE'].indexOf(module)<0)throw Error('INVALID_MODULE');
    var mh=header(master,['Staff ID/ Rider ID','Họ tên','Ngày nhận việc','Nơi làm việc','Ngày nghỉ việc','Vị trí']);
    var oh=header(off,module==='RIDER'?['Rider ID','Ngày làm việc cuối cùng']:['Mã của nhân viên nghỉ việc (Staff ID/ Rider ID)','Ngày làm việc cuối cùng']);
    var oi=oh.ix[module==='RIDER'?'Rider ID':'Mã của nhân viên nghỉ việc (Staff ID/ Rider ID)'];
    var audit={module:module,masterRows:0,selectedRows:0,ignoredOtherPositions:0,missingMasterId:0,duplicateMasterIds:0,offboardingIds:0,offboardingBlankIds:0,offboardingOrphanIds:0,offboardingInvalidDates:0,offboardingConflictingDates:0,unknownRecords:0,dateDisagreements:0,missingStation:0,missingName:0},om={},mm={},invalidMaster={};
    off.slice(oh.row+1).forEach(function(r){if(r.every(function(v){return v===''||v==null;}))return;var k=id(r[oi]);if(!k){audit.offboardingBlankIds++;return;}if(!om[k])om[k]={dates:{},invalid:false};var d=date(r[oh.ix['Ngày làm việc cuối cùng']]);if(d.invalid){om[k].invalid=true;audit.offboardingInvalidDates++;}else if(d.value)om[k].dates[d.value]=true;});
    audit.offboardingIds=Object.keys(om).length;
    master.slice(mh.row+1).forEach(function(r){if(r.every(function(v){return v===''||v==null;}))return;audit.masterRows++;var k=id(r[mh.ix['Staff ID/ Rider ID']]);if(!k){audit.missingMasterId++;return;}var o={id:k,name:String(r[mh.ix['Họ tên']]||'').trim(),station:String(r[mh.ix['Nơi làm việc']]||'').replace(/\s+/g,' ').trim(),position:String(r[mh.ix['Vị trí']]||'').trim(),join:date(r[mh.ix['Ngày nhận việc']]),exit:date(r[mh.ix['Ngày nghỉ việc']])};if(mm[k]&&JSON.stringify(mm[k])!==JSON.stringify(o)){invalidMaster[k]=true;audit.duplicateMasterIds++;}else mm[k]=o;});
    audit.offboardingOrphanIds=Object.keys(om).filter(function(k){return !mm[k];}).length;
    var records=[];Object.keys(mm).sort().forEach(function(k){var o=mm[k],pos=norm(o.position);if(module==='FTE'?pos!=='3. staff':!/^4\. rider(?:\s|$)/.test(pos)){audit.ignoredOtherPositions++;return;}audit.selectedRows++;
      var issues=[],ob=om[k],ds=ob?Object.keys(ob.dates).sort():[],exit=null;
      if(invalidMaster[k])issues.push('MASTER_ID_CONFLICT');
      if(o.join.invalid||!o.join.value)issues.push('JOIN_DATE_INVALID_OR_MISSING');
      if(!o.station){issues.push('STATION_MISSING');audit.missingStation++;}if(!o.name){issues.push('NAME_MISSING');audit.missingName++;}
      if(ds.length>1){issues.push('EXIT_DATE_CONFLICT');audit.offboardingConflictingDates++;}
      else if(ds.length===1){exit=ds[0];if(o.exit.value&&o.exit.value!==exit)audit.dateDisagreements++;}
      else if(ob&&ob.invalid)issues.push('OFFBOARDING_DATE_INVALID');
      else if(o.exit.invalid)issues.push('MASTER_EXIT_DATE_INVALID');else exit=o.exit.value;
      if(exit&&o.join.value&&exit<o.join.value)issues.push('EXIT_BEFORE_JOIN');
      var valid=!issues.length;if(!valid)audit.unknownRecords++;
      records.push({module:module,employee_id:k,employee_name:o.name,station:o.station,position:o.position,join_date:o.join.value||null,last_work_date:exit,quality:valid?'VALID':'UNKNOWN',issues:issues.join('|'),ingested_at:stamp});
    });
    if(!records.length)throw Error('EMPTY_SELECTED_SOURCE: keep existing target');return {records:records,audit:audit};
  }
  function state(r,day){if(r.quality!=='VALID')return 'UNKNOWN';if(r.join_date>day)return 'NOT_JOINED';return r.last_work_date&&r.last_work_date<day?'EXITED':'ACTIVE';}
  return {normalize:normalize,date:date,norm:norm,state:state};
})();
