begin;

drop materialized view if exists public.at_risk_daily_summary cascade;
drop view if exists public.at_risk_daily_summary cascade;

create materialized view public.at_risk_daily_summary as
with feed as (
  select 'alert'::text as source, a.date::text as stamp, a.fleet_final_station::text as station,
    a.cogs::text as cogs, a.aging::text as aging
  from public.alert_orders a
  where a.fleet_final_station is not null and btrim(a.fleet_final_station) <> ''
  union all
  select 'urgent'::text, u.deadline::text, u.fleet_final_station::text,
    u.cogs::text, u.aging::text
  from public.urgent_orders u
  where u.fleet_final_station is not null and btrim(u.fleet_final_station) <> ''
), cleaned as (
  select source, btrim(stamp, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') as stamp,
    regexp_replace(regexp_replace(upper(btrim(regexp_replace(
      translate(station, U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',
        repeat(' ', 19)), '\s+', ' ', 'g'))), ' HUB$', ''), ' */ *', '/', 'g') as station,
    btrim(cogs) as cogs,
    btrim(aging) as aging
  from feed
), parts as (
  select source, station,
    regexp_match(stamp, '^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T ]([01][0-9]|2[0-3]):([0-5][0-9])(?::[0-5][0-9](?:\.[0-9]+)?)?(?:(Z)|([+-])(0[0-9]|1[0-4])(?::?([0-5][0-9]))?)?)?$', 'i') as dt,
    case when length(cogs) <= 1024 and cogs ~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]{1,3})?$'
      then cogs::numeric end as cogs,
    case when aging ~ '^[+]?(?:[0-9]{1,9}(?:\.[0-9]{0,9})?|\.[0-9]{1,9})$' then aging::numeric end as aging
  from cleaned
  where station <> ''
), calendar as (
  select source, station, dt,
    case when dt[1]::int between 1 and 9999 and dt[2]::int between 1 and 12
      then make_date(dt[1]::int, dt[2]::int, 1) end as month_start,
    case when abs(cogs) <= 1.7976931348623157e308 then cogs end as cogs,
    aging
  from parts
), normalized as (
  select source, station, cogs, aging,
    case when dt[3]::int between 1 and extract(day from month_start + interval '1 month - 1 day')
      and (dt[8] is null or dt[8]::int < 14 or coalesce(dt[9]::int, 0) = 0)
      then month_start + (dt[3]::int - 1) +
        case when dt[6] is null and dt[7] is null then 0 else
          floor((dt[4]::int * 60 + dt[5]::int + 420 -
            (case when dt[7] = '-' then -1 else 1 end) *
            (coalesce(dt[8]::int, 0) * 60 + coalesce(dt[9]::int, 0))) / 1440.0)::int end
    end as risk_day
  from calendar
)
select source, station,
  case when risk_day between date '0001-01-01' and date '9999-12-31' then risk_day end as risk_day,
  count(*) as order_count,
  coalesce(sum(cogs), 0) as known_cogs,
  count(*) filter (where cogs is null) as missing_cogs,
  count(*) filter (where cogs >= 1000000) as hv_orders,
  coalesce(sum(cogs) filter (where cogs >= 1000000), 0) as hv_cogs,
  count(*) filter (where aging <= 7) as aging_7,
  count(*) filter (where aging > 7 and aging <= 14) as aging_14,
  count(*) filter (where aging > 14 and aging <= 21) as aging_21,
  count(*) filter (where aging > 21) as aging_over_21,
  count(*) filter (where aging is null) as missing_aging,
  count(*) as missing_feedback
from normalized
group by 1, 2, 3
with data;

create unique index if not exists idx_at_risk_summary_pk
  on public.at_risk_daily_summary (source, station, risk_day);
create index if not exists idx_at_risk_summary_day
  on public.at_risk_daily_summary (risk_day);

revoke all on public.at_risk_daily_summary from public, anon, authenticated;
grant select on public.at_risk_daily_summary to service_role;

create or replace function public.refresh_at_risk_daily_summary()
returns void language plpgsql security definer as $$
begin
  refresh materialized view concurrently public.at_risk_daily_summary;
end;
$$;
grant execute on function public.refresh_at_risk_daily_summary() to service_role;

create or replace function public.trigger_refresh_at_risk_daily_summary()
returns trigger language plpgsql security definer as $$
begin
  refresh materialized view public.at_risk_daily_summary;
  return null;
end;
$$;

drop trigger if exists trg_refresh_at_risk_alert on public.alert_orders;
create trigger trg_refresh_at_risk_alert
  after insert or update or delete or truncate on public.alert_orders
  for each statement execute function public.trigger_refresh_at_risk_daily_summary();

drop trigger if exists trg_refresh_at_risk_urgent on public.urgent_orders;
create trigger trg_refresh_at_risk_urgent
  after insert or update or delete or truncate on public.urgent_orders
  for each statement execute function public.trigger_refresh_at_risk_daily_summary();

commit;
