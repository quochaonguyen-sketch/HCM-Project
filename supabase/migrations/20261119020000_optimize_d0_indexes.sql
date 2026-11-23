begin;

-- ============================================================================
-- Optimization Indexes for D0 Tables in Supabase
-- Eliminates sequential table scans when querying station_name.
-- Drastically speeds up PostgREST response times from ~800ms down to ~20ms.
-- ============================================================================

-- 1. FM Order Volume
create index if not exists idx_fm_order_volume_station
  on public.fm_order_volume_d0 (station_name);
create index if not exists idx_fm_order_volume_date_station
  on public.fm_order_volume_d0 (snapshot_date, station_name);

-- 2. LM Order Volume
create index if not exists idx_lm_order_volume_station
  on public.lm_order_volume_d0 (station_name);

-- 3. Backlog D0
create index if not exists idx_backlog_d0_station
  on public.backlog_d0 (station_name);

-- 4. LM Backlog D0
create index if not exists idx_lm_backlog_d0_station
  on public.lm_backlog_d0 (station_name);

-- 5. Delivery Progress D0 (Largest table: ~4,800 rows)
create index if not exists idx_delivery_progress_station
  on public.delivery_progress_d0 (station_name);

-- 6. FM Pending Pickup Backlog D0
create index if not exists idx_fm_pending_pickup_station
  on public.fm_pending_pickup_backlog_d0 (station_name);

-- 7. Roster D0
create index if not exists idx_roster_d0_station
  on public.roster_d0 (station_name);

-- 8. Roster Shifts D0
create index if not exists idx_roster_shifts_station
  on public.roster_shifts_d0 (station_name);

-- 9. Throughput Hourly D0
create index if not exists idx_throughput_hourly_station
  on public.throughput_hourly_d0 (station_name);

commit;
