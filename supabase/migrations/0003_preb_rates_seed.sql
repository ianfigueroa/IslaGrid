-- Adjust preb_rates to allow multiple categories per effective date,
-- then seed Q1 2026 PREB-approved rate components.
--
-- The line items drive lib/rates.ts and the bill calculator (Phase 6).
-- Refresh quarterly when PREB issues a new order.
--
-- Source for the $209.85 expected residential bill (800 kWh):
--   https://energia.pr.gov/wp-content/uploads/sites/7/2025/11/20251125-AP20230003-LUMAs-Revised-Motion.pdf

-- 0001 created `preb_rates` with `effective_date` as a sole PK, which
-- prevents storing one row per (date, category). Drop and recreate.
drop table if exists preb_rates cascade;

create table preb_rates (
  effective_date date     not null,
  rate_category  text     not null,
  rate_per_kwh   numeric  not null,
  source_url     text,
  notes          text,
  primary key (effective_date, rate_category)
);

alter table preb_rates enable row level security;
create policy public_read_rates on preb_rates for select to anon, authenticated using (true);

insert into preb_rates (effective_date, rate_category, rate_per_kwh, source_url, notes) values
  ('2026-01-01', 'residential_base',          0.13520, 'https://lumapr.com/current-rates-for-electric-service-in-puerto-rico/?lang=en', 'Base energy charge — PREB-approved'),
  ('2026-01-01', 'residential_fuel_adj',      0.07410, 'https://energia.pr.gov/en/current-rate/',                                       'Fuel adjustment — recalculated quarterly'),
  ('2026-01-01', 'residential_purchased_pwr', 0.04290, 'https://energia.pr.gov/en/current-rate/',                                       'Purchased-power adjustment'),
  ('2026-01-01', 'residential_fixed',         4.00000, 'https://lumapr.com/current-rates-for-electric-service-in-puerto-rico/?lang=en', 'Monthly customer charge (USD/month, not /kWh)'),
  ('2026-01-01', 'commercial_base',           0.14180, 'https://lumapr.com/current-rates-for-electric-service-in-puerto-rico/?lang=en', 'Commercial GS base — single-phase'),
  ('2026-01-01', 'commercial_fuel_adj',       0.07410, 'https://energia.pr.gov/en/current-rate/',                                       'Same fuel adjustment as residential'),
  ('2026-01-01', 'commercial_purchased_pwr',  0.04290, 'https://energia.pr.gov/en/current-rate/',                                       'Same PPA as residential'),
  ('2026-01-01', 'commercial_fixed',          7.50000, 'https://lumapr.com/current-rates-for-electric-service-in-puerto-rico/?lang=en', 'Commercial monthly customer charge');
