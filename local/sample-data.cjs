// Deterministic local-only additions. Original XLSX files are never changed.
const fs=require('node:fs');
const path=require('node:path');
function seed(text){let h=2166136261;for(const c of String(text))h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0)/4294967295;}
function day(value){return value instanceof Date?new Date(+value+7*3600000).toISOString().slice(0,10):String(value||'').slice(0,10);}
function prepareData(data){
  const front=data.frontend.sheets,back=data.backend.sheets;
  const ledger=[];
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const anchor=/^\d{4}-\d{2}-\d{2}$/.test(today)?today:new Date().toISOString().slice(0,10);
  const month=anchor.slice(0,7),yesterday=new Date(Date.parse(anchor)-86400000).toISOString().slice(0,10);
  const permissions=front.Permission.slice(1).filter(r=>r[0]&&r[1]);
  front['Adhoc user'].push(['admin@example.test','Local Tester','ADMIN','CITY','HCM_CITY',true,'LOCAL_ONLY','Synthetic local administrator','','']);
  const metrics=['%FM Ontime','%LM Ontime','%Deli Success','%Sorter Productivity','%Rider Productivity','%Correct SOP - PU'];
  function value(hub,date,i){return Math.round((i===3||i===4?0.8+seed(hub+date+i)*0.35:0.92+seed(hub+date+i)*0.079)*100000)/100000;}
  function fill(name){
    const rows=front[name],header=rows[0],hi=header.indexOf('Station Name'),di=header.indexOf(name==='KPI Daily'?'KPI Date':'KPI Month');
    rows.slice(1).forEach((row,ri)=>metrics.forEach((metric,i)=>{
      const ci=header.indexOf(metric);if(ci>=0&&(row[ci]===''||row[ci]==null)){
        row[ci]=value(row[hi],day(row[di]),i);ledger.push({sheet:name,row:ri+2,column:metric,kind:'mock_missing_cell'});
      }
    }));
    return {rows,header,hi,di};
  }
  const daily=fill('KPI Daily'),monthly=fill('KPI Result');
  const dailyKeys=new Set(daily.rows.slice(1).map(r=>day(r[daily.di])+'|'+r[daily.hi]));
  // Complete the current sample month to D-1 so filtering and day drilldown work.
  for(let date=month+'-01';date<=yesterday&&date.slice(0,7)===month;date=new Date(Date.parse(date)+86400000).toISOString().slice(0,10)){
    for(const hub of permissions){
      if(dailyKeys.has(date+'|'+hub[1]))continue;
      const row=Array(daily.header.length).fill('');row[daily.hi]=hub[1];row[daily.di]=date;
      row[daily.header.indexOf('Month')]=month;row[daily.header.indexOf('Hub Type')]='AMH';row[daily.header.indexOf('Region')]='HCM';
      metrics.forEach((metric,i)=>row[daily.header.indexOf(metric)]=value(hub[0],date,i));daily.rows.push(row);
      ledger.push({sheet:'KPI Daily',row:daily.rows.length,kind:'mock_missing_hub_day',hubCode:hub[0],date});
    }
  }
  const monthKeys=new Set(monthly.rows.slice(1).map(r=>day(r[monthly.di]).slice(0,7)+'|'+r[monthly.hi]));
  permissions.forEach(hub=>{
    if(monthKeys.has(month+'|'+hub[1]))return;
    const row=Array(monthly.header.length).fill('');row[monthly.di]=month+'-01';row[monthly.hi]=hub[1];
    row[monthly.header.indexOf('Hub Type')]='AMH';row[monthly.header.indexOf('Region')]='HCM';
    metrics.forEach((metric,i)=>row[monthly.header.indexOf(metric)]=value(hub[0],month,i));
    for(const field of ['FM Days','LM Days','DSR Days','Sorter Days','Rider Days','SOP Days'])row[monthly.header.indexOf(field)]=+yesterday.slice(-2);
    row[monthly.header.indexOf('Expected Days')]=new Date(+month.slice(0,4),+month.slice(5,7),0).getDate();
    row[monthly.header.indexOf('As Of')]=yesterday;row[monthly.header.indexOf('Method')]='LOCAL_MOCK';row[monthly.header.indexOf('Status')]='LOCAL_MOCK';
    monthly.rows.push(row);ledger.push({sheet:'KPI Result',row:monthly.rows.length,kind:'mock_missing_hub_month',hubCode:hub[0],month});
  });
  // Keep valid historical Grade/Final Point values. Fill absent ones only.
  for(const model of [monthly])for(let r=1;r<model.rows.length;r++){
    const row=model.rows[r],ci=model.header.indexOf('Final Point'),gi=model.header.indexOf('Grade');
    if(row[ci]===''||row[ci]==null){const weights=[.2,.2,.15,.2,.15,.1];const point=metrics.reduce((sum,k,i)=>sum+Number(row[model.header.indexOf(k)])*weights[i],0);row[ci]=point;ledger.push({sheet:'KPI Result',row:r+1,column:'Final Point',kind:'mock_missing_cell'});}
    if(row[gi]===''||row[gi]==null){row[gi]=Number(row[ci])>=1?'A':Number(row[ci])>=.95?'B':'C';ledger.push({sheet:'KPI Result',row:r+1,column:'Grade',kind:'mock_missing_cell'});}
  }
  for(const field of ['Grade','Final Point'])if(!daily.header.includes(field))daily.header.push(field);
  daily.rows[0]=daily.header;
  daily.rows.slice(1).forEach((row,i)=>{
    const ci=daily.header.indexOf('Final Point'),gi=daily.header.indexOf('Grade');
    if(row[ci]==null||row[ci]===''){
      const weights=[.2,.2,.15,.2,.15,.1];
      row[ci]=metrics.reduce((sum,k,j)=>sum+Number(row[daily.header.indexOf(k)])*weights[j],0);
      row[gi]=row[ci]>=1?'A':row[ci]>=.95?'B':'C';
      ledger.push({sheet:'KPI Daily',row:i+2,column:'Grade/Final Point',kind:'mock_missing_cell'});
    }
  });
  // Fill HUBs absent from a D0 table using its own schema and synthetic values.
  const key=v=>String(v||'').trim().toLowerCase().replace(/(?:\s+hub)+$/i,'').replace(/\s+/g,' ');
  const idByName={};
  for(const table of Object.values(back)){
    const header=table[0]||[],ni=header.indexOf('station_name'),si=header.indexOf('station_id');
    if(ni>=0&&si>=0)for(const row of table.slice(1))idByName[key(row[ni])]=row[si];
  }
  for(const name of ['Roster D0','Roster Shifts D0','Backlog D0','LM Backlog D0','LM Order Volume D0','FM Order Volume D0','FM Pending Pickup Backlog D0','Delivery Progress D0']){
    const table=back[name],header=table[0],ni=header.indexOf('station_name'),si=header.indexOf('station_id');
    const found=new Set(table.slice(1).map(row=>key(row[ni])));
    for(const hub of permissions){if(found.has(key(hub[1])))continue;
      const row=table[1].map((v,i)=>typeof v==='number'&&!/station_id|date|timestamp|driver_id/.test(header[i])?Math.max(0,Math.round(v*(.7+seed(hub[0]+name)*.6))):v);
      row[ni]=hub[1];row[si]=idByName[key(hub[1])]||'mock-'+hub[0];
      function set(field,v){const ci=header.indexOf(field);if(ci>=0)row[ci]=v;}
      function get(field){return Number(row[header.indexOf(field)])||0;}
      if(name==='Roster D0'||name==='Roster Shifts D0'){
        const shift=name==='Roster Shifts D0',actual=shift?get('actual_fte')+get('actual_bpo')+get('actual_os'):get('fte_count')+get('bpo_count')+get('os_count');
        set(shift?'actual_people':'present_count',actual);
        const planned=Math.max(actual,get(shift?'planned_people':'scheduled_count'));
        set(shift?'planned_people':'scheduled_count',planned);
        set('attendance_pct',planned?actual/planned*100:0);
        set('male_count',Math.floor(actual*.6));set('female_count',actual-Math.floor(actual*.6));set('unknown_gender_count',0);
      }
      if(header.includes('driver_name')){row[header.indexOf('driver_name')]='MOCK Rider';row[header.indexOf('driver_id')]='mock-'+hub[0];}
      table.push(row);ledger.push({sheet:name,row:table.length,kind:'mock_missing_hub_row',hubCode:hub[0]});
    }
  }
  back['BigQuery Attendance']=[['station_id','station_name','date','person_key','first_clock_in','is_late']];
  permissions.forEach(hub=>{for(let i=0;i<8;i++)back['BigQuery Attendance'].push([idByName[key(hub[1])]||'mock-'+hub[0],hub[1],anchor,'mock-attendance-'+hub[0]+'-'+i,anchor+'T'+String(5+i).padStart(2,'0')+':00:00+07:00',i%4===0]);});
  ledger.push({sheet:'BigQuery Attendance',kind:'mock_missing_source',rows:back['BigQuery Attendance'].length-1});
  // Backend DTC contains historical snapshots; D0 contains the current snapshot.
  const dtcKeys=new Set(back.DTC.slice(1).map(r=>r[0]+'|'+r[1]));
  for(const row of back.D0.slice(1))if(!dtcKeys.has(row[0]+'|'+row[1]))back.DTC.push(row.slice());
  // Complete current DTC and FC coverage for HUBs absent from the supplied data.
  for(const [book,name] of [[back,'D0'],[back,'DTC'],[front,'DTC D0']]){
    const table=book[name],header=table[0],ni=header.indexOf('station_name'),di=header.indexOf('report_date');
    const present=new Set(table.slice(1).filter(row=>day(row[di])===anchor).map(row=>key(row[ni])));
    for(const hub of permissions){if(present.has(key(hub[1])))continue;
      const row=Array(header.length).fill(''),capacity=Math.round(1500+seed(hub[0])*3000),backlog=Math.round(capacity*(.2+seed(hub[0]+'dtc')*1.1));
      const fields={report_date:anchor,station_id:idByName[key(hub[1])]||'mock-'+hub[0],station_name:hub[1],region:'HCM',province:'TP. Hồ Chí Minh',backlog_eod:backlog,delivered_14d_total:capacity*14,delivered_14d_avg:capacity,dtc_days:backlog/capacity,dtc_band:backlog/capacity>1?'RED':backlog/capacity>=.5?'YELLOW':'GREEN',status:'OK',valid_days:14,expected_days:14,window_mode:'LOCAL_MOCK',window_start:new Date(Date.parse(anchor)-14*86400000).toISOString().slice(0,10),window_end:yesterday,backlog_fetched_at:yesterday+'T23:25:00+07:00',computed_at:anchor+'T09:00:00+07:00'};
      header.forEach((h,i)=>{if(Object.hasOwn(fields,h))row[i]=fields[h];});table.push(row);
      ledger.push({sheet:name,row:table.length,kind:'mock_missing_dtc_hub',hubCode:hub[0]});
    }
  }
  const fc=back.FC,fcNames=new Set(fc.slice(2).map(row=>key(row[0])));
  for(const hub of permissions)if(!fcNames.has(key(hub[1]))){fc.push([hub[1]]);ledger.push({sheet:'FC',row:fc.length,kind:'mock_missing_forecast_hub',hubCode:hub[0]});}
  fc.slice(2).forEach((row,ri)=>{for(let ci=1;ci<fc[1].length;ci++)if(/Forecast/i.test(String(fc[1][ci]))&&(row[ci]==null||row[ci]==='')){row[ci]=Math.round(1400+seed(row[0]+'fc'+ci)*4500);ledger.push({sheet:'FC',row:ri+3,column:ci+1,kind:'mock_missing_cell'});}});
  const provenance={mode:'LOCAL_XLSX_AND_MOCK',importedAt:new Date().toISOString(),asOf:anchor,
    files:Object.values(data).map(b=>b.name),hubs:permissions.length,
    mockCellsAndRows:ledger.length,mockSources:['Missing KPI cells and current-month HUB/day rows','Missing D0, attendance, DTC and FC coverage','BigQuery FLM volume, claims and lost adapters'],
    policy:'Existing nonblank workbook values are preserved. Mock data is deterministic and local only. Local settings changes are stored separately.',ledger};
  fs.writeFileSync(path.join(__dirname,'provenance.private.json'),JSON.stringify(provenance,null,2));
  return provenance;
}
module.exports={prepareData,seed,day};
