-- Phase 27 — PII hardening.
--
-- Three changes, driven by the May 2026 security review:
--
-- 1. api_keys.owner_email stored plaintext. RLS already blocks anon/authenticated
--    reads, but a leaked DB snapshot would expose researcher / commercial
--    contact emails. We add owner_email_hash (SHA-256 of lowercased email)
--    and drop the plaintext column. Operators looking up "what key does
--    person@example.com own?" hash the email before querying.
--
-- 2. geocode_cache.query and geocode_cache.display_name are raw user addresses
--    and the table has a `public_read using (true)` policy. That combination
--    is a re-identification surface when paired with solar_assessments
--    coordinates + timestamps. We drop both columns; lookup uses query_hash.
--    If callers need the display_name they can re-geocode their own input.
--
-- 3. solar_assessments stores exact lat/lon + financial estimates with the
--    same public-read policy and no TTL. We:
--      - add an expires_at column defaulting to 365 days after insert
--      - schedule pg_cron-style cleanup via a prune function (callable from
--        the existing scheduled pruner pattern in 0015)
--      - swap the public-read policy to read only the bucketed view defined
--        here, which truncates coordinates to 3 decimals (~110 m) and hides
--        the raw row.
--
-- All three are forward-only — the dropped columns are not recoverable from
-- the migration. Run a DB backup before applying.

-- =========================================================================
-- 1. api_keys.owner_email -> owner_email_hash
-- =========================================================================

create extension if not exists pgcrypto;

alter table api_keys add column if not exists owner_email_hash text;

-- Backfill any existing rows (no-op on fresh installs).
update api_keys
   set owner_email_hash = encode(digest(lower(owner_email), 'sha256'), 'hex')
 where owner_email is not null
   and owner_email_hash is null;

alter table api_keys drop column if exists owner_email;
create index if not exists idx_api_keys_owner_email_hash
  on api_keys (owner_email_hash)
  where owner_email_hash is not null;

comment on column api_keys.owner_email_hash is
  'SHA-256 hex of lower(email). Operators hash inbound emails before lookup. Never store the plaintext.';

-- =========================================================================
-- 2. geocode_cache — drop raw address columns
-- =========================================================================

alter table geocode_cache drop column if exists query;
alter table geocode_cache drop column if exists display_name;

comment on table geocode_cache is
  'query_hash -> (lat, lon) lookup. We deliberately do not store the raw user input — that would re-identify the requester when joined with solar_assessments.';

-- =========================================================================
-- 3. solar_assessments — TTL + coordinate truncation view
-- =========================================================================

alter table solar_assessments
  add column if not exists expires_at timestamptz
    generated always as (ts + interval '365 days') stored;

create index if not exists idx_solar_assessments_expires_at
  on solar_assessments (expires_at);

-- Prune rows past their TTL. Service role only; callable from a scheduled
-- job (Vercel cron / GitHub Actions) the same way prune_api_request_log is.
create or replace function public.prune_solar_assessments()
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  removed integer;
begin
  delete from solar_assessments
   where expires_at < now()
  returning 1 into removed;
  get diagnostics removed = row_count;
  return coalesce(removed, 0);
end;
$$;

revoke all on function public.prune_solar_assessments() from public, anon, authenticated;
grant execute on function public.prune_solar_assessments() to service_role;

-- Bucketed view: truncate lat/lon to 3 decimals (~110 m at PR latitudes) so
-- a single assessment row can't pinpoint a property. The view drops the
-- per-row id so callers can't re-join with anything else to recover precision.
create or replace view solar_assessments_public as
  select round(lat::numeric, 3) as lat_bucket,
         round(lon::numeric, 3) as lon_bucket,
         date_trunc('day', ts)  as day,
         monthly_kwh_input,
         system_kw,
         annual_kwh_est,
         monthly_savings_est,
         payback_years,
         battery_kwh_rec,
         score,
         financial_score,
         resilience_score,
         source_version
    from solar_assessments
   where expires_at >= now();

grant select on solar_assessments_public to anon, authenticated, service_role;

-- Lock down the raw table. Service role keeps full access (used by the
-- assessment endpoint to insert + by ops queries); anon/authenticated lose
-- their public-read grant and use the view instead.
drop policy if exists public_read_solar on solar_assessments;
revoke select on solar_assessments from anon, authenticated;

comment on view solar_assessments_public is
  'Coordinates truncated to 3 decimals (~110 m) and grouped by day. Use this view for any public-facing analytics; the raw solar_assessments table is service-role only.';
