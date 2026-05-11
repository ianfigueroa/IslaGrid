-- Phase 8: outage events extracted from LUMA announcements, and a typed
-- view that tags every official_updates row with a tier so the timeline
-- UI can render official / planned-work / unverified separately without
-- duplicating logic.

create table if not exists outage_events (
  id              text primary key,         -- hash of (source, started_at, body[:120])
  municipality_id text references municipalities(id) on delete set null,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  kind            text not null check (kind in ('planned','unplanned','restored','unknown')),
  source          text not null,
  source_url      text,
  snippet         text,
  raw_key         text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_outage_events_started   on outage_events (started_at desc);
create index if not exists idx_outage_events_municipal on outage_events (municipality_id, started_at desc);

alter table outage_events enable row level security;
create policy public_read_outage_events on outage_events for select to anon, authenticated using (true);

-- Convenience view: classify every update into a tier the UI cares about.
-- A row's `tier` drives the visual treatment in UpdateTimeline.tsx.
create or replace view official_updates_tiered as
  select
    id, ts, source, category, text, url,
    case
      when source like 'social.%'             then 'unverified'
      when category = 'planned-work'          then 'planned'
      when source like '%/avisos'             then 'announcement'
      else 'official'
    end as tier
  from official_updates;

grant select on official_updates_tiered to anon, authenticated;
