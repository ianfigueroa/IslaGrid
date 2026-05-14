-- AEE/PREPA Manual Load Shedding feeder snapshots.
--
-- Source: AEEPR-owned ArcGIS FeatureServer behind the public dashboard
--   https://aeepr.maps.arcgis.com/apps/dashboards/1995c773fceb468db8b7f7d34899df94
-- Layer:
--   services3.arcgis.com/0n3sEGhALDkUSwc5/arcgis/rest/services/Manual_Load_Shedding/FeatureServer/0
--
-- This is feeder-level (not muni-level) outage geometry — the most granular
-- official electrical outage feed published for Puerto Rico. We only persist
-- features whose STATUS = 'SI' (active interruption) or predicted = 'SI'
-- (projected load shed) — the full feeder atlas is ~50k polygons and only
-- the affected slice is interesting.
--
-- One row per feeder per ingest run. The geometry column is GeoJSON so the
-- Next.js API can serve it directly without a PostGIS round-trip.

create table if not exists aeepr_feeder_snapshots (
  id                       bigserial primary key,
  ts                       timestamptz not null default now(),
  feeder_id                text not null,          -- CIRCUIT1 / FEEDER (e.g. "1001-01")
  name                     text,                   -- NAME (sector name)
  region                   text,                   -- REGION (e.g. "SAN JUAN")
  municipality_label       text,                   -- MUNICIPALI (LUMA spelling; not FIPS)
  voltage_kv               numeric,                -- VOLTAGE
  load_mw                  numeric,                -- MW
  customers                integer,                -- CLIENTS
  critical_load            text,                   -- CRITICAL_L
  erp_level                integer,                -- ERP_LEVEL
  sectors                  text,                   -- SECTORS
  status                   text not null,          -- STATUS: 'SI' = out, 'NO' = served
  predicted_load_shed      text,                   -- predicted: 'SI' = projected to shed
  predicted_at             text,                   -- pred_time (string, AEEPR's format)
  time_out_app             text,                   -- TIME_OUT_APP
  stage                    text,                   -- STAGE
  comments                 text,                   -- COMMENTS
  geometry_geojson         jsonb,                  -- GeoJSON polygon
  source                   text not null default 'aeepr.maps.arcgis.com',
  raw_key                  text,
  created_at               timestamptz not null default now()
);

create index if not exists idx_aeepr_feeder_status_ts
  on aeepr_feeder_snapshots (status, ts desc);
create index if not exists idx_aeepr_feeder_predicted_ts
  on aeepr_feeder_snapshots (predicted_load_shed, ts desc);
create index if not exists idx_aeepr_feeder_id_ts
  on aeepr_feeder_snapshots (feeder_id, ts desc);
create index if not exists idx_aeepr_feeder_ts
  on aeepr_feeder_snapshots (ts desc);

alter table aeepr_feeder_snapshots enable row level security;
create policy public_read_aeepr_feeder_snapshots
  on aeepr_feeder_snapshots for select to anon, authenticated using (true);

-- Latest snapshot per feeder for the API to query without a window function.
create or replace view aeepr_feeder_latest as
  select distinct on (feeder_id)
    feeder_id, name, region, municipality_label, voltage_kv, load_mw,
    customers, critical_load, erp_level, sectors, status,
    predicted_load_shed, predicted_at, time_out_app, stage, comments,
    geometry_geojson, ts, raw_key
  from aeepr_feeder_snapshots
  order by feeder_id, ts desc;

grant select on aeepr_feeder_latest to anon, authenticated;
