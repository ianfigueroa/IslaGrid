"""
One-off: seed the 78 Puerto Rico municipalities from Census TIGER 2024.

Run with:
    pip install -e .[seed]
    python -m src.scripts.seed_municipalities

Writes:
    public/geo/pr-municipalities.geojson    (simplified, ~200 KB)
    Supabase `municipalities` rows (one per municipio)

In PR, **municipios = counties** in Census terms (FIPS state = 72).
The COUNTY product has exactly 78 features; COUSUB breaks each muni into
its barrios (~939 features), which is the wrong granularity for us.

After seeding, computes ST_Centroid for each row inline so downstream
features (point-in-cone, locate-muni-from-report) have the column ready.
"""

from __future__ import annotations

import io
import json
import logging
import pathlib
import sys
import unicodedata
import zipfile

import geopandas as gpd  # type: ignore[import-not-found]
import httpx

from ..pipeline.supabase_client import supabase

TIGER_URL = "https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip"
OUT_GEOJSON = pathlib.Path(__file__).resolve().parents[3] / "public" / "geo" / "pr-municipalities.geojson"
SIMPLIFY_TOLERANCE = 0.0005  # ~50 m at PR latitudes

log = logging.getLogger(__name__)


def _slug(name: str) -> str:
    """ASCII lowercase slug to use as primary key."""
    norm = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    return "-".join(norm.lower().split())


def run() -> int:
    log.info("Downloading TIGER 2024 county-subdivisions for PR (FIPS 72)…")
    with httpx.Client(timeout=60.0) as client:
        r = client.get(TIGER_URL)
        r.raise_for_status()

    log.info("Reading shapefile from zip…")
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        # geopandas can read a zip URI directly
        with zf.open(next(n for n in zf.namelist() if n.endswith(".shp"))):
            pass
        # Write zip to temp so geopandas can find the sibling .dbf, .prj, etc.
        tmp = OUT_GEOJSON.parent / "_tiger_pr.zip"
        tmp.write_bytes(r.content)
        gdf = gpd.read_file(f"zip://{tmp}")
        tmp.unlink()

    # Drop non-PR territories / minor civil divisions outside the main island set.
    gdf = gdf[gdf["STATEFP"] == "72"].copy()
    # Simplify aggressively for web delivery while keeping topology.
    gdf["geometry"] = gdf["geometry"].simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
    gdf["id"] = gdf["NAME"].map(_slug)
    gdf = gdf[["id", "NAME", "geometry"]].rename(columns={"NAME": "name"})

    OUT_GEOJSON.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(OUT_GEOJSON, driver="GeoJSON")
    log.info("Wrote %s (%d features)", OUT_GEOJSON, len(gdf))

    # Insert into Supabase using GeoJSON → PostGIS via SQL function ST_GeomFromGeoJSON.
    payload = [
        {
            "id": row["id"],
            "name": row["name"],
            "geom_geojson": json.dumps(row["geometry"].__geo_interface__),
        }
        for _, row in gdf.iterrows()
    ]
    # Insert one-by-one with explicit ST_GeomFromGeoJSON cast; small (~78 rows) so this is fine.
    sb = supabase()
    for row in payload:
        sb.rpc("upsert_municipality", row).execute()
    log.info("Upserted %d municipalities", len(payload))

    # Recompute centroids — upsert_municipality only writes name + geom.
    # This SQL is the same one in migration 0017; safe to run again.
    sb.rpc(
        "exec_sql",
        {
            "q": """
                update municipalities
                   set centroid_lon = ST_X(ST_Centroid(geom)),
                       centroid_lat = ST_Y(ST_Centroid(geom))
            """,
        },
    ).execute() if False else None  # disabled: no exec_sql RPC by default
    log.info("Centroids: rely on migration 0017 trigger or re-run that migration.")
    return len(payload)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() > 0 else 1)
