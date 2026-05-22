# CLAUDE.md — IslaGrid agent guide

Use this file when you (Claude, or another coding agent) sit down with a cold context. The other docs in `docs/` are the authoritative human-facing references; this file is the cheat sheet to get oriented and avoid re-deriving structure that's already documented.

## What IslaGrid is

A Next.js 16 + Supabase + Python-ingestion app that visualizes the Puerto Rico electric grid in real time: a MapLibre map of the island with overlays for outages, plant status, weather, hurricanes, and per-municipality risk; a status sidebar with current demand / generation / reserves / fuel mix; per-municipality reliability scorecards; and consumer tools (Bill estimator, Solar Lens, Battery sizing). Every number is source-labeled — see `lib/sources.ts`.

## Where things live

```
app/                 # Next.js App Router
  (map)/             # Main map + sidebar (the homepage)
    _components/
      GridMap.tsx           # MapLibre instance + every overlay
      ControlRoom.tsx       # Top-left card stack, hamburger, layer state
      StatusPanel.tsx       # Right drawer: telemetry + FUEL MIX + updates
      OutagesPanel.tsx      # Right drawer: live outages
      LayerPills.tsx        # Bottom toolbar + Layers drawer
      MapLegend.tsx         # Bottom-left "what do colors mean" pill
      RecentChangesCard.tsx # Bottom-left "N updates in the last hour" pill
      FuelMixBar.tsx        # FUEL MIX widget inside StatusPanel
  grid/              # /grid — IslandTotals, PlantsTable, ForecastTable
  bill/              # /bill — electricity bill estimator (lib/bill.ts)
  solar/             # /solar — Solar Lens (lib/solar.ts)
  battery/           # /battery — battery sizing (lib/battery.ts)
  disaster/          # /disaster — low-bandwidth storm-mode PWA
  m/[id]/            # Per-municipality reliability scorecard
  api/               # 36+ route handlers — public + internal
    grid/status               # Merged island snapshot
    grid/fuel-mix             # Current fuel composition (derived from plant_snapshots)
    grid/ingest-health        # Per-pipeline freshness probe (added 2026-05)
    risk/municipalities       # Risk choropleth
    outages/summary           # Live outage counts + SAIFI/SAIDI
    solar/assess              # PVWatts + PREB rates → scored assessment
    rates/current             # Current PREB residential/commercial rate
    predictions/outage        # ML or heuristic 6h forecast
    weather/alerts            # NWS island alerts
    hurricanes/active         # Active Atlantic storms (GeoJSON)
lib/
  supabase.ts        # Supabase client factories + types
  sources.ts         # SOURCES table — every source label + freshness SLO
  rates.ts           # PREB rate fallback + activeRate picker
  bill.ts            # Bill estimator pure functions
  solar.ts           # Solar Lens pure functions (assess, NPV, financing)
  battery.ts         # Battery sizing pure functions + chemistries
  format.ts          # Shared currency/kWh/MW/% formatters
  hooks/
    use-current-rate.ts       # Single PREB-rate fetch hook (Bill, Solar)
  fuel-colors.ts     # Single source of truth for fuel slice colors
  reliability.ts     # MAX_OPEN_EVENT_HOURS and SAIFI/SAIDI helpers
ingestion/           # Python 3.12, runs in GitHub Actions
  src/
    sources/         # Per-source scrapers (Playwright + httpx + selectolax)
    pipeline/        # Aggregators, classifiers, ML predict/train
    ml/              # LightGBM training + inference
  tests/             # Pytest (small but growing)
supabase/migrations/ # Numbered SQL migrations
docs/                # Human-facing docs
.github/workflows/   # Scheduled ingest jobs + freshness-check + deploys
```

## How the data pipeline runs

1. **Sources** (Python scrapers in `ingestion/src/sources/`) hit upstream APIs / HTML and write raw rows to Supabase tables tagged with a `source` column matching `SOURCES` in `lib/sources.ts`. Schedules live in `.github/workflows/ingest-*.yml`.
2. **Pipelines** (`ingestion/src/pipeline/`) merge, classify, and rollup:
   - `merge_grid.py` reconciles LUMA + Genera into one authoritative `grid_snapshots` row (priority order in lines 54–63 of that file).
   - `outage_events.py` extracts structured outage records from `official_updates`.
   - `cause_classifier.py` / `restoration_eta.py` add cause + ETA heuristics.
   - `aggregate_municipality_daily.py` precomputes the daily scorecard rollup.
3. **ML** (`ingestion/ml/predict.py`) runs every 30 min, producing `outage_predictions_latest`. `outage_risk_model.py` loads the trained bundle and applies isotonic calibration; if the calibrator is flagged `calibration_warning=True` it falls through to a heuristic (see `predict.py` lines 73–84).
4. **API routes** read from Supabase and serve cached JSON. Many have `revalidate = 20–60` to balance freshness and load.
5. **UI** fetches the routes and renders. Map overlays use MapLibre + GeoJSON sources; the homepage map is `app/(map)/_components/GridMap.tsx`.

## Honesty rules (project-wide)

These predate this guide and are non-negotiable:

- Every public number carries a source label (`SourceLabel` in `lib/sources.ts`: `official | estimated | community | unverified`).
- We never fabricate a number. When LUMA is in maintenance, we show stale + the timestamp. When Genera's per-plant renewable data is missing, the plant row says "inferred" and the dashboard tooltip explains.
- Stale flags are loud: see `freshnessState()` in `lib/sources.ts` and the `source_stale` boolean on `grid_snapshots`.

## Common tasks

| Task | Where to start |
|---|---|
| Add a new map layer | `LayerPills.tsx` (toggle), `GridMap.tsx` `loadXInto()` + paint, `applyLayerVisibility()` |
| Add a new API route | `app/api/*/route.ts`, mirror the `revalidate` + `Cache-Control` pattern of `grid/status` |
| Add a new ingestion source | `ingestion/src/sources/<name>.py` + a workflow under `.github/workflows/ingest-<name>.yml` + a `SOURCES` entry |
| Add a new score / heuristic | Pure function in `lib/` first; UI consumes it. Don't put math in components. |
| Tweak the FUEL MIX widget | `app/(map)/_components/FuelMixBar.tsx` (legend) and `app/api/grid/fuel-mix/route.ts` (math) |
| Add a Vitest test | None set up yet; pytest is configured in `ingestion/pyproject.toml` (dev extra) for Python |

## Running it

- `pnpm dev` — Next dev server on :3000
- `pnpm build` — production build
- `pnpm type-check` — `tsc --noEmit`
- `pytest ingestion/tests/` — Python tests (install with `pip install -e 'ingestion[dev]'`)

## Tone for changes

- Keep comments dense around anything with a "why" — the codebase has gotten hit by Genera + LUMA scraping changes and the comments are what saved future-us each time.
- Match the existing one-line commit style. The commit author email used here is `ianfigueroa <ianfigueroa12345@gmail.com>`.
- Don't add framework dependencies casually. There's no Jest/Vitest yet on purpose.
