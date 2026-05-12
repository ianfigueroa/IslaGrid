-- Hurricane / tropical-cyclone forecasts from NHC.
--
-- One row per (storm_id, forecast_made_at). Active-storm advisories land
-- every 6 hours. cone_geojson + track_geojson are the canonical geometries
-- used both by the map (display) and by the risk pipeline (feature
-- engineering: cone-coverage % per municipality).

create table if not exists hurricane_forecasts (
  id                      bigserial primary key,
  storm_id                text not null,                 -- e.g. 'AL062026'
  storm_name              text,
  basin                   text not null default 'atlantic',
  forecast_made_at        timestamptz not null,
  category                integer,                       -- Saffir-Simpson, -1 = TD, 0 = TS
  max_wind_kt             integer,
  min_pressure_mb         integer,
  track_geojson           jsonb,                         -- LineString of forecast positions
  cone_geojson            jsonb,                         -- Polygon (~120h)
  active                  boolean not null default true,
  source                  text not null default 'nhc-hurdat',
  raw_key                 text,
  created_at              timestamptz not null default now()
);

create unique index if not exists uq_hurricane_storm_forecast
  on hurricane_forecasts (storm_id, forecast_made_at);
create index if not exists idx_hurricane_active_made
  on hurricane_forecasts (active, forecast_made_at desc);

alter table hurricane_forecasts enable row level security;
create policy public_read_hurricane_forecasts
  on hurricane_forecasts for select to anon, authenticated using (true);

-- Latest forecast per active storm.
create or replace view hurricane_active_latest as
  select distinct on (storm_id)
    storm_id, storm_name, basin, forecast_made_at, category, max_wind_kt,
    min_pressure_mb, track_geojson, cone_geojson
  from hurricane_forecasts
  where active = true
  order by storm_id, forecast_made_at desc;

grant select on hurricane_active_latest to anon, authenticated;

-- Add cone-coverage feature columns to the risk snapshot table. Nullable so
-- the rule-based pipeline can omit them when no storm is active.
alter table municipality_risk_snapshots
  add column if not exists forecast_cone_coverage_pct numeric,
  add column if not exists nearest_storm_category     integer,
  add column if not exists nearest_storm_id           text,
  add column if not exists model_version              text,
  add column if not exists ci_low                     numeric,
  add column if not exists ci_high                    numeric;

-- Materialize centroid coordinates on municipalities so the Python risk
-- pipeline can pull centroids in a single Supabase row read (no PostGIS
-- function call needed via the supabase-py client).
alter table municipalities
  add column if not exists centroid_lon numeric,
  add column if not exists centroid_lat numeric;

update municipalities
  set centroid_lon = ST_X(ST_Centroid(geom)),
      centroid_lat = ST_Y(ST_Centroid(geom))
  where centroid_lon is null or centroid_lat is null;

-- Rebuild the latest view to surface the new columns.
create or replace view municipality_risk_latest as
  select distinct on (municipality_id)
    municipality_id, ts, risk_score, band, reasons, feature_freshness_s,
    source, forecast_cone_coverage_pct, nearest_storm_category,
    nearest_storm_id, model_version, ci_low, ci_high
  from municipality_risk_snapshots
  order by municipality_id, ts desc;

grant select on municipality_risk_latest to anon, authenticated;
