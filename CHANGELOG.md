# Changelog

Notable changes per release. The active branch is `main`; we don't tag releases yet, so dates are commit dates.

## Unreleased (2026-05-22)

### Fixed
- **FUEL MIX widget legend**: fuel name no longer collides with the MW number at narrow panel widths. Legend collapses to a single column under `sm:`. (`app/(map)/_components/FuelMixBar.tsx`)
- **Risk filter race on first paint**: with the Risk filter default-on, the choropleth used to render only after the user toggled it off and back on. `addDataLayers` is now awaitable and the overlay loaders wait for the `municipalities` source before running. Same fix covers Demand and other muni-dependent overlays. (`app/(map)/_components/GridMap.tsx`)
- **"Updates" pill overlapped Legend & Layers toolbar**: moved to `bottom-28 left-3` (above the Legend, clear of the toolbar) with `z-30`. Expanded panel anchors upward. (`app/(map)/_components/RecentChangesCard.tsx`)
- **`maybe_single` typo** previously crashed cause classifier, restoration ETA, and vulnerability scoring on every event lacking weather/grid context. (`ingestion/src/pipeline/{cause_classifier,restoration_eta,vulnerability}.py`, commit `f0dcc91`)

### Added
- **Per-pipeline ingest health**: new `/api/grid/ingest-health` endpoint and an extended `freshness-check.yml` workflow that fails loud when any individual pipeline (Genera, LUMA, outage map, weather, predict-outage…) is older than 2× its expected cadence — instead of only checking the merged snapshot age.
- **Fuel-mix percentages validated**: `genera_pr.py` now logs and renormalizes when the five scraped fuel percentages don't sum to 100±2%. Also logs any plant Genera renders that isn't in `PLANTS_BY_CATEGORY` so category drift is observable.
- **Whole-word municipality matcher**: `_find_municipality` in `outage_events.py` switched from substring (`"san-juan" in text`) to dash-bounded regex word boundaries — eliminates "san-juan" matching "san-juanito" etc. Pytest regression in `ingestion/tests/`.
- **Battery sizing**: added surge headroom (per-appliance `surgeMultiplier`), recommended inverter wattage, and three battery chemistries (LFP / NCA / LTO). Battery page accepts `?from=solar&kw=N` to pre-fill from a Solar Lens hand-off.
- **Solar Lens financial depth**: 25-year cash-flow projection with degradation + utility rate escalator + discount rate, returning NPV and discounted payback. New `evaluateFinancing()` compares cash / loan / lease / PPA scenarios.
- **Real per-muni outage hours in Solar resilience**: the assessor now looks up the nearest municipality's rolling 12-month outage hours (from `municipality_outage_daily`) instead of using a flat 6 h/mo island-wide default. Falls back gracefully when data is missing.
- **Grid dashboard clarity**: `IslandTotals` shows the source's display name (not the raw slug) and has explanatory tooltips on Demand / Generation / Reserve / Capacity / Next hour / Peak labels.
- **Shared helpers**: `lib/format.ts` (currency, kWh, MW, %, hours, years) and `lib/hooks/use-current-rate.ts` (Bill + Solar both used to inline the PREB-rate fetch).
- **`CLAUDE.md`** and this `CHANGELOG.md`.

### Security
- **SEC#1** PII hardening migration `0027_pii_hardening.sql`: drop `api_keys.owner_email` (replaced with SHA-256 `owner_email_hash`), drop `geocode_cache.query` + `display_name` (raw addresses were a re-identification surface joined to solar_assessments), and add 365-day TTL + bucketed `solar_assessments_public` view (3-decimal coords ≈110 m) to `solar_assessments`. Raw `solar_assessments` table is now service-role only. `lib/geocode.ts` updated to not write the dropped columns.
- **SEC#2** Stripped `error.message` from 5xx bodies in 8 routes (`cron/luma-outages`, `outages/feeders`, `planned-work`, `reports`, `reports/aggregate`, `updates`, `public/community-reports/aggregate`, `public/generation/current`, `public/grid-status`, `public/outage-risk`, `public/planned-work`, `public/reserves/current`). Full errors logged server-side via `console.error` with route prefix.
- **SEC#3** Cron bearer token now compared with `crypto.timingSafeEqual` (length-equalized) in `app/api/cron/luma-outages/route.ts`.
- **SEC#4** Bumped direct `postcss` to `^8.5.10` + added `overrides.postcss` in `package.json` to clear the `GHSA-qx2v-qp2m-jg93` XSS transitive vuln from Next 16. `npm audit --omit=dev` is now clean.
- **SEC#5** New migration `0028_api_keys_audit.sql`: insert-only `api_keys_audit` table populated by an after-insert/update/delete trigger so key rotations, tier swaps, and revokes are forensically traceable. Service-role only.
- **SEC#9** Centralized Playwright launch args into `ingestion/src/sources/_playwright.py` with explicit threat-model docs explaining why `--no-sandbox` is acceptable in the ephemeral GHA container; added `--disable-dev-shm-usage` and `--disable-gpu` for stability. All five scrapers updated to import the shared `BROWSER_ARGS`.
- **SEC#10** `luma_bps_pdf._find_latest_pdf` now `urlparse()`s every regex hit and only returns URLs on `lumapr.com` / `www.lumapr.com` — defense in depth even though the regex is host-pinned.
- **SEC#11** `lib/geocode.ts` now sleeps to honor Nominatim's published 1 req/s policy (per-process throttle, ≥1100 ms between calls) before any cache-miss call.
- **SEC#12** `lib/public-api.ts` error logger now emits a narrowed `{name, message, stack[:4]}` shape instead of the raw `Error` object so credentials/URLs in deep frames don't land in log aggregators.

### Refactored
- **GridMap extraction (partial, in-progress)**: pulled the basemap/style construction into `app/(map)/_components/map-layers/style.ts`, the layer visibility rules into `map-layers/visibility.ts`, and the per-layer color palettes into `map-layers/palette.ts`. GridMap.tsx dropped from 1367 → 1185 lines. The remaining loaders (risk/demand/reports, weather, outages, interactions, data fetch) are still inline — see CLAUDE.md "Common tasks" for the planned full split.

### Notes
- No Vitest setup yet — pure-function tests for `lib/{bill,solar,battery,format}.ts` are a follow-up.
- NWS alerts remain island-wide. Per-municipality UGC mapping needs a UGC→muni lookup file; tracked as TODO in `nws_weather.py`.
