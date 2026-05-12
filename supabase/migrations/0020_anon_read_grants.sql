-- ============================================================
-- 0020 — anon + authenticated role read grants
-- ============================================================
--
-- Same root cause as 0019: Supabase normally auto-grants SELECT on every
-- new table to anon + authenticated, but the project setup we used
-- (with "Automatically expose new tables" off) skipped those. The per-table
-- RLS policies our migrations DO add only work AFTER the SELECT grant — RLS
-- is fine-grained access on top of an already-granted role.
--
-- This migration grants SELECT on all current and future tables to anon and
-- authenticated, then revokes it from sensitive tables (api_keys,
-- api_request_log) where service_role is the only allowed reader.
--
-- Safe to re-run; all statements are idempotent.

grant usage on schema public to anon, authenticated;

grant select on all tables in schema public to anon, authenticated;
grant usage on all sequences in schema public to anon, authenticated;

alter default privileges in schema public
  grant select on tables to anon, authenticated;
alter default privileges in schema public
  grant usage on sequences to anon, authenticated;

-- Sensitive tables — service_role only.
revoke all on api_keys         from anon, authenticated;
revoke all on api_request_log  from anon, authenticated;
