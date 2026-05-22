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

### Refactored
- **GridMap extraction (partial, in-progress)**: pulled the basemap/style construction into `app/(map)/_components/map-layers/style.ts`, the layer visibility rules into `map-layers/visibility.ts`, and the per-layer color palettes into `map-layers/palette.ts`. GridMap.tsx dropped from 1367 → 1185 lines. The remaining loaders (risk/demand/reports, weather, outages, interactions, data fetch) are still inline — see CLAUDE.md "Common tasks" for the planned full split.

### Notes
- No Vitest setup yet — pure-function tests for `lib/{bill,solar,battery,format}.ts` are a follow-up.
- NWS alerts remain island-wide. Per-municipality UGC mapping needs a UGC→muni lookup file; tracked as TODO in `nws_weather.py`.
