-- IslaGrid AI initial schema
-- Run via: supabase db push

create extension if not exists postgis;
create extension if not exists "uuid-ossp";

-- =========================================================================
-- Core geography
-- =========================================================================

create table if not exists municipalities (
  id          text primary key,
  name        text not null,
  geom        geometry(MultiPolygon, 4326) not null,
  source      text not null default 'tiger-2024',
  created_at  timestamptz not null default now()
);
create index if not exists idx_municipalities_geom on municipalities using gist (geom);

create table if not exists h3_cells (
  h3              text primary key,            -- resolution-7
  municipality_id text references municipalities(id) on delete set null,
  centroid        geometry(Point, 4326)
);
create index if not exists idx_h3_municipality on h3_cells(municipality_id);

-- =========================================================================
-- Grid time series
-- =========================================================================

create table if not exists generation_snapshots (
  ts             timestamptz not null,
  plant_id       text not null,
  fuel           text check (fuel in ('oil','gas','coal','solar','wind','hydro','landfill','battery','peaker','unknown')),
  mw             numeric,            -- current output; negative when battery is charging
  available_mw   numeric,
  source         text not null,      -- 'datos.pr.gov' | 'genera-pr.com' | 'luma'
  raw_key        text,
  primary key (ts, plant_id)
);
create index if not exists idx_generation_ts on generation_snapshots (ts desc);
create index if not exists idx_generation_plant_ts on generation_snapshots (plant_id, ts desc);

create table if not exists grid_snapshots (
  ts                        timestamptz primary key,
  current_demand_mw         numeric,
  next_hour_demand_mw       numeric,
  total_generation_mw       numeric,
  available_capacity_mw     numeric,
  spinning_reserve_mw       numeric,
  operational_reserve_mw    numeric,
  peak_demand_forecast_mw   numeric,
  peak_reserve_forecast_mw  numeric,
  status                    text check (status in ('normal','watch','strained','critical','stale','unknown')) not null default 'unknown',
  status_reasons            jsonb not null default '[]'::jsonb,
  source                    text not null,
  source_stale              boolean not null default false,
  raw_key                   text
);
create index if not exists idx_grid_ts on grid_snapshots (ts desc);

-- =========================================================================
-- Planned work + official updates
-- =========================================================================

create table if not exists planned_work (
  id                     text primary key,
  municipality_id        text references municipalities(id) on delete set null,
  area                   text,
  work_type              text,
  start_ts               timestamptz,
  end_ts                 timestamptz,
  possible_interruption  boolean,
  source                 text not null default 'luma',
  source_url             text,
  raw_key                text,
  scraped_at             timestamptz not null default now()
);
create index if not exists idx_planned_work_window on planned_work (start_ts, end_ts);
create index if not exists idx_planned_work_municipality on planned_work (municipality_id);

create table if not exists official_updates (
  id        text primary key,
  ts        timestamptz not null,
  source    text not null,
  category  text,
  text      text not null,
  url       text,
  raw_key   text
);
create index if not exists idx_official_updates_ts on official_updates (ts desc);

-- =========================================================================
-- Community reports — privacy-first (H3 only, never exact location)
-- =========================================================================

create table if not exists community_reports (
  id        uuid primary key default gen_random_uuid(),
  ts        timestamptz not null default now(),
  type      text not null check (type in (
              'no_power','low_voltage','flicker','transformer',
              'pole','cable','tree','restored'
            )),
  h3        text not null,                         -- resolution-7 cell, never exact coords
  user_id   uuid,                                  -- private; never returned via API
  ip_hash   text                                   -- private; rate-limit only
);
create index if not exists idx_reports_h3_ts on community_reports (h3, ts desc);

-- Public aggregated view (the only thing the anon role may read)
create or replace view community_reports_public as
  select h3,
         type,
         count(*)::int                as report_count,
         max(ts)                      as latest_ts
    from community_reports
   where ts > now() - interval '24 hours'
   group by h3, type;

-- =========================================================================
-- PREB tariff snapshot (hand-curated for MVP; bill calculator deferred)
-- =========================================================================

create table if not exists preb_rates (
  effective_date  date primary key,
  rate_category   text not null,
  rate_per_kwh    numeric not null,
  source_url      text,
  notes           text
);

-- =========================================================================
-- Row Level Security
-- =========================================================================

alter table community_reports enable row level security;

-- Authenticated users may insert their own reports
create policy reports_insert
  on community_reports
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- No one (anon or authenticated) may read the raw table — public uses the view
revoke select on community_reports from anon, authenticated;

-- Allow public view read
grant select on community_reports_public to anon, authenticated;

-- Other tables are read-only for anon (writes happen via service role from ingestion)
alter table generation_snapshots enable row level security;
alter table grid_snapshots enable row level security;
alter table planned_work enable row level security;
alter table official_updates enable row level security;
alter table municipalities enable row level security;
alter table h3_cells enable row level security;
alter table preb_rates enable row level security;

create policy public_read_generation on generation_snapshots for select to anon, authenticated using (true);
create policy public_read_grid       on grid_snapshots       for select to anon, authenticated using (true);
create policy public_read_planned    on planned_work         for select to anon, authenticated using (true);
create policy public_read_updates    on official_updates     for select to anon, authenticated using (true);
create policy public_read_munis      on municipalities       for select to anon, authenticated using (true);
create policy public_read_h3         on h3_cells             for select to anon, authenticated using (true);
create policy public_read_rates      on preb_rates           for select to anon, authenticated using (true);
