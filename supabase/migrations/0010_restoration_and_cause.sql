-- Phase 10 — restoration ETA and cause classifier.
--
-- Both are heuristic-only at this stage (no trained ML — see Phase 9 notes).
-- Storing predictions in their own tables (rather than denormalized onto
-- outage_events) keeps the pipeline auditable: model_version + reasons let us
-- replay why a specific number was emitted.

create table if not exists restoration_eta_predictions (
  outage_event_id  text primary key
                   references outage_events(id) on delete cascade,
  ts               timestamptz not null default now(),
  low_hours        numeric not null,
  high_hours       numeric not null,
  confidence       text   not null check (confidence in ('low','medium','high')),
  model_version    text   not null,                -- 'heuristic:eta-v1-YYYYMMDD'
  reasons          jsonb  not null default '[]'::jsonb
);
create index if not exists idx_eta_ts on restoration_eta_predictions (ts desc);

create table if not exists cause_predictions (
  outage_event_id  text primary key
                   references outage_events(id) on delete cascade,
  ts               timestamptz not null default now(),
  cause            text   not null check (cause in (
                     'weather','vegetation','planned_maintenance',
                     'generation_shortage','equipment','transmission',
                     'distribution','unknown'
                   )),
  confidence       text   not null check (confidence in ('low','medium','high')),
  model_version    text   not null,
  reasons          jsonb  not null default '[]'::jsonb
);
create index if not exists idx_cause_ts on cause_predictions (ts desc);

alter table restoration_eta_predictions enable row level security;
alter table cause_predictions enable row level security;

create policy public_read_eta   on restoration_eta_predictions for select to anon, authenticated using (true);
create policy public_read_cause on cause_predictions           for select to anon, authenticated using (true);
