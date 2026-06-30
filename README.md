# IslaGrid

**A source-labeled map of Puerto Rico's electric grid.** Live demand, generation, reserves, and fuel mix; outage and weather overlays; per-municipality reliability scorecards; and tools for bills, solar, and battery sizing. Every number on screen has a source label and an "as of" timestamp.

> When an upstream source is down, IslaGrid shows the last good value, marks it stale, and says when it was read instead of guessing.

---

## What it does

- **Live grid map**: a MapLibre map of the island with toggleable overlays for outages, plant status, weather alerts, active hurricanes, demand, and per-municipality risk.
- **Status sidebar**: current demand / generation / reserves and a **fuel mix** breakdown built from per-plant snapshots.
- **Reliability scorecards**: a per-municipality page (`/m/[id]`) with SAIFI/SAIDI-style reliability metrics rolled up daily.
- **Outage events**: structured outage events extracted from LUMA's updates, with rule-based cause classification and restoration-ETA ranges.
- **Outage risk**: a rule-based heuristic score per municipality, labeled "Heuristic" in the UI. A LightGBM training pipeline with isotonic calibration is in `ingestion/ml/`, but it is gated on having enough labeled outages and has not trained a model yet (see `docs/MODEL_REPORT.md`).
- **Consumer tools**: a bill estimator (`/bill`), Solar Lens (`/solar`, PVWatts + PREB rates), and battery sizing (`/battery`), built on plain functions in `lib/`.
- **Storm mode**: a low-bandwidth PWA (`/disaster`) for when the network is degraded.

## How it's built

- **Scrapers that expect breakage.** Puerto Rico's grid data comes from LUMA and Genera HTML pages and government APIs that go into maintenance, blank their values, and move without notice. The scrapers save **raw snapshots before parsing** and mark stale data. The longer comments in `ingestion/` explain the upstream breakages they work around.
- **Source labels everywhere.** A central `SourceLabel` type (`official | estimated | community | unverified`) and a freshness SLO live in `lib/sources.ts`, and every value shown in the UI is tagged with one.
- **The whole pipeline.** 42 Python ingestion modules, 32 SQL migrations, 37 Next.js API routes, and a React/MapLibre UI, running on free tiers.
- **Scheduled jobs.** 10 scheduled GitHub Actions workflows handle ingestion, risk inference, daily rollups, freshness checks, and data pruning. Three more are manual backfills, plus one for CI.

## Architecture

```
Upstream sources                Ingestion (Python 3.12, GitHub Actions cron)
  LUMA / Genera HTML  ─┐         ingestion/src/sources/*   scrape + snapshot raw
  datos.pr.gov API     ├──────▶  ingestion/src/pipeline/*  merge · classify · roll up
  NWS / NHC / PVWatts ─┘         ingestion/ml/*            LightGBM train + predict (gated)
                                        │
                                        ▼
                                 Supabase Postgres + PostGIS
                                        │
                                        ▼
                          Next.js API routes  (cached JSON, revalidate 20-60s)
                                        │
                                        ▼
                       React + MapLibre GL UI  (the control room)
```

See `docs/RUNBOOK.md` for operational detail.

## Stack

| Layer | Tech |
|---|---|
| Frontend + API | Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, MapLibre GL JS |
| Database | Supabase Postgres + PostGIS |
| Cache | Upstash Redis (hot `grid_status` only) |
| Object storage | Cloudflare R2 (raw HTML/PDF/JSON snapshots) |
| Ingestion | Python 3.12 (Playwright + httpx + selectolax), LightGBM |
| Hosting / scheduling | Vercel + GitHub Actions cron |
| Cost target | **$0/month** on free tiers |

## Getting started

```bash
git clone https://github.com/ianfigueroa/IslaGrid.git
cd IslaGrid
npm install
npm run dev                 # http://localhost:3000
```

The UI runs without any env vars. With no Supabase configured, the API routes return empty payloads with `reason: "supabase_unconfigured"` and the panels show empty states, so there is no live data until you connect a database. To connect real infrastructure, copy `.env.example` to `.env.local` and fill it in (see `docs/SETUP.md`).

The Python ingestion side lives in `ingestion/` with its own `pyproject.toml`:

```bash
pip install -e 'ingestion[dev]'
pytest ingestion/tests/
```

### Key pages

- `/`: the map-first control room (the app)
- `/grid`: island totals, plants table, forecast
- `/m/[id]`: per-municipality reliability scorecard
- `/bill`, `/solar`, `/battery`: consumer tools
- `/attribution`: every data source, with license + link

## Data rules

1. Every number on screen carries a source label and an "as of" timestamp.
2. Raw data is saved to object storage **before** parsing.
3. Predictions are labeled. If a trained model's calibration can't be trusted, the heuristic stays in use.
4. NREL solar data displays its 2015-2017 LiDAR vintage.
5. No pole-, transformer-, or feeder-level data is published, for public-safety and privacy reasons.
6. Community reports are aggregated to H3 res-7 cells; exact locations are never exposed.
7. Rule-based scoring is labeled "Heuristic" in the UI, not "AI".

## Repository layout

```
app/                  Next.js App Router: pages, components, 37 API routes
lib/                  Source labels, Supabase client, domain logic (bill/solar/battery)
ingestion/            Python: scrapers, pipelines, ML; scheduled by .github/workflows/
supabase/migrations/  32 SQL migrations
docs/                 Data sources, runbook, model report, privacy/ToS/attribution
.github/workflows/    CI + 13 ingestion/ML/maintenance jobs
```

## License

MIT for the code. Upstream data carries its own attribution requirements, see `docs/ATTRIBUTION.md`.
