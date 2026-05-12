-- Historical outage data — three official, public-domain sources.
--
-- 1. DOE EAGLE-I (Oak Ridge National Lab): 15-min, county-level customer
--    out-counts for the entire US, 2014-2022. The standard academic dataset
--    cited by power-outage prediction papers. PR + USVI included.
--
-- 2. Puerto Rico Energy Bureau filings (energia.pr.gov): LUMA's mandatory
--    quarterly performance filings since 2021. SAIDI/SAIFI per region + an
--    event list per quarter. PDFs we parse on a schedule.
--
-- 3. Internet Archive snapshots of miluma.lumapr.com/outages — historical
--    state of LUMA's live outage map, used to fill the gap between EAGLE-I
--    (ends 2022) and our own scrape archive (started 2026).
--
-- These three together give us a real backfill of outage labels for ML
-- training — no synthetic data, no third-party scrapers.

-- ============================================================
-- EAGLE-I
-- ============================================================
create table if not exists eagle_i_outages (
  id               bigserial primary key,
  ts               timestamptz not null,
  fips_state       text not null,
  fips_county      text not null,
  -- For PR FIPS state = '72', county = '127' (San Juan) etc. Composite
  -- match against municipalities.id which we store as '72-127'.
  municipality_id  text references municipalities(id) on delete set null,
  customers_out    integer not null,
  source           text not null default 'eagle-i',
  raw_key          text,
  created_at       timestamptz not null default now()
);
create unique index if not exists uq_eagle_i_obs
  on eagle_i_outages (ts, fips_state, fips_county);
create index if not exists idx_eagle_i_muni_ts
  on eagle_i_outages (municipality_id, ts desc) where municipality_id is not null;
create index if not exists idx_eagle_i_ts
  on eagle_i_outages (ts desc);
alter table eagle_i_outages enable row level security;
create policy public_read_eagle_i on eagle_i_outages
  for select to anon, authenticated using (true);

-- ============================================================
-- PREB quarterly filings
-- ============================================================
create table if not exists preb_filings (
  id                bigserial primary key,
  filing_date       date not null,
  -- e.g. '2024-Q3', 'monthly-2025-03'
  period            text not null,
  category          text not null,    -- 'performance', 'tariff', 'event-report', etc.
  saidi_minutes     numeric,           -- island-wide System Average Interruption Duration Index
  saifi_count       numeric,           -- System Average Interruption Frequency Index
  major_events      jsonb,             -- [{date, region, customers, cause, duration_h}, ...]
  source_url        text not null,
  pdf_key           text,              -- R2 key of archived PDF
  parser_version    text not null default 'v1',
  source            text not null default 'preb',
  created_at        timestamptz not null default now()
);
create unique index if not exists uq_preb_filings
  on preb_filings (period, category, source_url);
create index if not exists idx_preb_filings_date
  on preb_filings (filing_date desc);
alter table preb_filings enable row level security;
create policy public_read_preb_filings on preb_filings
  for select to anon, authenticated using (true);

-- ============================================================
-- Wayback Machine backfill of LUMA outage map
-- ============================================================
-- We store each Wayback snapshot we successfully parsed as a single row;
-- the per-region payload lives in regions_jsonb so we don't have to alter
-- this table when LUMA changes their region breakdown.
create table if not exists wayback_outage_history (
  id                bigserial primary key,
  snapshot_ts       timestamptz not null,         -- when LUMA's data is stamped
  wayback_capture_ts timestamptz not null,        -- when IA captured the page
  wayback_url       text not null,
  regions           jsonb not null,               -- [{region, customers_affected, customers_served, outage_count}]
  source            text not null default 'wayback:miluma.lumapr.com/outages',
  raw_key           text,
  created_at        timestamptz not null default now()
);
create unique index if not exists uq_wayback_outage
  on wayback_outage_history (wayback_capture_ts, wayback_url);
create index if not exists idx_wayback_outage_snap_ts
  on wayback_outage_history (snapshot_ts desc);
alter table wayback_outage_history enable row level security;
create policy public_read_wayback_outage on wayback_outage_history
  for select to anon, authenticated using (true);
