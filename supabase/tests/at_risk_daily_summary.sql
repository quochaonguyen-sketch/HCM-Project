-- Run only in a fresh disposable PostgreSQL database.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;

create table public.alert_orders (
  date text, fleet_final_station text, cogs text, aging text, yeu_cau_claim text
);
create table public.urgent_orders (
  deadline text, fleet_final_station text, cogs numeric, aging integer, fleet_final_status text, yeu_cau_claim text
);
grant select on public.alert_orders, public.urgent_orders to service_role;

insert into public.alert_orders values
  (U&'2024-02-29 08:09\00A0', E'  Depot\t A / B HUB ', '1000000', '7', ' FM '),
  ('2024-02-28T17:00:00z', U&'DEPOT\00A0A/B', '900000', '8', 'Return'),
  ('2024-03-01T00:30:12.123456+1400', 'Depot A/B', ' ', '21', 'synthetic private text'),
  ('2024-02-29 16:59:59Z', 'Depot A/B', '-7.25', '22', 'Missing'),
  ('2024-02-29T23:15:00-14', 'Depot A/B', '0', '', null),
  ('2023-02-29', 'Depot A/B', 'bad', 'garbage', ''),
  ('2024-02-30', 'Depot A/B', 'NaN', '-1', ''),
  ('2024-02-29 24:00', 'Depot A/B', '1e800', '0', ''),
  ('2024-02-29 23:59:60Z', 'Depot A/B', 'Infinity', '0', ''),
  ('2024-02-29 00:00+14:01', 'Depot A/B', '', '0', ''),
  ('2024-02-29 junk', 'Depot A/B', null, null, null),
  ('0001-01-01T00:00+14', 'Depot A/B', null, null, null),
  ('9999-12-31T23:59Z', 'Depot A/B', null, null, null),
  ('2024-02-29', '  ', '999', '1', 'LM');
insert into public.urgent_orders values
  (U&'2024-02-29 01:30+07\00A0', 'Depot A/B Hub', 1000001, 14, 'Delivered', null),
  ('2024-02-29 01:30+0730', 'Depot A/B', null, null, 'FM', 'RT'),
  ('2024-02-29 01:30+06:30', 'Depot A/B', 999999, 15, 'not a label', 'EHA');

\ir ../migrations/20261119000000_at_risk_daily_summary.sql

do $$
begin
  if has_table_privilege('anon', 'public.at_risk_daily_summary', 'SELECT') or
     has_table_privilege('authenticated', 'public.at_risk_daily_summary', 'SELECT') or
     not has_table_privilege('service_role', 'public.at_risk_daily_summary', 'SELECT') or
     has_table_privilege('service_role', 'public.at_risk_daily_summary', 'INSERT') then
    raise exception 'Unexpected view privileges';
  end if;
  if not (select relkind = 'm' from pg_class where oid = 'public.at_risk_daily_summary'::regclass) then
    raise exception 'View must be materialized';
  end if;
end $$;

set role service_role;
do $$
declare
  r record;
begin
  select * into strict r from public.at_risk_daily_summary
    where source = 'alert' and station = 'DEPOT A/B' and risk_day = '2024-02-29';
  if (r.order_count, r.known_cogs, r.missing_cogs, r.hv_orders, r.hv_cogs,
      r.aging_7, r.aging_14, r.aging_21, r.aging_over_21, r.missing_aging, r.missing_feedback)
    is distinct from (4, 1899992.75, 1, 1, 1000000, 1, 1, 1, 1, 0, 4) then
    raise exception 'Unexpected Alert day row %', r;
  end if;
  select * into strict r from public.at_risk_daily_summary where source = 'alert' and risk_day is null;
  if r.order_count <> 8 or r.missing_cogs <> 8 then
    raise exception 'Malformed or overflowing dates/COGS escaped the invalid-day bucket';
  end if;
  select * into strict r from public.at_risk_daily_summary where source = 'alert' and risk_day = '2024-03-01';
  if r.order_count <> 1 or r.known_cogs <> 0 or r.missing_cogs <> 0 then
    raise exception 'Unexpected west offset or known zero';
  end if;
  select * into strict r from public.at_risk_daily_summary where source = 'urgent' and risk_day = '2024-02-29';
  if (r.order_count, r.known_cogs, r.missing_cogs, r.hv_orders, r.hv_cogs,
      r.aging_14, r.aging_21, r.missing_aging, r.missing_feedback)
    is distinct from (3, 2000000, 1, 1, 1000001, 1, 1, 1, 3) then
    raise exception 'Unexpected Prelost day row %', r;
  end if;
  if (select count(*) from public.at_risk_daily_summary) <> 4 then
    raise exception 'Unexpected source, day or HUB grain';
  end if;
end $$;

reset role;
insert into public.urgent_orders values ('2024-02-29', 'DEPOT A/B', 1, 1, 'LM', null);
set role service_role;
do $$
begin
  if (select order_count from public.at_risk_daily_summary where source = 'urgent') is distinct from 4 then
    raise exception 'View did not reflect a new source row';
  end if;
end $$;
reset role;
