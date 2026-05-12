-- ============================================================
-- 0021 — lock down function EXECUTE to service_role by default
-- ============================================================
--
-- Followup to 0020. RLS protects table reads from anon/authenticated, but
-- SQL functions bypass RLS entirely — a `security definer` function that
-- reads from api_keys would expose hashes to anon callers if execute is
-- granted by default. Postgres' default is `grant execute to public`, so
-- this migration revokes that and sets a closed default going forward.
--
-- If a future function genuinely needs public access (e.g. a public RPC for
-- the map), grant execute on it explicitly in the migration that creates
-- the function. service_role always has full access.

revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- service_role retains full execute via migration 0019's blanket grant +
-- alter default privileges. Re-state for completeness in case 0019 was
-- ever superseded.
grant execute on all functions in schema public to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
