# IslaGrid AI

Public, source-labeled view of Puerto Rico's electric grid — demand, reserves, generation, planned work, and community reports.

**Live MVP scope:** Phases 0–5 (data registry, map shell, DB, grid dashboard via `datos.pr.gov` + LUMA, electric infrastructure map, planned-work feed). Everything else is deferred until traction.

## Status (2026-05-11)

- ⚠️ `datos.pr.gov` is currently in a PR-government-wide maintenance redirect. The pipeline still runs and saves raw snapshots — it just writes nothing to the DB until the source returns.
- ⚠️ LUMA System Overview page is up but the MW values are blank with a maintenance disclaimer. Parser flags these snapshots as stale.
- ⚠️ LUMA's operator contract is in active termination litigation; site may move Q3–Q4 2026. Successor-operator parser is a localized swap (see `docs/RUNBOOK.md`).

## Stack

- **Frontend + API:** Next.js 16 (App Router) + TypeScript + Tailwind v4 + MapLibre GL JS — deployed on Vercel free tier.
- **Database:** Supabase Postgres + PostGIS — free tier.
- **Object storage:** Cloudflare R2 — raw HTML/PDF/JSON snapshots, free tier.
- **Cache:** Upstash Redis — hot `grid_status` only, free tier.
- **Ingestion:** Python 3.12 scripts run by GitHub Actions cron (Vercel Hobby cron is daily-only).
- **Cost target:** $0/month for MVP traffic.

## Getting started

```bash
git clone <repo>
cd IslaGrid
npm install
npm run dev                     # http://localhost:3000
```

Without env vars, the app runs in **demo mode** — `/api/grid/status` and
`/api/updates` return realistic placeholder data so you can evaluate the UI
without provisioning any infrastructure. To connect to real Supabase / R2 /
Upstash, copy `.env.example` to `.env.local` and fill it in.

The Python ingestion side lives in `ingestion/` with its own `pyproject.toml`.

### Pages

- `/` — map-first control room (the application)
- `/attribution` — every data source we use, with license + link
- `/privacy` — privacy policy
- `/terms` — terms of service

## Repository layout

```
app/                  Next.js App Router (page, components, API routes)
lib/                  Source labels, Supabase client, H3 utilities
ingestion/            Python — scheduled by .github/workflows/ingest-*
supabase/migrations/  SQL migrations
docs/                 Data sources, runbook, privacy/ToS/attribution
design-system/        IslaGrid-specific design rules
public/geo/           Static GeoJSON (PR boundary, municipalities)
.github/workflows/    CI + ingestion + freshness-check
```

## Honesty rules

1. Every number on screen carries a source label and "as of" timestamp.
2. Raw data is saved to R2 **before** parsing. Always.
3. Status calculations are visible in `ingestion/src/pipeline/risk.py`. No hidden ML at v1.
4. NREL solar data displays its 2015–2017 LiDAR vintage.
5. No pole-, transformer-, or feeder-level data is published. Public-safety + privacy.
6. Community reports are H3 res-7 aggregated. Exact location is never exposed.
7. The word "AI" is not used in UI for rule-based scoring. The label is "Heuristic."

## License

TBD (likely MIT for code, attribution required for upstream data — see `docs/ATTRIBUTION.md`).
