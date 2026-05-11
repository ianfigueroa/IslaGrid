# Runbook

Operational notes for IslaGrid AI. Read before deploying, debugging, or shipping a new source.

---

## Monitoring baseline

| Surface | Tool | Free tier? | What to watch |
|---|---|---|---|
| Frontend errors + perf | Vercel Web Analytics | Yes | Cold-start latency, error rate, route-level perf |
| Backend (Next.js API routes) | Vercel Function Logs | Yes | 5xx rate, route latency |
| Database | Supabase Logs / SQL Editor | Yes | Slow queries, RLS failures, connection saturation |
| Ingestion | GitHub Actions run history | Yes | Workflow failures emailed to repo admins |
| Data freshness | `.github/workflows/freshness-check.yml` | Yes | Hits `/api/grid/status` every 30 min; fails if `as_of` > 15 min old |

The freshness-check workflow is the canary. If it stays green, the dashboard has fresh data. If it goes red, a source moved or a parser broke — investigate the most-recently-failed ingestion workflow first.

---

## Deployment

1. Push to `main` → Vercel auto-deploys.
2. PRs run `app-ci.yml` (lint + type-check + build). PRs cannot merge with a red build.
3. Supabase migrations are applied manually from `supabase/migrations/` via Supabase Studio or the Supabase CLI:

   ```
   supabase db push
   ```

4. Cloudflare R2 bucket `islagrid-raw` must exist before any ingestion workflow runs. Bucket layout: `raw/{source}/{yyyy}/{mm}/{dd}/`.

---

## Secrets

Stored as GitHub Actions secrets and Vercel project environment variables. Never committed.

| Name | Where | Used by |
|---|---|---|
| `SUPABASE_URL` | Vercel + GH Actions | API routes + ingestion |
| `SUPABASE_SERVICE_ROLE_KEY` | GH Actions only | ingestion writes |
| `SUPABASE_ANON_KEY` | Vercel | browser + API reads |
| `R2_ACCESS_KEY_ID` | GH Actions | raw snapshot uploads |
| `R2_SECRET_ACCESS_KEY` | GH Actions | raw snapshot uploads |
| `R2_BUCKET` | GH Actions | raw snapshot uploads |
| `R2_ENDPOINT` | GH Actions | raw snapshot uploads |
| `UPSTASH_REDIS_REST_URL` | Vercel | hot grid-status cache |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel | hot grid-status cache |
| `NWS_USER_AGENT` | GH Actions | NWS API requires identifying UA |

Never commit `.env.local`. `.env.example` is the only env file checked in.

---

## Common incidents

### `datos.pr.gov` returns 404 or redirects to `prits.pr.gov/pr-gov-mantenimiento`

This is a PR-government-wide maintenance redirect (observed 2026-05-11). Not under our control.

- Action: leave the ingestion workflow running. It logs the redirect, saves the maintenance HTML to R2 with the original timestamp, and writes no rows to `generation_snapshots`.
- UI behavior: plant-output values display `—` with a `Stale (Xm ago)` chip. The status banner reads `Generación: PR.gov en mantenimiento`.
- Recovery: the workflow will pick up automatically when `datos.pr.gov` returns 200.

### LUMA System Overview shows blank MW values

Observed 2026-05-11: LUMA's page itself says "El sistema que respalda esta página se encuentra en mantenimiento."

- Parser must check for the maintenance disclaimer string and treat the snapshot as `source-stale`, not an error.
- UI: same `Stale (Xm ago)` chip behavior.

### LUMA goes dark permanently

If the LUMA contract terminates and `lumapr.com` is taken down:

1. Mark all `luma_*` ingestion workflows as `disabled: true` in their YAML.
2. Update `docs/DATA_SOURCES.md` to point to the successor operator's pages.
3. Site banner: `LUMA data unavailable — showing generation-only view from datos.pr.gov.`
4. Add the successor operator as a new source under `ingestion/src/sources/`.

The data model and UI do not need to change.

### Operator-swap procedure (LUMA → successor)

The `luma_*` parsers honor a single env var so a domain swap does not require a
code change:

```
LUMA_OPERATOR_HOST=neweoperator.example.com   # no scheme, no trailing slash
```

- Set this in GitHub Actions repo secrets (used by all ingest workflows) and in
  Vercel project env (read by API routes that display the source label).
- The parsers compose URLs like `https://${LUMA_OPERATOR_HOST}/resumen-del-sistema/`.
- If the successor uses different page slugs (likely), update the path constants
  in each parser and add a new row to `docs/DATA_SOURCES.md`.
- Update `lib/sources.ts` `display` and `url` fields so the freshness chips
  attribute correctly.

### Vercel free-tier bandwidth (100 GB/mo) hits 80%

- Action: check Vercel Web Analytics for an unusual traffic source.
- If traffic is legitimate (e.g., a hurricane warning): consider upgrading to Pro temporarily, or pre-render `/api/grid/status` as a static JSON on Cloudflare R2 served via Cloudflare CDN.

### Supabase free-tier DB (500 MB) hits 80%

- Most likely culprit: `generation_snapshots` (12 plants × 288 inserts/day × ~50 bytes ≈ ~5 MB/month). Should not be the issue for a long time.
- If it is: add a retention policy — delete `generation_snapshots` older than 90 days. Raw data in R2 is the source of truth for backfill anyway.

---

## Replaying historical data

Every row in `generation_snapshots`, `grid_snapshots`, `planned_work`, and `official_updates` has a `raw_key` column pointing to a file in R2. To replay:

```
python -m ingestion.src.pipeline.replay --source datos_pr_gov --since 2026-05-01
```

The replay script downloads the raw bytes, runs the current parser, and `UPSERT`s into the table. Parser changes are always reversible because raw data is immutable.

---

## AEE/PREPA ArcGIS endpoint discovery (one-time)

The dashboard at
`https://aeepr.maps.arcgis.com/apps/dashboards/1995c773fceb468db8b7f7d34899df94`
hides its data behind FeatureServer/MapServer layers. To wire `aeepr_arcgis.py`:

1. Open the dashboard in Chrome/Firefox with DevTools → Network panel filtered
   on `FeatureServer` or `MapServer`.
2. Click the dashboard's filters / widgets to trigger layer queries. Copy each
   distinct `services*/rest/services/.../FeatureServer/<n>/query` URL.
3. Set GitHub secret `AEEPR_LAYERS` to those URLs as a comma-separated list.
4. The ingest workflow snapshots all layers daily; raw JSON lands in R2 at
   `raw/aeepr.maps.arcgis.com/yyyy/mm/dd/`.
5. Once layer schemas are known, update `aeepr_arcgis.py` to parse rows into
   `outage_labels` (Phase 9 label source).

## NREL developer.nrel.gov → developer.nlr.gov migration

NREL is migrating their developer API domain to `developer.nlr.gov` on
**2026-05-29**. The Solar Lens (Phase 11) is the only consumer. Before that
date, search any new code for `developer.nrel.gov` and replace. Old domain
will likely 301 for some window but plan to be off by 2026-06-15.

## On-call expectations (MVP)

There is no on-call rotation. MVP is single-developer. Failure emails from GitHub Actions land in `iantdm11@gmail.com`. Acknowledge within 24 hours; full investigation within 7 days. Public site has a banner at all times that says: *"Informational — not for operational decisions."*
