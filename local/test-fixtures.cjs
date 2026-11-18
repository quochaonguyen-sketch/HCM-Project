// Synthetic inputs only: never copy workbook records or credentials here.
const fs = require('node:fs');
const path = require('node:path');
function writeFixtures(directory) {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const hubs = Array.from({length:120}, (_,i) => ['TEST'+String(i+1).padStart(3,'0'), 'Synthetic '+String(i+1).padStart(3,'0')+' Hub']);
  const metrics = ['%FM Ontime','%LM Ontime','%Deli Success','%Sorter Productivity','%Rider Productivity','%Correct SOP - PU'];
  const front = {
    Permission: [['Hub Code','Hub','SAOM','AOM','Sup','Lead','Type','Zone'], ...hubs.map(([code,name],i)=>[code,name,'saom@example.test','aom@example.test',i<60?'sup1@example.test':'sup2@example.test','lead'+i+'@example.test','AMH','TEST'])],
    'Adhoc user': [['EMAIL','DISPLAY_NAME','ROLE','SCOPE_TYPE','SCOPE_VALUE','ACTIVE','SOURCE','NOTE','CREATED_AT','UPDATED_AT']],
    'KPI Daily': [['KPI Date','Station Name','Month','Hub Type','Region',...metrics,'Grade','Final Point'],...hubs.map(([,name])=>[day,name,day.slice(0,7),'AMH','HCM',...metrics.map(()=>0.96),'B',0.96])],
    'KPI Result': [['KPI Month','Station Name','Hub Type','Region',...metrics,'FM Days','LM Days','DSR Days','Sorter Days','Rider Days','SOP Days','Expected Days','As Of','Method','Status','Grade','Final Point']],
    HubMap: [['Hub Code','Hub Name','Lat','Long'], ...hubs.map(([code,name])=>[code,name,10.8,106.7])]
  };
  const back = {};
  for (const name of ['Roster D0','Roster Shifts D0','Backlog D0','LM Backlog D0','LM Order Volume D0','FM Order Volume D0','FM Pending Pickup Backlog D0','Delivery Progress D0']) {
    const header=['station_id','station_name','event_date_iso','snapshot_date','fetched_at','driver_id','driver_name','scheduled_count','present_count','fte_count','planned_people','actual_people','actual_fte','lm_hub_fleet_assigned_order_qty_td'];
    back[name]=[header, ...hubs.map(([code,hub],i)=>[i+1,hub,day,day,day+'T09:00:00+07:00','rider-'+code,'Synthetic Rider',10,8,8,10,8,8,100])];
  }
  const dtcHeader=['report_date','station_id','station_name','backlog_eod','delivered_14d_total','delivered_14d_avg','dtc_days','window_end','computed_at','status'];
  back.D0=[dtcHeader]; back.DTC=[dtcHeader]; front['DTC D0']=[dtcHeader];
  const tomorrow=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  back.FC=[['Hub Name',day,'',tomorrow,''],['','#FM Forecast','#LM Forecast','#FM Forecast','#LM Forecast'],...hubs.map(([,name])=>[name,1000,1200,1100,1300])];
  front.FC=back.FC;
  front['_SYS_FORECAST_DAILY_FACT']=[['Date','Region','Province','Hub Code','Hub Name','Zone','District','FM Forecast','FM Inbound','FM Difference Source','Pickup Done','LM Forecast','LM Inbound','LM Difference Source','LM LH Arrived','LM SOC Transported','Generated At'],...hubs.map(([code,name])=>[day,'HCM','TEST',code,name,'TEST','TEST',1000,950,-0.05,900,1200,1150,-0.04,1100,1000,day])];
  back['Backlog EOD History']=[['station_name','total_backlog_d0','snapshot_date'],...hubs.map(([,name])=>[name,100,day])];
  const peopleHeader=['Staff ID/ Rider ID','Họ tên','Ngày nhận việc','Nơi làm việc','Ngày nghỉ việc','Vị trí'];
  for(const [sheet,position] of [['staff','Staff'],['riders','4. Rider']]) back[sheet]=[peopleHeader,...hubs.map(([code,name])=>[sheet+'-'+code,'Synthetic '+sheet,'2026-01-01',name,'',position])];
  back.bpo=[['Vendor','Mã CTV','Loại CTV','Địa điểm','Họ và tên','Ngày làm gần nhất','Số ngày chưa phát sinh công','Tag'],...hubs.map(([code,name])=>['TEST','bpo-'+code,'TEST',name,'Synthetic BPO',day,0,'TEST'])];
  const hourly=[['station_id','station_name','grass_date','hour','fetched_at','lm_hub_received_in_system_order_qty_1h','lm_hub_assigned_in_system_order_qty_1h','lm_hub_delivered_in_system_order_qty_1h'],...hubs.flatMap(([,name],i)=>[0,5,12].map(hour=>[i+1,name,day,hour,day+'T13:00:00+07:00',hour,10+hour,5+hour]))];
  fs.writeFileSync(path.join(directory,'workbooks.private.json'),JSON.stringify({frontend:{name:'SYNTHETIC frontend',sheets:front},backend:{name:'SYNTHETIC backend',sheets:back}}));
  fs.writeFileSync(path.join(directory,'hourly.private.json'),JSON.stringify(hourly));
}
module.exports={writeFixtures};
