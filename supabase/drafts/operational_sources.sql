-- Review draft only. This migration creates storage and indexes.
-- Approval and restricted runtime access must precede any load or application cutover.
begin;

create schema spx_operational;

create table spx_operational.people_roster_snapshot (
  snapshot_date date not null,
  source_kind text not null check (source_kind in ('RIDER', 'FTE')),
  employee_id text not null check (btrim(employee_id) <> ''),
  employee_name text,
  employee_email text,
  source_station text,
  hub_code text,
  position text,
  contract_type text,
  join_date date,
  last_work_date date,
  quality text not null check (quality in ('VALID', 'UNKNOWN')),
  issues text,
  primary key (snapshot_date, source_kind, employee_id)
);
create index people_roster_snapshot_hub on spx_operational.people_roster_snapshot
  (snapshot_date, source_kind, hub_code, employee_id);

create table spx_operational.bpo_roster_snapshot (
  snapshot_date date not null,
  employee_id text not null check (btrim(employee_id) <> ''),
  employee_name text,
  source_station text,
  hub_code text,
  vendor text,
  contract_type text,
  last_activity_date date,
  inactive_days integer check (inactive_days >= 0),
  tag text,
  quality text not null check (quality in ('VALID', 'UNKNOWN')),
  issues text,
  primary key (snapshot_date, employee_id)
);
create index bpo_roster_snapshot_hub on spx_operational.bpo_roster_snapshot
  (snapshot_date, hub_code, employee_id);

create table spx_operational.attendance_clock_in (
  attendance_date date not null,
  hub_code text not null check (btrim(hub_code) <> ''),
  person_key text not null check (btrim(person_key) <> ''),
  first_clock_in timestamptz,
  is_late boolean,
  primary key (attendance_date, hub_code, person_key)
);

create table spx_operational.dtc_actual (
  report_date date not null,
  hub_code text not null check (btrim(hub_code) <> ''),
  computed_at timestamptz not null,
  backlog_eod bigint,
  backlog_fetched_at timestamptz,
  delivered_14d_avg numeric,
  dtc_days numeric,
  status text not null,
  dtc_band text,
  valid_days integer,
  expected_days integer,
  window_start date,
  window_end date,
  missing_dates text,
  primary key (report_date, hub_code, computed_at)
);

create table spx_operational.hub_location (
  hub_code text primary key check (btrim(hub_code) <> ''),
  hub_name text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  address text,
  ward text,
  zone text,
  hub_type text,
  sqm text,
  district text,
  check ((latitude is null) = (longitude is null))
);

create table spx_operational.forecast_plan (
  source_kind text not null check (source_kind in ('FC', 'HISTORICAL_FORECAST')),
  plan_date date not null,
  hub_code text not null check (btrim(hub_code) <> ''),
  leg text not null check (leg in ('FM', 'LM')),
  source_revision text not null check (btrim(source_revision) <> ''),
  published_at timestamptz not null,
  planned_orders numeric check (planned_orders >= 0),
  primary key (source_kind, plan_date, hub_code, leg, source_revision)
);
commit;
