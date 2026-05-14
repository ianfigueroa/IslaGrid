-- Per-plant generation + island fuel mix, scraped from Genera PR's public
-- dashboard (https://genera-pr.com/data-generacion).
--
-- Genera publishes per-unit output gauges grouped into:
--   base       - "Flota del Sistema de Generación" (San Juan, Costa Sur, ...)
--   peak       - "Suministros Pico" / peaker units
--   backup     - "Unidades de Resguardo"
--   private    - "Productores Privados" (EcoEléctrica, AES)
--   renewable  - "Renovables / Suministro Renovable" (Solar, Viento, Hidro, ...)
-- plus a fuel-mix bar chart (Bunker / Diesel / LNG / Coal / Renew %).
--
-- One row per plant per ingest run, and one row per fuel per run. The
-- `grid_snapshots` table already covers system totals — these two tables add
-- the breakdown that powers the per-plant dashboard (Module 3).

create table if not exists plant_snapshots (
  id              bigserial primary key,
  ts              timestamptz not null default now(),
  plant_name      text not null,
  category        text not null check (
                    category in ('base','peak','backup','private','renewable','unknown')
                  ),
  output_mw       numeric,
  source          text not null default 'genera-pr.com',
  raw_key         text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_plant_snapshots_name_ts
  on plant_snapshots (plant_name, ts desc);
create index if not exists idx_plant_snapshots_ts
  on plant_snapshots (ts desc);

alter table plant_snapshots enable row level security;
create policy public_read_plant_snapshots
  on plant_snapshots for select to anon, authenticated using (true);

create or replace view plant_latest as
  select distinct on (plant_name)
    plant_name, category, output_mw, source, ts, raw_key
  from plant_snapshots
  order by plant_name, ts desc;
grant select on plant_latest to anon, authenticated;


create table if not exists fuel_mix_snapshots (
  id              bigserial primary key,
  ts              timestamptz not null default now(),
  fuel_type       text not null,            -- bunker | diesel | lng | coal | renewable
  pct             numeric,                  -- 0-100
  source          text not null default 'genera-pr.com',
  raw_key         text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_fuel_mix_ts
  on fuel_mix_snapshots (ts desc);

alter table fuel_mix_snapshots enable row level security;
create policy public_read_fuel_mix_snapshots
  on fuel_mix_snapshots for select to anon, authenticated using (true);

create or replace view fuel_mix_latest as
  select distinct on (fuel_type)
    fuel_type, pct, source, ts, raw_key
  from fuel_mix_snapshots
  order by fuel_type, ts desc;
grant select on fuel_mix_latest to anon, authenticated;
