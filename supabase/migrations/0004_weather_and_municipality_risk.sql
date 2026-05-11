-- Phase 7: NWS weather snapshots + per-municipality risk verdicts.
-- The risk table is intentionally separate from grid_snapshots so the
-- island-wide heuristic (a single row per ts) and the per-region heuristic
-- (78 rows per ts) can evolve independently. Once Phase 9 ships the ML
-- predictions live in their own table again; the heuristic stays as the
-- comparison baseline.

create table if not exists weather_snapshots (
  ts              timestamptz not null,
  municipality_id text not null references municipalities(id) on delete cascade,
  temp_c          numeric,
  wind_kph        numeric,
  gust_kph        numeric,
  precip_mm       numeric,
  prob_precip     numeric,            -- 0..1
  alert_level     text check (alert_level in ('none','advisory','watch','warning')),
  raw_key         text,
  primary key (ts, municipality_id)
);
create index if not exists idx_weather_municipality_ts on weather_snapshots (municipality_id, ts desc);

create table if not exists municipality_risk_snapshots (
  ts              timestamptz not null,
  municipality_id text not null references municipalities(id) on delete cascade,
  risk_score      numeric not null,   -- 0..100
  band            text not null check (band in ('low','elevated','high','severe','unknown')),
  reasons         jsonb not null default '[]'::jsonb,
  feature_freshness_s integer not null default 0,
  source          text not null default 'islagrid-heuristic',
  primary key (ts, municipality_id)
);
create index if not exists idx_munirisk_municipality_ts on municipality_risk_snapshots (municipality_id, ts desc);

-- Latest-per-municipality convenience view used by the API and the map layer.
create or replace view municipality_risk_latest as
  select distinct on (municipality_id)
         municipality_id, ts, risk_score, band, reasons, feature_freshness_s, source
    from municipality_risk_snapshots
  order by municipality_id, ts desc;

alter table weather_snapshots             enable row level security;
alter table municipality_risk_snapshots   enable row level security;

create policy public_read_weather  on weather_snapshots             for select to anon, authenticated using (true);
create policy public_read_munirisk on municipality_risk_snapshots   for select to anon, authenticated using (true);

grant select on municipality_risk_latest to anon, authenticated;

-- Centroid RPC consumed by ingestion/src/sources/nws_weather.py. We expose
-- centroids (not the full polygon) so the ingester can iterate cheaply.
create or replace function municipality_centroids()
returns table (id text, name text, lat double precision, lon double precision)
language sql stable as $$
  select id,
         name,
         st_y(st_centroid(geom))::double precision as lat,
         st_x(st_centroid(geom))::double precision as lon
    from municipalities;
$$;
grant execute on function municipality_centroids() to anon, authenticated, service_role;
