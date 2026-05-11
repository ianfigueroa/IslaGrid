-- Helper used by ingestion/src/scripts/seed_municipalities.py.
-- Accepts a GeoJSON Polygon/MultiPolygon string, converts to a PostGIS
-- MultiPolygon, and upserts the municipalities row.

create or replace function upsert_municipality(
  id text,
  name text,
  geom_geojson text
) returns void
language sql
security definer
as $$
  insert into municipalities (id, name, geom)
  values (
    upsert_municipality.id,
    upsert_municipality.name,
    st_multi(st_setsrid(st_geomfromgeojson(upsert_municipality.geom_geojson), 4326))
  )
  on conflict (id) do update
    set name = excluded.name,
        geom = excluded.geom;
$$;

revoke all on function upsert_municipality(text, text, text) from public;
grant execute on function upsert_municipality(text, text, text) to service_role;
