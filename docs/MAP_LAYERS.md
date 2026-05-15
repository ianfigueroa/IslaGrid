# Map layers — what ships now vs. follow-ups

_Last updated: 2026-05-15_

The map is built on **MapLibre GL JS** with a self-hosted **Protomaps** vector basemap (one `pr.pmtiles` file at `public/map/pr.pmtiles`, ~24 MB, OSM+Natural Earth, zoom 0–14). The style is generated from `@protomaps/basemaps` with a custom flavor — warm cream land + muted teal ocean in light, deep navy in dark. Every layer below traces to a real upstream source — no synthetic data.

## Layers shipped today

| Group | Layer | Source | Notes |
|---|---|---|---|
| Grid | Municipalities (status fill) | Computed from `grid_snapshots` | Choropleth, status-driven |
| Grid | Generation (plant points) | OSM via `/api/plants` + datos.pr.gov join | Fuel-colored, size by capacity |
| Grid | Infrastructure (substations) | OSM | Open data; community-mapped |
| Grid | Planned work | LUMA Planned Work scrape | Hourly cadence |
| Grid | Outage risk choropleth | `municipality_risk_latest` | Heuristic-v2; now includes hurricane lift + CI envelope |
| Grid | **Active outages (live)** | `outage_events` (last 24h, unended) | Sonar-ping CSS animation on each muni centroid |
| Grid | Demand (experimental) | `lib/demand.ts` proxy | Clearly labeled as estimate |
| Weather | **NWS alerts** | `api.weather.gov/alerts/active?area=PR` | GeoJSON polygons, color-coded by event |
| Weather | **Hurricane cone + track** | NHC via `tropycal` → `hurricane_active_latest` | Polygon + LineString, dashed cone stroke |
| Weather | **USGS earthquakes** | `earthquake.usgs.gov` FDSN | M≥2.5, last 7d, click → USGS page |
| Community | Reports (H3) | `community_reports_public` | Privacy-preserving aggregation |

## Custom animations

- **Outage pulses** — DOM markers with two staggered `sonar-ping` rings (CSS keyframes `islagrid-sonar`). Respect `prefers-reduced-motion: reduce`.
- **Hurricane cone breath** — `cone-breath` keyframe; available for the cone stroke if we want to enable later.
- **Critical-status pulse** — pre-existing `pulse-critical` keyframe on telemetry chips.

All animations are CSS, not WebGL — cheaper to maintain, no jank on low-end mobile.

## Filter rail

- **URL-persisted layer state** via `?layers=` (encoded in `LayerRail.tsx`). Share a link, get the same map state.
- **Four presets** at the top: Default / Storm / Solar / Reporter. Each stages a layer set; user can still toggle individual layers afterwards.
- Grouped by Grid / Weather / Community / Solar so the rail scales as we add layers.

## Source attribution

`/attribution` page enumerates every source with URL + license + last refresh. Every active layer also surfaces a chip on the bottom-right of the map.

## Deferred (follow-up PRs, with real reasons)

| Layer | Why deferred | What it needs |
|---|---|---|
| MRMS precipitation radar | Complex GeoTIFF→tile pipeline + 2-min cadence | A separate tile server (titiler + R2) |
| NDFD wind streamlines (WindGL) | Needs GRIB2→tiled vector pipeline | Either pre-compute vector tiles or fetch GRIB2 + decode in-browser via wgrib2-wasm |
| VIIRS Black Marble nighttime lights | Daily GeoTIFF, large | Tile pipeline + day/night masking |
| Blitzortung lightning strikes | WebSocket integration, CC-BY-NC licensing | Backend WS proxy + license attribution UX |
| Plant glow effect (radial gradient by output) | Pure cosmetic; current circles already encode capacity via radius | A custom MapLibre layer with a `circle-blur` paint + dynamic radius interpolated on `current_mw` |
| Cone-coverage % feature | Currently binary in/out; ML model would prefer % | Geopandas at runtime OR ray-stab sampling client-side |

Anything deferred above is in the [round-3 plan](../plans/i-want-you-to-whimsical-squirrel.md) — they were scoped out of this PR to keep it landable.

## How to verify

```bash
# Apply the new migrations:
supabase db push  # or apply 0015-0017 manually

# Run the new ingest sources (need SUPABASE_* + tropycal):
cd ingestion
pip install -e ".[hurricane]"
python -m src.sources.nhc_hurdat
python -m src.sources.luma_outage_map
python -m src.sources.bluesky_pr
python -m src.sources.mastodon_pr

# In the app:
npm run dev
# Open the map, toggle:
#   - "Storm" preset → cone + alerts + outages + planned work all on
#   - URL updates to ?layers=hurricane,outage-risk,outages-live,planned-work,weather-alerts,municipalities
```
