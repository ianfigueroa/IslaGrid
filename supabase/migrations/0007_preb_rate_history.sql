-- Extend preb_rates with provenance columns so the ingestion pipeline can
-- track which order PDF a row came from. The frozen seed in migration 0003
-- stays as the baseline — new ingest rows shadow it when more recent.

alter table preb_rates
  add column if not exists source_pdf_key  text,
  add column if not exists source_doc_url  text,
  add column if not exists ingested_at     timestamptz default now();

-- Speed up "latest effective rate" queries the API does on every bill page
-- request.
create index if not exists preb_rates_effective_idx
  on preb_rates (rate_category, effective_date desc);

comment on column preb_rates.source_pdf_key is
  'R2 key for the rate-order PDF this row was parsed from. Null for the seeded baseline.';
comment on column preb_rates.source_doc_url is
  'Public URL of the PREB rate order PDF this row was parsed from.';
