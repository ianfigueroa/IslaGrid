-- Phase 11 Solar Lens MVP — storage for geocode cache, assessment history,
-- and (when ingested) the NREL PR Rooftop PV Database.
--
-- The assessment endpoint persists every successful query for analytics +
-- so repeated lookups at the same coordinates can return instantly.

create extension if not exists "uuid-ossp";

create table if not exists geocode_cache (
  query_hash    text primary key,            -- sha256 of normalized input
  query         text not null,
  lat           double precision,
  lon           double precision,
  display_name  text,
  source        text not null,                -- 'nominatim' | 'maptiler' | 'manual'
  ts            timestamptz not null default now()
);

create table if not exists solar_assessments (
  id                    uuid primary key default gen_random_uuid(),
  ts                    timestamptz not null default now(),
  lat                   double precision not null,
  lon                   double precision not null,
  monthly_kwh_input     numeric,
  system_kw             numeric,
  annual_kwh_est        numeric,
  monthly_savings_est   numeric,
  payback_years         numeric,
  battery_kwh_rec       numeric,
  score                 integer,            -- 0..100 worth-it score
  financial_score       integer,            -- 0..100
  resilience_score      integer,            -- 0..100
  top_reasons           jsonb not null default '[]'::jsonb,
  assumptions           jsonb not null default '{}'::jsonb,
  source_version        text not null       -- 'pvwatts:v8' | 'pvrdb:2017-lidar' | etc
);
create index if not exists idx_solar_assessments_ts on solar_assessments (ts desc);

-- NREL PR Rooftop PV Database (LiDAR 2015–2017) — loaded by a one-shot
-- ingestion job. Until that runs the table is empty; the assessment endpoint
-- gracefully falls through to PVWatts-only estimates.
create table if not exists nrel_pvrdb_pr (
  building_id      text primary key,
  geom             geometry(MultiPolygon, 4326),
  centroid         geometry(Point, 4326),
  kw_potential     numeric,
  annual_kwh_est   numeric,
  tilt_deg         numeric,
  azimuth_deg      numeric,
  area_m2          numeric,
  source           text not null default 'nrel-pvrdb'
);
create index if not exists idx_pvrdb_centroid on nrel_pvrdb_pr using gist (centroid);

alter table geocode_cache enable row level security;
alter table solar_assessments enable row level security;
alter table nrel_pvrdb_pr enable row level security;

-- Anon reads are fine — these don't contain user-identifying data.
create policy public_read_geocode on geocode_cache for select to anon, authenticated using (true);
create policy public_read_solar on solar_assessments for select to anon, authenticated using (true);
create policy public_read_pvrdb on nrel_pvrdb_pr for select to anon, authenticated using (true);
