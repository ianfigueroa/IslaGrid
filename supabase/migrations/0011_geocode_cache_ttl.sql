-- Bound geocode_cache growth so a flood of unique queries can't balloon
-- storage. Rows older than 90 days are purged by a cleanup job (configure
-- with pg_cron or a scheduled GitHub Action against the service role).

alter table geocode_cache
  add column if not exists expires_at timestamptz
  generated always as (ts + interval '90 days') stored;

create index if not exists idx_geocode_cache_expires
  on geocode_cache (expires_at);

comment on column geocode_cache.expires_at is
  '90-day TTL. The cleanup job DELETEs rows where expires_at < now().';

-- Optional pg_cron schedule (uncomment after enabling pg_cron in Supabase):
-- select cron.schedule(
--   'geocode_cache_cleanup',
--   '0 3 * * *',
--   $$delete from geocode_cache where expires_at < now()$$
-- );
