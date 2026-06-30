# IslaGrid

**A real-time, source-labeled map of Puerto Rico's electric grid.** Live demand, generation, reserves, and fuel mix; outage and weather overlays; per-municipality reliability scorecards; and consumer tools for bills, solar, and battery sizing — every number on screen carries a source label and an "as of" timestamp.

> Built around one rule: **never fabricate a number.** When an upstream source is down, IslaGrid shows the last good value, flags it stale, and says when it was read — instead of guessing.

<!-- Drop a screenshot here once you have one — it's the first thing a visitor looks at:
![IslaGrid control room](docs/screenshot.png)
-->

---

## What it does

- **Live grid map** — a MapLibre map of the island with toggleable overlays for outages, plant status, weather alerts, active hurricanes, demand, and per-municipality risk.
- **Status sidebar** — current demand / generation / reserves and a live **fuel mix** breakdown, derived from per-plant snapshots.
- **Reliability scorecards** — a per-municipality page (`/m/[id]`) with SAIFI/SAIDI-style reliability metrics rolled up daily.
- **Outage intelligence** — structured outage events extracted from official updates, with heuristic cause classification and restoration-ETA estimates.
- **6-hour outage forecast** — a LightGBM model with isotonic calibration; when the calibrator can't be trusted, it transparently falls back to a labeled heuristic rather than shipping a bad probability.
- **Consumer tools** — a bill estimator (`/bill`), Solar Lens (`/solar`, PVWatts + PREB rates), and battery sizing (`/battery`), each built on pure, testable functions in `lib/`.
- **Storm mode** — a low-bandwidth PWA (`/disaster`) for when the network is degraded.

## Why it's interesting (the engineering story)

This is a full data product, not a dashboard skin:

- **A self-defending scraping pipeline.** Puerto Rico's grid data comes from LUMA and Genera HTML pages and government APIs that go into maintenance, blank their values, and move without notice. The scrapers save **raw snapshots before parsing**, flag stale data loudly, and degrade gracefully. The dense "why" comments in `ingestion/` are scar tissue from real upstream breakages.
- **Honesty as a system constraint.** A central `SourceLabel` type (`official | estimated | community | unverified`) and a freshness SLO live in `lib/sources.ts`, and every surfaced value is tagged. Stale flags are loud by design.
- **End-to-end ownership.** 41 Python ingestion modules → 32 SQL migrations → 37 Next.js API routes → a React/MapLibre UI, all wired together and running on free tiers.
- **Runs itself for free.** 14 scheduled GitHub Actions workflows handle ingestion, ML inference, daily rollups, freshness checks, and data pruning — no servers to babysit.

## Architecture

```
Upstream sources                Ingestion (Python 3.12, GitHub Actions cron)
  LUMA / Genera HTML  ─┐         ingestion/src/sources/*   scrape + snapshot raw
  datos.pr.gov API     ├──────▶  ingestion/src/pipeline/*  merge · classify · roll up
  NWS / NHC / PVWatts ─┘         ingestion/src/ml/*        LightGBM predict + train
                                        │
                                        ▼
                                 Supabase Postgres + PostGIS
                                        │
                                        ▼
                          Next.js API routes  (cached JSON, revalidate 20–60s)
                                        │
                                        ▼
                       React + MapLibre GL UI  (the control room)
```

See `CLAUDE.md` for the full module map and `docs/RUNBOOK.md` for operational detail.

## Stack

| Layer | Tech |
|---|---|
| Frontend + API | Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, MapLibre GL JS |
| Database | Supabase Postgres + PostGIS |
| Cache | Upstash Redis (hot `grid_status` only) |
| Object storage | Cloudflare R2 (raw HTML/PDF/JSON snapshots) |
| Ingestion | Python 3.12 (Playwright + httpx + selectolax), LightGBM |
| Hosting / scheduling | Vercel + GitHub Actions cron |
| Cost target | **$0/month** at MVP traffic |

## Getting started

```bash
git clone https://github.com/ianfigueroa/IslaGrid.git
cd IslaGrid
pnpm install
pnpm dev                    # http://localhost:3000
```

**No setup required to evaluate the UI.** Without env vars the app runs in **demo mode** — the API routes return realistic placeholder data so you can click through the whole interface without provisioning Supabase, R2, or Redis. To connect real infrastructure, copy `.env.example` to `.env.local` and fill it in (see `docs/SETUP.md`).

The Python ingestion side lives in `ingestion/` with its own `pyproject.toml`:

```bash
pip install -e 'ingestion[dev]'
pytest ingestion/tests/
```

### Key pages

- `/` — the map-first control room (the app)
- `/grid` — island totals, plants table, forecast
- `/m/[id]` — per-municipality reliability scorecard
- `/bill`, `/solar`, `/battery` — consumer tools
- `/attribution` — every data source, with license + link

## Honesty rules (non-negotiable, project-wide)

1. Every number on screen carries a source label and an "as of" timestamp.
2. Raw data is saved to object storage **before** parsing. Always.
3. Predictions are labeled. When the ML model's calibration is untrustworthy, IslaGrid falls back to a transparent heuristic instead of shipping a misleading probability.
4. NREL solar data displays its 2015–2017 LiDAR vintage.
5. No pole-, transformer-, or feeder-level data is published — public-safety + privacy.
6. Community reports are H3 res-7 aggregated; exact location is never exposed.
7. The word "AI" is never used in the UI for rule-based scoring — the honest label is "Heuristic."

## Repository layout

```
app/                  Next.js App Router — pages, components, 37 API routes
lib/                  Source labels, Supabase client, pure domain logic (bill/solar/battery)
ingestion/            Python — scrapers, pipelines, ML; scheduled by .github/workflows/ingest-*
supabase/migrations/  32 SQL migrations
docs/                 Data sources, runbook, privacy/ToS/attribution
.github/workflows/    CI + 14 ingestion/ML/maintenance jobs
```

## License

MIT for the code. Upstream data carries its own attribution requirements — see `docs/ATTRIBUTION.md`.
