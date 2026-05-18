-- Phase 24 — per-municipality daily outage rollup.
--
-- Powers the /m/[id] history page (reliability score, calendar, monthly
-- chart, cause breakdown). Source data lives in `outage_events` +
-- `cause_predictions` + `eagle_i_outages`; the backfill pipeline aggregates
-- those into one row per municipality per day so the page can render the
-- last 12 months without joining three tables on every request.
--
-- The API can still serve from `outage_events` on demand when this table is
-- empty (first deploy / catch-up window) — see lib/reliability.ts.

create table if not exists municipality_outage_daily (
  municipality_id           text        not null
                            references municipalities(id) on delete cascade,
  day                       date        not null,
  outage_hours              numeric     not null default 0,
  outage_events             integer     not null default 0,
  -- Hours attributed to each cause class. cause_generation + cause_distribution
  -- + cause_weather + cause_planned + cause_unknown should sum to outage_hours
  -- (modulo rounding). When the classifier is unsure, hours land in unknown.
  cause_generation_hours    numeric     not null default 0,
  cause_distribution_hours  numeric     not null default 0,
  cause_weather_hours       numeric     not null default 0,
  cause_planned_hours       numeric     not null default 0,
  cause_unknown_hours       numeric     not null default 0,
  -- Sum of (customers_out * minutes_out) for the day. Lets us compute
  -- SAIDI-equivalent customer-hours when the municipality customer base
  -- is joined separately.
  customer_minutes          bigint      not null default 0,
  source                    text        not null,
  updated_at                timestamptz not null default now(),
  primary key (municipality_id, day)
);

create index if not exists idx_muni_outage_daily_day
  on municipality_outage_daily (day desc);
create index if not exists idx_muni_outage_daily_muni_day
  on municipality_outage_daily (municipality_id, day desc);

alter table municipality_outage_daily enable row level security;
create policy public_read_muni_outage_daily
  on municipality_outage_daily
  for select to anon, authenticated using (true);
