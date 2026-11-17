// One record per authorized visit. Google Sheets Date cells are normalized before comparison.
var WEB_VISITS_CFG_={timezone:'Asia/Ho_Chi_Minh',prefix:'WebVisits_',columns:['Day','Session ID','Email','Role','Opened at','Left at','Page Stats','Duration']};
function webVisitsDay_(date){return Utilities.formatDate(new Date(date),WEB_VISITS_CFG_.timezone,'yyyy-MM-dd')}
function webVisitsCellDay_(value){if(Object.prototype.toString.call(value)==='[object Date]')return isFinite(+value)?webVisitsDay_(value):'';var text=String(value||'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:isFinite(+new Date(text))?webVisitsDay_(new Date(text)):''}
function webVisitsStamp_(value){if(!value)return '';var date=new Date(value);return isFinite(+date)?date.toISOString():''}
function webVisitsDate_(value){var day=String(value||webVisitsDay_(new Date()));if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!isFinite(+new Date(day+'T12:00:00+07:00'))||webVisitsDay_(new Date(day+'T12:00:00+07:00'))!==day)throw Error('INVALID_VISIT_DATE');return day}
function webVisitsSheet_(day,create){
  var db=getDb_(),name=WEB_VISITS_CFG_.prefix+day.slice(0,7).replace('-','_'),sh=db.getSheetByName(name);
  if(!sh&&create){
    sh=db.insertSheet(name);
    sh.getRange(1,1,1,WEB_VISITS_CFG_.columns.length).setValues([WEB_VISITS_CFG_.columns]);
    sh.setFrozenRows(1);
  }else if(sh&&create&&sh.getLastColumn()<8){
    try{
      if(sh.getLastColumn()===6){
        sh.getRange(1,7,1,2).setValues([['Page Stats','Duration']]);
      }
    }catch(_){}
  }
  return sh;
}
function webVisitsSchema_(sh){
  var lastCol=Math.max(8,sh.getLastColumn());
  var header=sh.getRange(1,1,1,Math.max(9,lastCol)).getValues()[0];
  var isLegacy=String(header[5])==='Last active at';
  return {legacy:isLegacy,width:Math.max(lastCol,isLegacy?9:8)};
}
function webVisitsRecords_(sh){
  if(!sh||sh.getLastRow()<2)return [];
  var schema=webVisitsSchema_(sh);
  return sh.getRange(2,1,sh.getLastRow()-1,schema.width).getValues().map(function(r,i){
    var opened=webVisitsStamp_(r[4]);
    var left=webVisitsStamp_(r[schema.legacy?6:5]);
    var statsRaw=r[schema.legacy?7:6];
    var durVal=Number(r[schema.legacy?8:7])||0;
    if(!durVal&&opened&&left){
      var t1=new Date(opened).getTime(),t2=new Date(left).getTime();
      if(t2>t1)durVal=Math.floor((t2-t1)/1000);
    }
    return {
      row:i+2,
      day:webVisitsCellDay_(r[0]),
      sessionId:String(r[1]),
      email:String(r[2]),
      role:String(r[3]),
      openedAt:opened,
      leftAt:left,
      pageStats:typeof statsRaw==='string'?statsRaw:(statsRaw?JSON.stringify(statsRaw):''),
      duration:durVal
    };
  });
}
function trackWebVisit(payload){
 var access=requireAccess_(),p=payload||{},id=String(p.sessionId||'');if(!/^[a-zA-Z0-9-]{16,80}$/.test(id))throw Error('INVALID_VISIT_SESSION');
 var now=new Date(),today=webVisitsDay_(now),day=p.day?webVisitsDate_(p.day):today,leave=p.event==='leave',lock=LockService.getScriptLock();
 if(!leave)day=today;if(!lock.tryLock(1500))return {tracked:false};
 try{
  var sh=webVisitsSheet_(day,!leave);
  if(!sh)return {tracked:false,day:day};
  var records=webVisitsRecords_(sh),matches=records.filter(function(r){return r.day===day&&r.sessionId===id});
  if(matches.some(function(r){return r.email!==access.email}))throw Error('VISIT_SESSION_OWNER_MISMATCH');
  var pageStatsStr=p.pages?(typeof p.pages==='string'?p.pages:JSON.stringify(p.pages)):'';
  var durSec=Number(p.duration)||0;
  var schema=webVisitsSchema_(sh);
  var colLeft=schema.legacy?7:6,colStats=schema.legacy?8:7,colDur=schema.legacy?9:8;

  if(!matches.length){
   if(leave)return {tracked:false,day:day};
   var stamp=now.toISOString();
   sh.appendRow(schema.legacy?[day,id,access.email,access.rank,stamp,'','',pageStatsStr,durSec]:[day,id,access.email,access.rank,stamp,'',pageStatsStr,durSec]);
  }else{
   var stamp=leave?now.toISOString():'';
   matches.forEach(function(r){
     if(leave&&!r.leftAt){
       sh.getRange(r.row,colLeft,1,1).setValue(stamp);
     }
     var sessionStart=r.openedAt?new Date(r.openedAt).getTime():0;
     var computedDur=(leave&&sessionStart)?Math.max(durSec,Math.floor((now.getTime()-sessionStart)/1000)):durSec;
     if(pageStatsStr){
       sh.getRange(r.row,colStats,1,1).setValue(pageStatsStr);
     }
     if(computedDur>0){
       sh.getRange(r.row,colDur,1,1).setValue(computedDur);
     }
   });
  }
  return {tracked:true,day:day};
 }finally{lock.releaseLock()}
}
function webVisitsFormatDuration_(seconds){
  if(!seconds||seconds<=0)return '—';
  var s=Math.round(seconds);
  var m=Math.floor(s/60);
  s=s%60;
  if(m<1)return s+'s';
  var h=Math.floor(m/60);
  m=m%60;
  if(h<1)return m+'m '+(s>0?s+'s':'');
  return h+'h '+(m>0?m+'m':'');
}
function webVisitsRows_(days){
  var months={},rows=[],sessions={};
  days.forEach(function(day){months[day.slice(0,7)]=day});
  Object.keys(months).forEach(function(month){rows=rows.concat(webVisitsRecords_(webVisitsSheet_(months[month],false)))});
  rows.forEach(function(r){
    if(days.indexOf(r.day)===-1||!r.email||!r.sessionId)return;
    var key=r.day+'|'+r.sessionId+'|'+r.email,existing=sessions[key];
    if(!existing){sessions[key]=r;return}
    if(r.openedAt&&(!existing.openedAt||r.openedAt<existing.openedAt))existing.openedAt=r.openedAt;
    if(r.leftAt&&(!existing.leftAt||r.leftAt>existing.leftAt))existing.leftAt=r.leftAt;
    if(r.duration&&r.duration>(existing.duration||0))existing.duration=r.duration;
    if(r.pageStats&&(!existing.pageStats||r.pageStats.length>existing.pageStats.length))existing.pageStats=r.pageStats;
  });
  return Object.keys(sessions).map(function(key){return sessions[key]});
}
function webVisitsSummary_(rows){
  var people={},departures=0,totalDur=0,validDurCount=0;
  var hours=Array.from({length:24},function(_,i){return {hour:i,visits:0}});
  var pageAgg={};

  rows.forEach(function(r){
    people[r.email]=true;
    if(r.leftAt)departures++;
    if(r.openedAt)hours[Number(Utilities.formatDate(new Date(r.openedAt),WEB_VISITS_CFG_.timezone,'HH'))].visits++;
    if(r.duration&&r.duration>0){
      totalDur+=r.duration;
      validDurCount++;
    }
    var pStats=null;
    if(r.pageStats){
      try{pStats=JSON.parse(r.pageStats)}catch(_){}
    }
    if(pStats&&typeof pStats==='object'){
      Object.keys(pStats).forEach(function(pk){
        var item=pStats[pk];
        if(!item)return;
        var views=Number(item.views)||0;
        var dur=Number(item.duration)||0;
        if(!pageAgg[pk])pageAgg[pk]={key:pk,views:0,duration:0,sessions:0};
        pageAgg[pk].views+=views;
        pageAgg[pk].duration+=dur;
        pageAgg[pk].sessions+=1;
      });
    }
  });

  var totalPageViews=0;
  var topPages=Object.keys(pageAgg).map(function(pk){
    var item=pageAgg[pk];
    totalPageViews+=item.views;
    var avgDur=item.views>0?Math.round(item.duration/item.views):0;
    return {
      key:pk,
      views:item.views,
      duration:item.duration,
      durationFormatted:webVisitsFormatDuration_(item.duration),
      avgDuration:avgDur,
      avgDurationFormatted:webVisitsFormatDuration_(avgDur),
      sessions:item.sessions
    };
  });

  topPages.forEach(function(p){
    p.pct=totalPageViews>0?Math.round(p.views/totalPageViews*1000)/10:0;
  });
  topPages.sort(function(a,b){return b.views-a.views||b.duration-a.duration});

  var avgSessionDur=validDurCount>0?Math.round(totalDur/validDurCount):0;

  return {
    visits:rows.length,
    users:Object.keys(people).length,
    departures:departures,
    unrecorded:rows.length-departures,
    hours:hours,
    totalDuration:totalDur,
    avgSessionDuration:avgSessionDur,
    avgSessionDurationFormatted:webVisitsFormatDuration_(avgSessionDur),
    totalPageViews:totalPageViews,
    topPages:topPages
  };
}
function getWebVisitReport(date,query,page){
 requireAdmin_();
 var day=webVisitsDate_(date),now=new Date(),days=[];
 for(var i=6;i>=0;i--)days.push(webVisitsDay_(new Date(new Date(day+'T12:00:00+07:00').getTime()-i*86400000)));
 var all=webVisitsRows_(days),rows=all.filter(function(r){return r.day===day}),summary=webVisitsSummary_(rows);
 var search=String(query||'').toLowerCase().trim().slice(0,100);
 var filtered=rows.filter(function(r){
   return !search||(r.email+' '+r.role+' '+(r.pageStats||'')).toLowerCase().indexOf(search)!==-1
 }).sort(function(a,b){return b.openedAt.localeCompare(a.openedAt)});
 var size=25;
 page=Math.max(1,Math.min(Math.ceil(filtered.length/size)||1,Math.floor(Number(page)||1)));
 return {
   day:day,
   today:webVisitsDay_(now),
   timezone:WEB_VISITS_CFG_.timezone,
   summary:summary,
   trend:days.map(function(d){
     var s=webVisitsSummary_(all.filter(function(r){return r.day===d}));
     return {day:d,visits:s.visits,users:s.users,avgSessionDuration:s.avgSessionDuration,avgSessionDurationFormatted:s.avgSessionDurationFormatted};
   }),
   total:filtered.length,
   page:page,
   pageSize:size,
   rows:filtered.slice((page-1)*size,page*size).map(function(r){
     var topP='';
     if(r.pageStats){
       try{
         var ps=JSON.parse(r.pageStats),maxV=0;
         Object.keys(ps).forEach(function(k){
           if((ps[k].views||0)>maxV){maxV=ps[k].views;topP=k}
         });
       }catch(_){}
     }
     return {
       email:r.email,
       role:r.role,
       openedAt:r.openedAt,
       leftAt:r.leftAt,
       duration:r.duration,
       durationFormatted:webVisitsFormatDuration_(r.duration),
       topPage:topP,
       pageStats:r.pageStats,
       status:r.leftAt?'left':'unrecorded'
     };
   }),
   generatedAt:now.toISOString()
 };
}
