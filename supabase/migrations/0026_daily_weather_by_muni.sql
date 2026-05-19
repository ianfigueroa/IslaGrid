-- Cached historical daily weather per muni, sourced from Open-Meteo's free
-- archive API. Populated by ingestion/src/pipeline/backfill_daily_weather.py.
--
-- Why a separate table: backfill_outage_features wipes + recreates feature
-- rows every run. If weather lived only on outage_features, every backfill
-- would re-trigger ~25k per-row UPDATEs (~37 min, hits the 30 min job
-- timeout). With this table, weather is loaded once and re-joined during
-- feature synthesis at zero per-row HTTP cost.

create table if not exists daily_weather_by_muni (
  municipality_id text not null references municipalities(id) on delete cascade,
  day             date not null,
  temp_c          numeric,
  wind_kph        numeric,
  gust_kph        numeric,
  precip_mm       numeric,
  source          text not null default 'open-meteo-archive',
  updated_at      timestamptz not null default now(),
  primary key (municipality_id, day)
);

create index if not exists idx_daily_weather_day on daily_weather_by_muni (day);

alter table daily_weather_by_muni enable row level security;
create policy public_read_daily_weather
  on daily_weather_by_muni for select to anon, authenticated using (true);
