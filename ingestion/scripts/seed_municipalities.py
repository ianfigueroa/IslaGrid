"""
One-shot seed of Puerto Rico's 78 municipalities into the `municipalities`
table.

Source: US Census TIGER 2024 county-level shapefile, filtered to FIPS state
= 72 (PR). PR's "municipios" are equivalent to counties in Census terms, so
the COUNTY shapefile gives us all 78 with stable GEOIDs.

Idempotent: re-running upserts (geometry can be refreshed if Census ships
an update). Calls the upsert_municipality(id, name, geom_geojson) SQL
function defined in migration 0002.

Usage:
    cd ingestion
    python -m scripts.seed_municipalities

Required env:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY

Optional env:
    TIGER_COUNTY_URL  (override the default Census URL)
"""

from __future__ import annotations

import io
import json
import logging
import os
import sys
import zipfile

import httpx
from src.pipeline.supabase_client import supabase

PR_FIPS = "72"
DEFAULT_URL = "https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip"

log = logging.getLogger(__name__)


def _download_tiger(url: str) -> bytes:
    log.info("Downloading TIGER county shapefile (~90MB)…")
    with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as r:
        r.raise_for_status()
        buf = io.BytesIO()
        for chunk in r.iter_bytes(chunk_size=1 << 20):
            buf.write(chunk)
        return buf.getvalue()


def _extract_pr_munis(zip_bytes: bytes):
    """Yield (geoid, name, geojson_geometry_dict) for each PR municipality."""
    import geopandas as gpd

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        with zf.open("tl_2024_us_county.shp") as _:
            pass
        # geopandas can read directly from the zip URI form:
        gdf = gpd.read_file(f"zip://{_tmp_dump(zip_bytes)}")
    pr = gdf[gdf["STATEFP"] == PR_FIPS]
    log.info("Found %d PR municipalities in TIGER", len(pr))
    for _, row in pr.iterrows():
        geoid = str(row["GEOID"])          # e.g. '72127' for San Juan
        county_fips = geoid[2:]            # last 3 chars
        muni_id = f"{PR_FIPS}-{county_fips}"  # '72-127'
        name = str(row["NAME"])
        geom = row["geometry"]
        if geom is None or geom.is_empty:
            continue
        # geopandas geometry → GeoJSON dict (shapely's __geo_interface__)
        yield muni_id, name, geom.__geo_interface__


def _tmp_dump(zip_bytes: bytes) -> str:
    """geopandas needs a real file path for zip:// — write to a temp."""
    import tempfile

    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp.write(zip_bytes)
    tmp.flush()
    tmp.close()
    return tmp.name


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    url = os.environ.get("TIGER_COUNTY_URL", DEFAULT_URL)

    try:
        zip_bytes = _download_tiger(url)
    except Exception as exc:  # noqa: BLE001
        log.error("Download failed: %s", exc)
        return 2

    sb = supabase()
    count = 0
    for muni_id, name, geom in _extract_pr_munis(zip_bytes):
        try:
            sb.rpc(
                "upsert_municipality",
                {
                    "id": muni_id,
                    "name": name,
                    "geom_geojson": json.dumps(geom),
                },
            ).execute()
            count += 1
            if count % 10 == 0:
                log.info("…upserted %d/78", count)
        except Exception as exc:  # noqa: BLE001
            log.error("Failed on %s (%s): %s", muni_id, name, exc)

    log.info("Seed complete: %d municipalities", count)
    return 0 if count >= 78 else 1


if __name__ == "__main__":
    raise SystemExit(main())
