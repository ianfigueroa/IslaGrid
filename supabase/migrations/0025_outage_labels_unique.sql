-- The original unique index on outage_labels (migration 0006) keyed on
-- coalesce(municipality_id, '') so it could also dedupe NULL-muni rows.
-- ON CONFLICT can't match an expression index without naming the same
-- expression, and PostgREST's on_conflict parameter only accepts a column
-- list (no predicate), so the backfill pipeline blew up with 42P10.
--
-- Replace the expression index with a regular unique index on the columns
-- the upsert actually targets. Pipeline code filters NULL muni_id before
-- inserting, and PG treats NULL as distinct in unique indexes, so dedupe
-- coverage for real rows is unchanged.

drop index if exists uq_outage_labels_dedupe_v2;
create unique index if not exists uq_outage_labels_dedupe_v3
  on outage_labels (municipality_id, started_at, source);
