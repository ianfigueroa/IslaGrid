-- Trim api_request_log to 90 days. Rows older than that carry no analytics
-- value and become a PII / storage liability (each row contains the API key
-- id + route + timestamp; aggregate counts cover everything we actually need
-- after 90 days).
--
-- We use pg_cron when available; the function is the source of truth so it
-- can also be run manually or from a GitHub Action if pg_cron isn't enabled.

-- Note: api_request_log uses `ts` (not `created_at`) per migration 0012.
create or replace function public.prune_api_request_log()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.api_request_log
  where ts < now() - interval '90 days';
$$;

-- Schedule daily at 03:17 UTC if pg_cron is installed. Wrapped in DO so the
-- migration succeeds on hosted Supabase projects without pg_cron too.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'prune-api-request-log',
      '17 3 * * *',
      $cron$ select public.prune_api_request_log(); $cron$
    );
  end if;
exception when others then
  raise notice 'pg_cron not available, prune must run via external scheduler';
end $$;
