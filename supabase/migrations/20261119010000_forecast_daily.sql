begin;

-- ============================================================================
-- 1. Table: public.forecast_daily
-- Stores daily FM/LM forecast plans by operating date and canonical HUB.
-- ============================================================================
create table if not exists public.forecast_daily (
  plan_date date not null,
  hub_code text not null check (btrim(hub_code) <> ''),
  hub_name text not null,
  fm_forecast numeric not null default 0 check (fm_forecast >= 0),
  lm_forecast numeric not null default 0 check (lm_forecast >= 0),
  source text not null default 'FC_T1126',
  created_at timestamptz not null default now(),
  primary key (plan_date, hub_code)
);

create index if not exists idx_forecast_daily_date
  on public.forecast_daily (plan_date);
create index if not exists idx_forecast_daily_hub
  on public.forecast_daily (hub_code);
create index if not exists idx_forecast_daily_hub_date
  on public.forecast_daily (hub_code, plan_date);

-- ============================================================================
-- 2. View: public.forecast_daily_summary
-- Lightweight pre-aggregated daily forecast totals for Overview and trend charts.
-- Reduces network payload from 3,900 rows to 30 rows for monthly views.
-- ============================================================================
create or replace view public.forecast_daily_summary as
select
  plan_date,
  count(distinct hub_code) as reporting_hubs,
  coalesce(sum(fm_forecast), 0) as total_fm_forecast,
  coalesce(sum(lm_forecast), 0) as total_lm_forecast,
  round(coalesce(avg(fm_forecast), 0), 0) as avg_fm_forecast,
  round(coalesce(avg(lm_forecast), 0), 0) as avg_lm_forecast
from public.forecast_daily
group by plan_date
order by plan_date desc;

-- ============================================================================
-- 3. View: public.overview_hub_gap
-- Pre-computed gap analysis joining Forecast with D0 actual volumes.
-- Provides instant FM/LM gap percentages without client-side matching.
-- ============================================================================
create or replace view public.overview_hub_gap as
with fm_clean as (
  select distinct on (case when snapshot_date ~ '^\d{4}-\d{2}-\d{2}' then snapshot_date::date end, trim(regexp_replace(station_name, '(?i)\s+hub$', '')))
    case when snapshot_date ~ '^\d{4}-\d{2}-\d{2}' then snapshot_date::date end as report_date,
    trim(regexp_replace(station_name, '(?i)\s+hub$', '')) as hub_clean,
    station_name,
    total_fm_inbound
  from public.fm_order_volume_d0
  where snapshot_date is not null and snapshot_date ~ '^\d{4}-\d{2}-\d{2}'
  order by case when snapshot_date ~ '^\d{4}-\d{2}-\d{2}' then snapshot_date::date end, trim(regexp_replace(station_name, '(?i)\s+hub$', '')), created_at desc
),
lm_clean as (
  select distinct on (coalesce(nullif(substring(fetched_at from '^\d{4}-\d{2}-\d{2}'), '')::date, (created_at at time zone 'Asia/Ho_Chi_Minh')::date), trim(regexp_replace(station_name, '(?i)\s+hub$', '')))
    coalesce(
      nullif(substring(fetched_at from '^\d{4}-\d{2}-\d{2}'), '')::date,
      (created_at at time zone 'Asia/Ho_Chi_Minh')::date
    ) as report_date,
    trim(regexp_replace(station_name, '(?i)\s+hub$', '')) as hub_clean,
    station_name,
    lm_hub_inbounded_order_qty_eod,
    lm_hub_delivered_order_qty_eod
  from public.lm_order_volume_d0
  order by coalesce(nullif(substring(fetched_at from '^\d{4}-\d{2}-\d{2}'), '')::date, (created_at at time zone 'Asia/Ho_Chi_Minh')::date), trim(regexp_replace(station_name, '(?i)\s+hub$', '')), created_at desc
)
select
  f.plan_date,
  f.hub_code,
  f.hub_name,
  f.fm_forecast,
  coalesce(fm.total_fm_inbound, 0) as fm_inbound,
  case
    when f.fm_forecast > 0
    then round(((coalesce(fm.total_fm_inbound, 0) - f.fm_forecast)::numeric / f.fm_forecast) * 100, 2)
    else null
  end as fm_gap_pct,
  f.lm_forecast,
  coalesce(lm.lm_hub_inbounded_order_qty_eod, 0) as lm_inbound,
  coalesce(lm.lm_hub_delivered_order_qty_eod, 0) as lm_delivered,
  case
    when f.lm_forecast > 0
    then round(((coalesce(lm.lm_hub_inbounded_order_qty_eod, 0) - f.lm_forecast)::numeric / f.lm_forecast) * 100, 2)
    else null
  end as lm_gap_pct
from public.forecast_daily f
left join fm_clean fm
  on f.plan_date = fm.report_date
 and trim(regexp_replace(f.hub_name, '(?i)\s+hub$', '')) = fm.hub_clean
left join lm_clean lm
  on f.plan_date = lm.report_date
 and trim(regexp_replace(f.hub_name, '(?i)\s+hub$', '')) = lm.hub_clean;

-- ============================================================================
-- 4. View: public.d0_operations_summary
-- Consolidated operational feeds for D0 dashboard.
-- Combines FM volume, LM volume, Backlog, and Pending Pickup into 1 row per station.
-- ============================================================================
create or replace view public.d0_operations_summary as
with fm_latest as (
  select distinct on (case when snapshot_date ~ '^\d{4}-\d{2}-\d{2}' then snapshot_date::date end, trim(regexp_replace(station_name, '(?i)\s+hub$', '')))
    case when snapshot_date ~ '^\d{4}-\d{2}-\d{2}' then snapshot_date::date end as report_date,
    trim(regexp_replace(station_name, '(?i)\s+hub$', '')) as hub_clean,
    station_name,
    total_fm_inbound,
    outbound as fm_outbound,
    picked as fm_picked,
    pending_pickup_total as fm_pending_pickup
  from public.fm_order_volume_d0
  where snapshot_date is not null and snapshot_date ~ '^\d{4}-\d{2}-\d{2}'
  order by case when snapshot_date ~ '^\d{4}-\d{2}-\d{2}' then snapshot_date::date end, trim(regexp_replace(station_name, '(?i)\s+hub$', '')), created_at desc
),
lm_latest as (
  select distinct on (coalesce(nullif(substring(fetched_at from '^\d{4}-\d{2}-\d{2}'), '')::date, (created_at at time zone 'Asia/Ho_Chi_Minh')::date), trim(regexp_replace(station_name, '(?i)\s+hub$', '')))
    coalesce(
      nullif(substring(fetched_at from '^\d{4}-\d{2}-\d{2}'), '')::date,
      (created_at at time zone 'Asia/Ho_Chi_Minh')::date
    ) as report_date,
    trim(regexp_replace(station_name, '(?i)\s+hub$', '')) as hub_clean,
    station_name,
    lm_hub_delivered_order_qty_eod as lm_delivered,
    pending_inbound as lm_pending_inbound
  from public.lm_order_volume_d0
  order by coalesce(nullif(substring(fetched_at from '^\d{4}-\d{2}-\d{2}'), '')::date, (created_at at time zone 'Asia/Ho_Chi_Minh')::date), trim(regexp_replace(station_name, '(?i)\s+hub$', '')), created_at desc
),
backlog_latest as (
  select distinct on (coalesce(nullif(substring(fetched_at from '^\d{4}-\d{2}-\d{2}'), '')::date, (created_at at time zone 'Asia/Ho_Chi_Minh')::date), trim(regexp_replace(station_name, '(?i)\s+hub$', '')))
    coalesce(
      nullif(substring(fetched_at from '^\d{4}-\d{2}-\d{2}'), '')::date,
      (created_at at time zone 'Asia/Ho_Chi_Minh')::date
    ) as report_date,
    trim(regexp_replace(station_name, '(?i)\s+hub$', '')) as hub_clean,
    station_name,
    total_backlog_d_minus_1 as backlog_d_minus_1
  from public.backlog_d0
  order by coalesce(nullif(substring(fetched_at from '^\d{4}-\d{2}-\d{2}'), '')::date, (created_at at time zone 'Asia/Ho_Chi_Minh')::date), trim(regexp_replace(station_name, '(?i)\s+hub$', '')), created_at desc
),
lm_backlog_latest as (
  select distinct on (coalesce(nullif(substring(fetched_at from '^\d{4}-\d{2}-\d{2}'), '')::date, (created_at at time zone 'Asia/Ho_Chi_Minh')::date), trim(regexp_replace(station_name, '(?i)\s+hub$', '')))
    coalesce(
      nullif(substring(fetched_at from '^\d{4}-\d{2}-\d{2}'), '')::date,
      (created_at at time zone 'Asia/Ho_Chi_Minh')::date
    ) as report_date,
    trim(regexp_replace(station_name, '(?i)\s+hub$', '')) as hub_clean,
    station_name,
    backlog_d0 as lm_backlog_d0
  from public.lm_backlog_d0
  order by coalesce(nullif(substring(fetched_at from '^\d{4}-\d{2}-\d{2}'), '')::date, (created_at at time zone 'Asia/Ho_Chi_Minh')::date), trim(regexp_replace(station_name, '(?i)\s+hub$', '')), created_at desc
)
select
  coalesce(f.plan_date, fm.report_date, lm.report_date, b.report_date, lmb.report_date) as report_date,
  coalesce(f.hub_name, fm.station_name, lm.station_name, b.station_name, lmb.station_name) as station_name,
  f.hub_code,
  coalesce(f.fm_forecast, 0) as fm_forecast,
  coalesce(f.lm_forecast, 0) as lm_forecast,
  coalesce(fm.total_fm_inbound, 0) as fm_inbound,
  coalesce(fm.fm_outbound, 0) as fm_outbound,
  coalesce(fm.fm_picked, 0) as fm_picked,
  coalesce(fm.fm_pending_pickup, 0) as fm_pending_pickup,
  coalesce(lm.lm_delivered, 0) as lm_delivered,
  coalesce(lm.lm_pending_inbound, 0) as lm_pending_inbound,
  coalesce(lmb.lm_backlog_d0, 0) as lm_backlog_d0,
  coalesce(b.backlog_d_minus_1, 0) as backlog_d_minus_1
from public.forecast_daily f
full outer join fm_latest fm
  on f.plan_date = fm.report_date
 and trim(regexp_replace(f.hub_name, '(?i)\s+hub$', '')) = fm.hub_clean
full outer join lm_latest lm
  on coalesce(f.plan_date, fm.report_date) = lm.report_date
 and coalesce(trim(regexp_replace(f.hub_name, '(?i)\s+hub$', '')), fm.hub_clean) = lm.hub_clean
full outer join backlog_latest b
  on coalesce(f.plan_date, fm.report_date, lm.report_date) = b.report_date
 and coalesce(trim(regexp_replace(f.hub_name, '(?i)\s+hub$', '')), fm.hub_clean, lm.hub_clean) = b.hub_clean
full outer join lm_backlog_latest lmb
  on coalesce(f.plan_date, fm.report_date, lm.report_date, b.report_date) = lmb.report_date
 and coalesce(trim(regexp_replace(f.hub_name, '(?i)\s+hub$', '')), fm.hub_clean, lm.hub_clean, b.hub_clean) = lmb.hub_clean;

-- ============================================================================
-- 5. Access Grants
-- PostgREST reads are granted to anon, authenticated, and service_role.
-- Table modifications are restricted to service_role.
-- ============================================================================
grant select on public.forecast_daily to anon, authenticated, service_role;
grant select on public.forecast_daily_summary to anon, authenticated, service_role;
grant select on public.overview_hub_gap to anon, authenticated, service_role;
grant select on public.d0_operations_summary to anon, authenticated, service_role;
grant insert, update, delete on public.forecast_daily to service_role;

commit;
