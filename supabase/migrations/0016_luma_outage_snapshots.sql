-- LUMA outage map snapshots — per-region customer-affected counts scraped
-- from miluma.lumapr.com/outages (LUMA's own public outage map, served by
-- an ArcGIS REST FeatureServer).
--
-- One row per region per ingest run. Time-series queries answer "how did
-- this region's outage count change over the last 24h?" without needing a
-- separate diff pipeline.

create table if not exists luma_outage_snapshots (
  id                       bigserial primary key,
  ts                       timestamptz not null default now(),
  region_id                text not null,
  region_name              text not null,
  customers_affected       integer,
  customers_served         integer,
  outage_count             integer,
  source_last_updated_at   timestamptz,
  source                   text not null default 'luma-outage-map',
  raw_key                  text,
  created_at               timestamptz not null default now()
);

create index if not exists idx_luma_outage_region_ts
  on luma_outage_snapshots (region_id, ts desc);
create index if not exists idx_luma_outage_ts
  on luma_outage_snapshots (ts desc);

alter table luma_outage_snapshots enable row level security;
create policy public_read_luma_outage_snapshots
  on luma_outage_snapshots for select to anon, authenticated using (true);

-- Convenience view: most recent snapshot per region.
create or replace view luma_outage_latest as
  select distinct on (region_id)
    region_id, region_name, customers_affected, customers_served,
    outage_count, source_last_updated_at, ts, raw_key
  from luma_outage_snapshots
  order by region_id, ts desc;

grant select on luma_outage_latest to anon, authenticated;

-- Extend the tier view so Bluesky + Mastodon posts get tagged as
-- 'unverified' just like the old X/Twitter rows did.
create or replace view official_updates_tiered as
  select
    id, ts, source, category, text, url,
    case
      when source like 'social.%'             then 'unverified'
      when category = 'planned-work'          then 'planned'
      when source like '%/avisos'             then 'announcement'
      else 'official'
    end as tier
  from official_updates;

grant select on official_updates_tiered to anon, authenticated;
