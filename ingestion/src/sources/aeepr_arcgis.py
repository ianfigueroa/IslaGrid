"""
Ingest AEE/PREPA's Manual Load Shedding FeatureServer.

Source dashboard:
  https://aeepr.maps.arcgis.com/apps/dashboards/1995c773fceb468db8b7f7d34899df94

Backing FeatureServer (discovered by walking the dashboard's WebMap config —
both "Alimentadores sin Servicio" and "Relevo de Carga Proyectado" point at
this same layer; the dashboard filters on STATUS and `predicted`):
  services3.arcgis.com/0n3sEGhALDkUSwc5/arcgis/rest/services/Manual_Load_Shedding/FeatureServer/0

This is the most granular *official* electrical outage geometry published for
Puerto Rico — per-feeder polygons with customer counts and MW load. ~12k
feeders island-wide, ~50-500 active during a normal day.

We pull only:
  - STATUS = 'SI'      (active interruption — red on the dashboard)
  - predicted = 'SI'   (projected load shed)
Pagination is via `resultOffset` because the layer caps each response at 1000
features. We keep the full polygon geometry as GeoJSON in the DB so the API
can hand it to MapLibre without a PostGIS dependency.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import UTC, datetime
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

SOURCE = "aeepr.maps.arcgis.com"
# The dashboard's WebMap (item id fc5f8ede0f7f4ac39d297c63cc1751ce) references
# this layer for the active-outage and projected-load-shed renderers.
DEFAULT_LAYER_URL = (
    "https://services3.arcgis.com/0n3sEGhALDkUSwc5/arcgis/rest/services/"
    "Manual_Load_Shedding/FeatureServer/0/query"
)
PAGE_SIZE = 1000
USER_AGENT = "islagrid-ai/0.1 (+contact@islagrid.app)"

log = logging.getLogger(__name__)


def _layer_url() -> str:
    return (os.environ.get("AEEPR_LOAD_SHED_URL") or DEFAULT_LAYER_URL).rstrip("/")


@retry(wait=wait_exponential(min=2, max=15), stop=stop_after_attempt(3), reraise=True)
def _fetch_page(client: httpx.Client, url: str, where: str, offset: int) -> dict[str, Any]:
    params = {
        "where": where,
        "outFields": "*",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
        "resultRecordCount": str(PAGE_SIZE),
        "resultOffset": str(offset),
    }
    r = client.get(url, params=params)
    r.raise_for_status()
    return r.json()


def _fetch_all(client: httpx.Client, url: str, where: str) -> tuple[list[dict[str, Any]], bytes]:
    """Walk the layer with resultOffset until the server stops returning data."""
    out: list[dict[str, Any]] = []
    raw_chunks: list[bytes] = []
    offset = 0
    while True:
        page = _fetch_page(client, url, where, offset)
        raw_chunks.append(json.dumps(page).encode("utf-8"))
        feats = page.get("features") or []
        if not feats:
            break
        out.extend(feats)
        # ArcGIS sets exceededTransferLimit when more pages exist. Some
        # servers omit the flag and we rely on len(feats) < PAGE_SIZE.
        exceeded = bool(
            page.get("properties", {}).get("exceededTransferLimit")
            or page.get("exceededTransferLimit")
        )
        if not exceeded and len(feats) < PAGE_SIZE:
            break
        offset += len(feats)
        if offset > 50_000:  # belt-and-suspenders: the layer has ~12k feeders
            log.warning("aeepr_arcgis: pagination bailout at offset=%d", offset)
            break
    combined = b"[" + b",".join(raw_chunks) + b"]"
    return out, combined


def _feature_to_row(feat: dict[str, Any]) -> dict[str, Any] | None:
    props = feat.get("properties") or {}
    geom = feat.get("geometry")
    feeder_id = (
        props.get("CIRCUIT1")
        or props.get("FEEDER")
        or props.get("OBJECTID_1")
    )
    if not feeder_id:
        return None
    return {
        "feeder_id": str(feeder_id).strip(),
        "name": (props.get("NAME") or "").strip() or None,
        "region": (props.get("REGION") or "").strip() or None,
        "municipality_label": (props.get("MUNICIPALI") or "").strip() or None,
        "voltage_kv": _num(props.get("VOLTAGE")),
        "load_mw": _num(props.get("MW")),
        "customers": _int(props.get("CLIENTS")),
        "critical_load": (props.get("CRITICAL_L") or "").strip() or None,
        "erp_level": _int(props.get("ERP_LEVEL")),
        "sectors": (props.get("SECTORS") or "").strip() or None,
        "status": (props.get("STATUS") or "NO").strip().upper(),
        "predicted_load_shed": (props.get("predicted") or "NO").strip().upper(),
        "predicted_at": (props.get("pred_time") or None),
        "time_out_app": (props.get("TIME_OUT_APP") or "").strip() or None,
        "stage": (props.get("STAGE") or "").strip() or None,
        "comments": (props.get("COMMENTS") or "").strip() or None,
        "geometry_geojson": geom,
        "source": SOURCE,
    }


def _num(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v: Any) -> int | None:
    try:
        if v is None or v == "":
            return None
        return int(v)
    except (TypeError, ValueError):
        return None


def run() -> int:
    url = _layer_url()
    now_iso = datetime.now(UTC).isoformat()
    total = 0
    with httpx.Client(
        timeout=30.0,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT, "Accept": "application/geo+json,application/json"},
    ) as client:
        # We make two narrow queries instead of one wide STATUS in (...). The
        # dashboard itself splits them and the load on the FeatureServer is
        # lower because the predicted set is usually small.
        for where in ("STATUS = 'SI'", "predicted = 'SI'"):
            try:
                feats, raw = _fetch_all(client, url, where)
            except Exception as exc:
                log.warning("aeepr_arcgis: fetch failed for %s — %s", where, exc)
                continue
            raw_key = save_raw(SOURCE, raw, ext="json", content_type="application/json")
            rows: list[dict[str, Any]] = []
            for feat in feats:
                row = _feature_to_row(feat)
                if not row:
                    continue
                row["ts"] = now_iso
                row["raw_key"] = raw_key
                rows.append(row)
            if not rows:
                log.info("aeepr_arcgis: %s — 0 rows (raw archived %s)", where, raw_key)
                continue
            supabase().table("aeepr_feeder_snapshots").insert(rows).execute()
            log.info("aeepr_arcgis: %s — inserted %d rows", where, len(rows))
            total += len(rows)
    return total


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
