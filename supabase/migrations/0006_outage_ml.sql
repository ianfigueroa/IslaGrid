-- Phase 9: ML outage model — label store, hourly feature store, prediction
-- store. The model itself lives in ingestion/ml/; this schema is its only
-- contract with the rest of the system.
--
-- Honesty rails (enforced by the model code, surfaced as comments here):
--   - probability is clipped to [0.05, 0.95] before storage
--   - feature_freshness_s > 2× horizon disables the row server-side
--   - every prediction carries a model_version string

create table if not exists outage_labels (
  id              uuid primary key default gen_random_uuid(),
  municipality_id text references municipalities(id) on delete set null,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  severity        text not null default 'minor' check (severity in ('minor','moderate','major','blackout')),
  source          text not null,
  confidence      numeric not null default 0.5 check (confidence between 0 and 1),
  raw_key         text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_outage_labels_started   on outage_labels (started_at desc);
create index if not exists idx_outage_labels_municipal on outage_labels (municipality_id, started_at desc);
create unique index if not exists uq_outage_labels_dedupe
  on outage_labels (coalesce(municipality_id, ''), started_at, source);

-- Hourly feature store. The model reads from here; the feature builder writes.
create table if not exists outage_features (
  ts                       timestamptz not null,
  municipality_id          text not null references municipalities(id) on delete cascade,
  temp_c                   numeric,
  wind_kph                 numeric,
  gust_kph                 numeric,
  precip_mm                numeric,
  prob_precip              numeric,
  alert_level              text,
  grid_stress              numeric,
  planned_work_within_24h  boolean not null default false,
  recent_outages_7d        integer not null default 0,
  distance_to_nearest_plant_km numeric,
  elevation_m              numeric,
  hour_of_day              smallint,
  day_of_week              smallint,
  month                    smallint,
  primary key (ts, municipality_id)
);
create index if not exists idx_outage_features_ts on outage_features (ts desc);

create table if not exists outage_predictions (
  ts                   timestamptz not null,
  municipality_id      text not null references municipalities(id) on delete cascade,
  horizon              text not null check (horizon in ('1h','6h','12h','24h')),
  probability          numeric not null check (probability between 0 and 1),
  confidence_band      text not null check (confidence_band in ('low','medium','high')),
  top_factors          jsonb not null default '[]'::jsonb,
  model_version        text not null,
  feature_freshness_s  integer not null default 0,
  primary key (ts, municipality_id, horizon)
);
create index if not exists idx_outage_predictions_ts on outage_predictions (ts desc);

-- One-row-per (municipality, horizon) latest view for the public API.
create or replace view outage_predictions_latest as
  select distinct on (municipality_id, horizon)
         municipality_id, horizon, ts, probability, confidence_band,
         top_factors, model_version, feature_freshness_s
    from outage_predictions
  order by municipality_id, horizon, ts desc;

alter table outage_labels       enable row level security;
alter table outage_features     enable row level security;
alter table outage_predictions  enable row level security;

create policy public_read_labels      on outage_labels      for select to anon, authenticated using (true);
create policy public_read_features    on outage_features    for select to anon, authenticated using (true);
create policy public_read_predictions on outage_predictions for select to anon, authenticated using (true);

grant select on outage_predictions_latest to anon, authenticated;
