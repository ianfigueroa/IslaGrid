# Data Sources

Every data source ingested by IslaGrid AI must be listed here with its source label, freshness SLO, failure mode, and degraded-state fallback.

If a number appears in the UI, its source row must exist in this table.

---

## Source-label vocabulary

| Label | Meaning |
|---|---|
| `official` | Comes from a regulated operator (LUMA, Genera PR, PREPA), a government agency (datos.pr.gov, NWS, PREB), or a public-domain government dataset (Census TIGER). |
| `estimated` | Computed by IslaGrid AI from official inputs (e.g., heuristic outage risk, computed reserve margins). |
| `community` | Submitted by users or volunteer mappers. Includes OpenStreetMap. |
| `unverified` | Scraped from a third party that does not publish a license or guarantee, or where the upstream itself disclaims accuracy. |

---

## Active sources (Phases 0–5)

### `datos.pr.gov` — Generation by Plant

| Field | Value |
|---|---|
| URL | `https://datos.pr.gov/datasourcev2/dsgeneracionporplanta` |
| Format | JSON (when service is up) |
| Update cadence | 5 minutes |
| Freshness SLO | 10 minutes |
| Source label | `official` |
| License/ToS | PR government public data; no explicit prohibition on machine access |
| Parser | `ingestion/src/sources/datos_pr_gov.py` |
| Raw key | `raw/datos-pr-gov/yyyy/mm/dd/HHMM-<uuid>.json` |
| Status (2026-05-11) | **In maintenance.** Redirects to `prits.pr.gov/pr-gov-mantenimiento`. |
| Degrades to | When down: show 0 plants live and rely on LUMA System Overview for demand/reserves. |

### LUMA — System Overview (Resumen del Sistema)

| Field | Value |
|---|---|
| URL | `https://lumapr.com/resumen-del-sistema/` (Spanish slug is canonical; `/system-overview/` redirects here) |
| Format | HTML, JS-rendered |
| Update cadence | Real-time-ish, but page itself warns numbers may be stale during back-end maintenance |
| Freshness SLO | 30 minutes |
| Source label | `official` |
| License/ToS | No published prohibition; precedent exists (`lumatrackpr.com`, `github.com/JakeKalstad/puerto-rico-electrical-data`) |
| Parser | `ingestion/src/sources/luma_system_overview.py` (Playwright) |
| Raw key | `raw/luma-system-overview/yyyy/mm/dd/HHMM-<uuid>.html` |
| Status (2026-05-11) | Page up, MW values **blank** with back-end-maintenance disclaimer. |
| Degrades to | If page returns blank values or is unreachable: dashboard shows last known values with `Stale (Xm ago)` chip. If LUMA contract terminates entirely: banner reads "LUMA data unavailable — showing generation-only view from datos.pr.gov." |

### LUMA — BPS Monitoring / Daily Availability

| Field | Value |
|---|---|
| URL | `https://lumapr.com/bps-monitoring/` (lists PDF reports at `/so_document/`) |
| Format | PDF |
| Update cadence | Daily |
| Freshness SLO | 36 hours |
| Source label | `official` |
| Parser | `ingestion/src/sources/luma_bps_pdf.py` (pdfplumber) |
| Raw key | `raw/luma-bps/yyyy/mm/dd/<filename>.pdf` |
| Degrades to | Skip backfill. Same successor-operator fallback as above. |

### LUMA — Planned Works (Mejoras Planificadas)

| Field | Value |
|---|---|
| URL | `https://lumapr.com/mejorasplanificadas/` (`/plannedworks/` redirects) |
| Format | HTML |
| Update cadence | Updated as posted, typically daily |
| Freshness SLO | 24 hours |
| Source label | `official` |
| Parser | `ingestion/src/sources/luma_planned_work.py` (Playwright) |
| Raw key | `raw/luma-planned-work/yyyy/mm/dd/HHMM-<uuid>.html` |
| Degrades to | If LUMA dark: planned-work layer disappears; banner explains. Successor operator's equivalent page replaces this row when it exists. |

### Genera PR — Generation Page

| Field | Value |
|---|---|
| URL | `https://genera-pr.com/data-generacion` |
| Format | HTML, JS-rendered. Returns 403 to non-browser User-Agents. |
| Update cadence | Real-time-ish |
| Source label | `official` |
| Parser | Deferred — Phase 6+. Used only as cross-check against `datos.pr.gov`. |
| Notes | Behind anti-bot. Requires Playwright. Not in MVP critical path. |

### AEE/PREPA — Load Shedding ArcGIS Dashboard

| Field | Value |
|---|---|
| URL | `https://aeepr.maps.arcgis.com/apps/dashboards/1995c773fceb468db8b7f7d34899df94` |
| Format | ArcGIS dashboard — likely fronts JSON FeatureServer endpoints |
| Source label | `official` |
| Status | **To investigate in Phase 3.** Probe for FeatureServer URLs; if found, this is a cleaner ingestion path than HTML scraping. |

### National Weather Service — Puerto Rico

| Field | Value |
|---|---|
| URL | `https://api.weather.gov/alerts/active?area=PR` plus forecast endpoints by zone |
| Format | JSON-LD (GeoJSON) |
| Update cadence | Continuous |
| Source label | `official` |
| Parser | `ingestion/src/sources/nws_weather.py` |
| Known issues (2026) | `/forecast` and `/forecast/hourly` removed historical data on 2026-01-07. `/radar/queues/{rds,tds}` limited since 2026-03-17. |
| Required header | `User-Agent: islagrid-ai/0.1 (contact@islagrid.app)` per api.weather.gov policy |

### OpenInfraMap / OpenStreetMap

| Field | Value |
|---|---|
| URL | Overpass API `https://overpass-api.de/api/interpreter` filtered to PR bbox |
| Format | OSM JSON → converted to GeoJSON |
| Cadence | Weekly batch fetch |
| Source label | `community` |
| License | ODbL (attribution required) |
| Parser | `ingestion/src/sources/osm_infrastructure.py` (Phase 4) |
| Required UI label | "Source: OpenStreetMap (community-mapped). Not utility-grade." |

### Census TIGER — Puerto Rico Municipality Boundaries

| Field | Value |
|---|---|
| URL | `https://www2.census.gov/geo/tiger/TIGER2024/COUSUB/` (or latest year) — Puerto Rico county subdivisions |
| Format | Shapefile → converted to GeoJSON once, committed to `public/geo/pr-municipalities.geojson` |
| Cadence | Annual refresh; static between |
| Source label | `official` |
| License | Public domain |

### Puerto Rico Energy Bureau (PREB / NEPR) — Tariff Books

| Field | Value |
|---|---|
| URL | `https://energia.pr.gov/en/current-rate/` |
| Format | PDF |
| Cadence | Quarterly (adjustment factors), occasional full tariff revisions |
| Source label | `official` |
| Status | MVP stores latest known rate in `lib/rate.ts` as a constant + a `preb_rates` table with hand-curated rows. No automated ingestion until bill calculator phase. |

### NREL — PV Rooftop Database for Puerto Rico

| Field | Value |
|---|---|
| URL | `https://data.openei.org/submissions/2862` |
| Format | LiDAR-derived static dataset |
| Cadence | **One-time collection, 2015–2017. NOT REFRESHED.** |
| Source label | `official` |
| Required UI label (mandatory) | "Rooftop estimate based on NREL LiDAR collected 2015–2017." |
| Status | Deferred to Phase 11. Listed here so the vintage warning is not forgotten. |

---

## Sources explicitly *not* ingested

- **No pole-, transformer-, or feeder-level utility data.** Even if accessible, MVP does not ingest or display this. Public-safety + privacy decision.
- **No X / Twitter scrape.** Spec considered it; rejected as unreliable.
- **No commercial weather feeds.** NWS is sufficient and free.

---

## How to add a new source

1. Add a row to this file (URL, format, cadence, freshness SLO, source label, parser path).
2. Create `ingestion/src/sources/<name>.py` implementing `fetch() -> bytes` and `parse(raw) -> Iterable[Record]`.
3. Add a workflow under `.github/workflows/ingest-<name>.yml`.
4. Add the source to the `source` column of the relevant Supabase table.
5. Add it to `/api/grid/status` only if it produces grid-state numbers.
6. Add a UI freshness chip wherever it is rendered.

A source that does not have a row here cannot be displayed in the UI.
