-- ============================================================
-- 0019 — service_role grants + clean re-seed for municipalities
-- ============================================================
--
-- Two problems this fixes:
--
-- 1. service_role didn't have INSERT/UPDATE/DELETE on existing tables
--    (Supabase normally auto-grants these; the "Automatically expose new
--    tables" toggle being off on project creation can leave gaps).
--    The ingestion runs as service_role, so without these grants every
--    write fails with "permission denied".
--
-- 2. The first seed used the COUSUB shapefile which breaks PR municipios
--    down into barrios (~939 features). We want the COUNTY product which
--    has exactly 78 features = the 78 municipios. This migration wipes
--    the polluted rows so the next seed run inserts clean data.
--
-- Safe to run on a freshly-created project too — TRUNCATE is a no-op on an
-- empty table and the GRANTs are idempotent.

-- ----- 1. Blanket grants to service_role -----
--
-- Service role bypasses RLS but still needs table-level grants. These are
-- what Supabase ships by default; we re-state them to recover from any
-- earlier revocation.

grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- And: every FUTURE table/sequence/function gets the same grants.
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant all on functions to service_role;

-- Anon + authenticated keep their narrow SELECT-only grants from the
-- per-table policies. We do NOT widen those.

-- ----- 2. Wipe polluted municipalities + everything that references them -----
--
-- CASCADE drops rows in h3_cells, weather_snapshots, outage_events,
-- planned_work, etc. that have a FK to municipalities. At first-time setup
-- those tables are empty so this is a no-op.

truncate table public.municipalities restart identity cascade;

-- ----- 3. Strengthen upsert_municipality to also compute centroids -----
--
-- Migration 0017 added centroid_lon/centroid_lat columns. The seed RPC
-- didn't fill them, so a downstream UPDATE was needed. Bake the centroid
-- math into the RPC so the table is always in a consistent state after
-- a seed.

create or replace function upsert_municipality(
  id text,
  name text,
  geom_geojson text
) returns void
language sql
security definer
as $$
  insert into municipalities (id, name, geom, centroid_lon, centroid_lat)
  values (
    upsert_municipality.id,
    upsert_municipality.name,
    st_multi(st_setsrid(st_geomfromgeojson(upsert_municipality.geom_geojson), 4326)),
    st_x(st_centroid(st_multi(st_setsrid(st_geomfromgeojson(upsert_municipality.geom_geojson), 4326)))),
    st_y(st_centroid(st_multi(st_setsrid(st_geomfromgeojson(upsert_municipality.geom_geojson), 4326))))
  )
  on conflict (id) do update
    set name = excluded.name,
        geom = excluded.geom,
        centroid_lon = excluded.centroid_lon,
        centroid_lat = excluded.centroid_lat;
$$;

revoke all on function upsert_municipality(text, text, text) from public;
grant execute on function upsert_municipality(text, text, text) to service_role;
