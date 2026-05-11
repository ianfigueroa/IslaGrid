-- Tag every community_reports row with its municipality_id so the scorecard
-- can show a per-muni count without a spatial join. Resolved at insert time
-- by /api/reports POST via point-in-polygon against the geojson.

alter table community_reports
  add column if not exists municipality_id text;

create index if not exists idx_reports_muni_ts
  on community_reports (municipality_id, ts desc);

-- Recreate the public view to expose municipality_id. Still aggregated, still
-- no lat/lon. The 24h window stays the same.
drop view if exists community_reports_public;

create or replace view community_reports_public as
  select municipality_id,
         h3,
         type,
         count(*)::int  as report_count,
         max(ts)        as latest_ts
    from community_reports
   where ts > now() - interval '24 hours'
   group by municipality_id, h3, type;

grant select on community_reports_public to anon, authenticated;
