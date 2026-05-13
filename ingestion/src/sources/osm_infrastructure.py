"""
Fetch Puerto Rico power infrastructure from OpenStreetMap via Overpass.

Output: a single GeoJSON FeatureCollection per object class (plants, lines,
substations). Stored in R2 as the source-of-truth, and published as a static
asset under `public/geo/osm-power-pr.geojson` for the map to fetch.

Runs weekly. The OSM data is community-mapped, NOT utility-grade — UI must
label it as such.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from ..pipeline.snapshot import save_raw

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
SOURCE = "openstreetmap"

# Puerto Rico bounding box (lat_min, lon_min, lat_max, lon_max)
PR_BBOX = (17.85, -67.30, 18.55, -65.20)

QUERY = """
[out:json][timeout:90];
(
  node["power"="plant"]({bbox});
  way["power"="plant"]({bbox});
  relation["power"="plant"]({bbox});
  node["power"="generator"]({bbox});
  way["power"="line"]({bbox});
  way["power"="minor_line"]({bbox});
  node["power"="substation"]({bbox});
  way["power"="substation"]({bbox});
);
out center tags;
"""

log = logging.getLogger(__name__)


@retry(wait=wait_exponential(min=10, max=60), stop=stop_after_attempt(3), reraise=True)
def _fetch() -> bytes:
    bbox = ",".join(str(x) for x in PR_BBOX)
    q = QUERY.format(bbox=bbox)
    with httpx.Client(timeout=120.0) as client:
        r = client.post(
            OVERPASS_URL,
            data={"data": q},
            headers={"User-Agent": "islagrid-ai/0.1 (+contact@islagrid.app)"},
        )
        r.raise_for_status()
        return r.content


def _to_geojson(osm: dict[str, Any]) -> dict[str, Any]:
    feats: list[dict] = []
    for el in osm.get("elements", []):
        tags = el.get("tags") or {}
        if el["type"] == "node":
            geom = {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
        elif "center" in el:
            geom = {"type": "Point", "coordinates": [el["center"]["lon"], el["center"]["lat"]]}
        else:
            continue
        feats.append(
            {
                "type": "Feature",
                "id": f"{el['type']}/{el['id']}",
                "geometry": geom,
                "properties": {
                    "kind": tags.get("power", "unknown"),
                    "name": tags.get("name"),
                    "operator": tags.get("operator"),
                    "fuel": tags.get("plant:source") or tags.get("generator:source"),
                    "capacity_mw": _parse_mw(tags.get("plant:output:electricity") or tags.get("generator:output:electricity")),
                    "voltage": tags.get("voltage"),
                },
            }
        )
    return {"type": "FeatureCollection", "features": feats, "fetched_at": datetime.now(timezone.utc).isoformat()}


def _parse_mw(s: str | None) -> float | None:
    if not s:
        return None
    s = s.strip().lower().replace(",", "")
    try:
        if s.endswith("mw"):
            return float(s[:-2].strip())
        if s.endswith("kw"):
            return float(s[:-2].strip()) / 1000.0
        return float(s)
    except ValueError:
        return None


def run(write_public: bool = True) -> int:
    body = _fetch()
    raw_key = save_raw(SOURCE, body, ext="json", content_type="application/json")
    osm = json.loads(body)
    fc = _to_geojson(osm)
    log.info("Overpass: %d features (raw %s)", len(fc["features"]), raw_key)

    if write_public:
        import pathlib

        out = pathlib.Path(__file__).resolve().parents[3] / "public" / "geo" / "osm-power-pr.geojson"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(fc), encoding="utf-8")
        log.info("Wrote %s", out)
    return len(fc["features"])


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
