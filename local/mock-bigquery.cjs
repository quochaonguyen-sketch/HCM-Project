// Mock unavailable BigQuery tables behind the existing production builders.
// No external API is contacted; scope authorization still runs in .gs code.
const {seed}=require('./sample-data.cjs');
module.exports=function(data,context){
  const shift=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
  return {
    flmTeamMetadata_(table){return {table,revision:'LOCAL_MOCK_v1',modifiedAt:new Date().toISOString(),localMock:true};},
    flmTeamQuery_(sql,ctx){
      const hubs=ctx.codes.map(code=>({code,name:ctx.byCode[code].hubName}));
      if(/row_count/.test(sql)){
        if(/fc_raw/.test(sql))return [{row_count:hubs.length*76,hubs:hubs.length}];
        const rows=[];
        const end=/@closing/.test(sql)?ctx.closing:ctx.anchor;
        for(let d=ctx.from;d<=end;d=shift(d,1))for(const source of (/flm_claim_current/.test(sql)?['urgent','alert']:['']))rows.push({d,source,row_count:hubs.length*3,hubs:hubs.length,ingested_at:d+'T23:00:00+07:00'});
        return rows;
      }
      if(/flm_volume_snapshot/.test(sql)){
        const rows=[];
        for(let d=ctx.from;d<=ctx.anchor;d=shift(d,1))for(const hub of hubs){
          const n=Math.round(1200+seed(hub.code+d)*5000),pickup=Math.round(n*.87),delivered=Math.round(n*.91),lmRet=Math.round(n*.02),returned=Math.round(n*.008);
          rows.push({d,station:hub.name,volume_rows:1,backlog_rows:1,pickup_request:n,pickup_done:pickup,seller_dts:Math.round(n*.04),fm_fwd_in:pickup,fm_ret_in:Math.round(n*.02),fm_ret_out:Math.round(n*.018),lh_arrived:n,lm_fwd_in:n,assigned:n,delivered,lm_ret_in:lmRet,returned,stored_fm_backlog:n-pickup,stored_lm_backlog:n-delivered+lmRet-returned});
        }return rows;
      }
      if(/fc_raw/.test(sql)){
        const rows=[];for(let d=ctx.from;d<=ctx.to;d=shift(d,1))for(const hub of hubs)for(const flm of ['FM','LM'])rows.push({d,station:hub.name,flm,qty:Math.round(1400+seed(hub.code+d+flm)*5000),fc_updated:d+'T06:00:00+07:00'});return rows;
      }
      if(/flm_claim_current/.test(sql))return [
        ...['urgent','alert'].map(source=>({row_kind:'meta',source,snapshot_date:ctx.anchor,ingested_at:ctx.anchor+'T08:00:00+07:00',requested_available:true})),
        ...hubs.flatMap(hub=>['urgent','alert'].map(source=>({row_kind:'group',source,station:hub.name,group_aging:'0-3 days',stage:'In progress',high_value:false,feedback:'Pending',snapshot_date:ctx.anchor,n:3,cogs:450000,missing_cogs:0,max_duplicate:1})))];
      if(/flm_lost_current/.test(sql)){
        const rows=[],from=ctx.closing.slice(0,7)+'-01'<ctx.from?ctx.closing.slice(0,7)+'-01':ctx.from;
        for(let d=from;d<=ctx.closing;d=shift(d,1))for(const hub of hubs)rows.push({d,station:hub.name,reason:'LOCAL MOCK - Missing scan',n:1,amount:Math.round(50000+seed(hub.code+d)*250000),missing_amount:0,max_duplicate:1,ingested_at:d+'T23:00:00+07:00'});return rows;
      }
      throw Error('LOCAL_MOCK_QUERY_UNSUPPORTED');
    }
  };
};
