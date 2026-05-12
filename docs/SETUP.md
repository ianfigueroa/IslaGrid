# IslaGrid — Complete setup guide

_From an empty laptop to a live, production-deployed IslaGrid AI._

This is the master setup doc. It covers every service, every credential, every command you need to run, in order.

There are seven stages:

1. [Local prerequisites](#1-local-prerequisites)
2. [Supabase project](#2-supabase-project)
3. [Cloudflare R2 (raw archival)](#3-cloudflare-r2-raw-archival)
4. [Upstash Redis (rate limiting)](#4-upstash-redis-rate-limiting)
5. [Third-party API keys (NREL, etc.)](#5-third-party-api-keys)
6. [Run the app locally](#6-run-the-app-locally)
7. [Deploy to production](#7-deploy-to-production)
8. [Backfill + train the ML model](#8-backfill--train-the-ml-model) _(optional but recommended)_
9. [Operate the system](#9-operate-the-system)

Total time, first try: about **2 hours**. Subsequent setups (different env): about **30 minutes**.

Cost at the planned free tiers: **$0/month** for personal scale. Once you grow past the free tiers you're looking at maybe $20-40/month total for the production hosting.

---

## 1. Local prerequisites

Install on your machine (one-time):

| Tool | Why | Install |
|---|---|---|
| **Node.js 20+** | Next.js runtime | https://nodejs.org or `nvm install 20` |
| **Python 3.12+** | Ingestion pipelines | https://python.org or `pyenv install 3.12.7` |
| **Git** | Source control | https://git-scm.com |
| **Supabase CLI** _(optional)_ | Apply migrations locally | `brew install supabase/tap/supabase` or [docs](https://supabase.com/docs/guides/cli) |
| **Vercel CLI** _(optional)_ | Faster local deploys | `npm i -g vercel` |
| **GitHub CLI** _(optional)_ | Pushing the repo + secrets | `brew install gh` |

Clone the repo:

```bash
git clone <your-fork-url> islagrid
cd islagrid
npm install
cd ingestion && pip install -e ".[ml,hurricane,seed]" && cd ..
```

---

## 2. Supabase project

We use Supabase for Postgres + Auth + RLS + Storage. Free tier handles all of personal-scale usage.

### 2.1 Create the project

1. Sign up at https://supabase.com (free).
2. Click **New Project**.
   - **Name**: `islagrid` (or whatever)
   - **Database password**: generate one and save it in a password manager
   - **Region**: pick something close to your users. For PR + east-coast US: **us-east-1**.
   - Wait ~2 minutes for provisioning.

### 2.2 Grab the credentials

Project Settings → API:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`
- **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` _(NEVER expose this in the browser)_

Drop them into your local `.env.local` (for Next.js) and `ingestion/.env` (for Python). Copy `.env.example` to both as a starting point.

### 2.3 Enable PostGIS

Database → Extensions → search for **postgis** → toggle it on. We use it for municipality geometries and point-in-polygon lookups.

### 2.4 Apply migrations

There are 18 migrations under `supabase/migrations/`. Apply them in order — the file names are numbered.

**Easiest path (Supabase CLI):**

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

**Manual path** (no CLI): open Supabase → SQL Editor, paste each `supabase/migrations/00NN_*.sql` file in order, run it. Yes, this is tedious for 18 files — use the CLI if at all possible.

After they all run, you should have these tables (rough order they appear):

```
municipalities, h3_cells, grid_snapshots, official_updates,
plants, planned_work, weather_snapshots, municipality_risk_snapshots,
outage_events, social_unverified, preb_rates, geocode_cache,
solar_assessments, nrel_pvrdb_pr, restoration_eta_predictions,
cause_predictions, api_keys, api_request_log, infra_vulnerability_scores,
community_reports, hurricane_forecasts, luma_outage_snapshots,
eagle_i_outages, preb_filings, wayback_outage_history
```

Plus a handful of views (`municipality_risk_latest`, `luma_outage_latest`, `hurricane_active_latest`, etc.).

### 2.5 Seed the municipalities table

Puerto Rico has 78 municipalities. The seed loads them from Census TIGER 2024.

```bash
cd ingestion
python -m scripts.seed_municipalities  # uses geopandas (in [seed] extras)
```

Verify in Supabase → Table Editor → `municipalities`: 78 rows, each with a non-null `geom`.

If `centroid_lon`/`centroid_lat` are null on existing rows, migration `0017` includes an UPDATE to backfill them via `ST_Centroid`.

### 2.6 Mint your first API key (optional)

For testing the public API at `/api/public/**`:

```sql
-- Run in Supabase SQL Editor
insert into api_keys (name, tier, key_hash, key_prefix, rate_per_minute, rate_per_day)
values (
  'dev-test',
  'internal',
  -- See lib/api-keys.ts for how to compute this. Easiest: hit /api/admin/mint
  -- once we add that route, or do `node -e` with crypto.
  '<sha256 of your key>',
  '<first 8 chars of your key>',
  60,
  10000
);
```

The bearer string you give to API clients is the **raw key** (`ig_<prefix>_<secret>`) — we never store that, only its hash.

---

## 3. Cloudflare R2 (raw archival)

R2 stores raw bytes of every scrape (HTML, PDFs, ArcGIS JSON) so parser changes are replayable. Free tier: 10GB storage + class-A/B ops on the no-cost tier.

### 3.1 Create the bucket

1. Sign up at https://dash.cloudflare.com (free).
2. **R2 Object Storage** → **Create bucket** → name it `islagrid-raw`.
3. **Manage R2 API Tokens** → **Create API Token**:
   - Permissions: **Object Read & Write**
   - Bucket: `islagrid-raw`
   - Save the **Access Key ID** and **Secret Access Key**.

### 3.2 Env vars

```
R2_ACCOUNT_ID=<your account id, top of cloudflare dashboard>
R2_ACCESS_KEY_ID=<from step 3.1>
R2_SECRET_ACCESS_KEY=<from step 3.1>
R2_BUCKET=islagrid-raw
R2_ENDPOINT=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
```

### 3.3 Verify

```bash
cd ingestion
python -c "from src.pipeline.snapshot import save_raw; print(save_raw('test', b'hello'))"
```

Should print an R2 key like `raw/test/2026/05/12/1234-abcdef.bin`. Check the bucket in Cloudflare → file should be there.

---

## 4. Upstash Redis (rate limiting)

Required in production. Without it, the public API at `/api/public/**` returns HTTP 503 (fail-closed by design). In dev it passes through unbounded.

### 4.1 Create the database

1. Sign up at https://upstash.com (free).
2. **Create Database**:
   - **Type**: Regional (cheaper than Global, fine for our scale)
   - **Region**: pick the same one as your Supabase project
   - **TLS**: enabled
3. Copy the **REST URL** and **REST Token** from the database page.

### 4.2 Env vars

```
UPSTASH_REDIS_REST_URL=https://<id>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>
```

---

## 5. Third-party API keys

### 5.1 NREL (PVWatts — solar tool)

Free, instant.

1. https://developer.nlr.gov/signup → enter email
2. Receive key by email
3. Set `NREL_API_KEY` in env

Already targets the post-2026-05-29 host (`developer.nlr.gov`) by default. No need to change `NREL_API_HOST`.

### 5.2 Nominatim (geocoding)

No signup. Just respect the [usage policy](https://operations.osmfoundation.org/policies/nominatim/):

- Max 1 req/sec — we cache aggressively in `geocode_cache`
- Always send a real `User-Agent` with a real contact email — set `GEOCODER_UA`

### 5.3 NWS, USGS, NHC

All public domain, no key. NWS asks for an identifying `User-Agent` — `NWS_USER_AGENT`.

### 5.4 DOE EAGLE-I (historical outages)

For the ML training backfill (Block 6). One-shot ingest.

1. Find the latest ORNL release at https://figshare.com/articles/dataset/24237376
2. Copy the **direct download URL** to the most recent ZIP/CSV
3. Set `EAGLE_I_DATA_URL` to that URL

---

## 6. Run the app locally

```bash
# In repo root, with .env.local filled in
npm run dev
```

Open http://localhost:3000. You should see the map (even with an empty database — the API routes return honest empty payloads, not synthetic).

Run a single ingest job locally to populate the DB:

```bash
cd ingestion
# Set env (.env or export ...)
python -m src.sources.luma_system_overview   # current grid snapshot
python -m src.sources.luma_planned_work
python -m src.sources.nws_weather
python -m src.sources.osm_infrastructure     # one-shot
python -m src.sources.luma_outage_map
python -m src.sources.nhc_hurdat             # only useful during storm season
python -m src.pipeline.risk_features         # rolls everything up
```

Refresh the browser — you should see real numbers.

### Type-check + build

```bash
npx tsc --noEmit   # should print nothing
npx next build     # should finish clean
```

---

## 7. Deploy to production

### 7.1 Vercel (recommended for the Next.js app)

1. Push the repo to GitHub.
2. https://vercel.com → **Import Project** → pick your repo.
3. Framework preset: **Next.js** (auto-detected).
4. **Environment Variables**: paste everything from `.env.example` with real values.
   - Pay attention to `TRUST_PROXY=true` (Vercel sets `X-Forwarded-For`)
   - `NEXT_PUBLIC_SITE_URL` = your production URL, e.g. `https://islagrid.example.com`
5. Deploy.

### 7.2 Custom domain (optional)

1. Vercel → Project → **Settings → Domains** → Add your domain
2. Configure DNS at your registrar (CNAME or A records per Vercel's instructions)
3. Wait for SSL provisioning (~minutes)

### 7.3 GitHub Actions (for the ingestion cron jobs)

The repo has workflow files in `.github/workflows/`:

| Workflow | Cadence | Sources |
|---|---|---|
| `ingest-grid.yml` | every 10 min | LUMA System Overview, BPS, generation |
| `ingest-announcements.yml` | hourly | LUMA Avisos, LUMA Outage Map, NHC, Bluesky, Mastodon, outage events, restoration ETA |
| `ingest-weather.yml` | hourly | NWS |
| `ingest-osm.yml` | weekly | OpenInfraMap / OSM |
| `ingest-rates.yml` | weekly | PREB |
| `predict-outage.yml` | every 30 min | Per-muni risk features |
| `freshness-check.yml` | hourly | Alerts if any source goes stale |

**Required GitHub repo secrets** (Settings → Secrets and variables → Actions):

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
R2_ENDPOINT
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
LUMA_OPERATOR_HOST                  (optional override)
LUMA_OUTAGE_ARCGIS_URL              (optional override)
NREL_API_KEY                        (only if running the solar ingest from CI)
BLUESKY_KEYWORDS                    (optional override)
MASTODON_INSTANCE                   (optional override)
MASTODON_KEYWORDS                   (optional override)
```

Once secrets are in place, workflows fire on their cron schedules.

### 7.4 Smoke test

After first deploy:

- Visit your production URL — map renders
- `GET /api/grid/status` — returns `{snapshot: ..., reason: "ingest_pending"|null}`
- `GET /api/public/openapi.json` — returns OpenAPI 3.1 doc
- `GET /api/public/grid-status` (without API key) — should return data within anon rate limits OR 503 if Upstash isn't configured
- Hit any public route from a foreign Origin — should be allowed for `/api/public/**`, blocked for `/api/reports`

---

## 8. Backfill + train the ML model

_Optional, but the heuristic gets meaningfully sharper once a calibrated model lands. Run this in any week — it doesn't block any other feature._

### 8.1 One-shot backfill

```bash
cd ingestion

# DOE EAGLE-I — multi-GB, ~30 min download + upsert
python -m src.sources.eagle_i_history

# Wayback Machine snapshots of LUMA's outage page
python -m src.sources.wayback_outage_backfill --since 2022-01-01

# PREB filings
python -m src.sources.preb_filings
```

### 8.2 Check readiness

```bash
python -m scripts.train_outage_risk --start 2018-01-01 --end 2026-04-30
```

Expected:

```
Manifest looks ready. Pass --i-have-enough-data to actually train.
```

If it says "not ready", the error tells you exactly what's missing (more events / more time).

### 8.3 Train

```bash
mkdir -p out
python -m scripts.train_outage_risk \
  --start 2018-01-01 --end 2026-04-30 \
  --output ./out/outage_risk-v1.joblib \
  --i-have-enough-data \
  --upload-r2
```

You'll see real numbers print:

```
LightGBM: AUC train=0.86 calibrate=0.81
CatBoost: AUC train=0.84 calibrate=0.80
Winner on calibrate: lightgbm (AUC=0.81)
Test fold: AUC=0.79 Brier=0.018 ECE=0.032
Wrote bundle: ./out/outage_risk-v1.joblib
```

If ECE > 5%, the bundle is flagged `calibration_warning=True` and the runtime falls back to the heuristic. That's intentional — a miscalibrated model is worse than honest rules.

### 8.4 Deploy the model

Easiest path: have your production ingest pull the bundle from R2 on a daily cron and write it to `OUTAGE_RISK_MODEL_PATH`. The runtime loader caches it on first hit.

---

## 9. Operate the system

### 9.1 Daily checks

- Vercel → Deployments → last deploy is green
- Supabase → Database → Logs — no rate-limit errors
- GitHub Actions → all workflows green
- Visit `/attribution` — every source's freshness chip says "fresh"

### 9.2 When something goes stale

`freshness-check.yml` fires hourly. If a source goes stale it opens a GitHub issue with the source name + last-seen timestamp.

### 9.3 Rotating credentials

- **API keys**: change `API_KEY_PEPPER` in Vercel env → redeploy → every key is invalidated. Reissue.
- **Supabase service-role key**: regenerate in Supabase, update Vercel + GitHub secrets, redeploy.
- **R2 access keys**: regenerate in Cloudflare, update secrets.

### 9.4 Monitoring cost

- **Supabase**: free tier covers ~500MB DB + 50K monthly active users. Past that you're at $25/month for Pro.
- **R2**: 10GB free; we're conservative on retention so this shouldn't be exceeded for ~6 months.
- **Upstash**: 10K commands/day free.
- **Vercel**: free hobby tier or $20/month pro.
- **NREL / NWS / NHC / USGS**: free, public-domain.

### 9.5 What to NEVER do

- Hardcode any number that should come from a feed (lib/sources.ts is the source-of-truth list)
- Train the ML model on data with random splits (use temporal only)
- Mark anything as official that came from a third-party scraper (LumaTrack)
- Push to main without `npx tsc --noEmit` clean
- Commit `.env.local`, `ingestion/.env`, or anything matching `.env*` (the .gitignore already covers this — keep it that way)

---

## Quick-start cheat sheet

```bash
# First time, from scratch:
git clone <repo> && cd islagrid
npm install
cd ingestion && pip install -e ".[ml,hurricane,seed]" && cd ..
cp .env.example .env.local
cp .env.example ingestion/.env
# (fill in env vars from each service)

supabase link --project-ref <ref>
supabase db push
cd ingestion && python -m scripts.seed_municipalities && cd ..
npm run dev
```

```bash
# Production deploy:
git push origin main          # triggers Vercel
# Set all GitHub secrets per §7.3
# Set all Vercel env vars per §7.1
```

```bash
# Train the model:
cd ingestion
python -m src.sources.eagle_i_history
python -m src.sources.wayback_outage_backfill --since 2022-01-01
python -m scripts.train_outage_risk \
  --start 2018-01-01 --end 2026-04-30 \
  --output ./out/outage_risk-v1.joblib \
  --i-have-enough-data --upload-r2
```

That's everything. If anything in this doc is wrong or missing, file an issue or update this file.
