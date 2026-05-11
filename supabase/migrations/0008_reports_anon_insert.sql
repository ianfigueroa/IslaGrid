-- Phase 8 community reports: enable anonymous inserts (privacy preserved by
-- (a) only requiring an H3 cell — never an exact lat/lon, and
-- (b) the public view `community_reports_public` already aggregates by cell.

-- 1. Allow anon inserts where user_id is null. Authenticated users still go
-- through the existing policy that requires auth.uid() = user_id.
drop policy if exists reports_insert on community_reports;

create policy reports_anon_insert
  on community_reports
  for insert
  to anon
  with check (user_id is null);

create policy reports_auth_insert
  on community_reports
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- 2. Extend the type enum with the two missing report kinds from the plan.
alter table community_reports
  drop constraint if exists community_reports_type_check;

alter table community_reports
  add constraint community_reports_type_check
  check (type in (
    'no_power','low_voltage','flicker','transformer',
    'pole','cable','tree','restored',
    'crew_seen','appliance_damaged'
  ));

-- 3. Helpful index for aggregate queries that group by H3 + type.
create index if not exists idx_reports_type_ts
  on community_reports (type, ts desc);
