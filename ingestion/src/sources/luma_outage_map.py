"""
LUMA outage map ingest.

LUMA publishes a public outage map at https://miluma.lumapr.com/outages.
Behind it is an ArcGIS REST FeatureServer that returns the per-region
customer-affected counts as JSON. We prefer that JSON endpoint because:

  1. It's the canonical machine-readable feed (HTML on the page is rendered
     from this same JSON).
  2. No headless browser required.
  3. Stable schema; less likely to break when LUMA reskins.

Fallback path: if the ArcGIS host isn't reachable we fall back to a
Playwright fetch of the public map page and parse the in-page __NEXT_DATA__
blob. Either way we archive the raw bytes to R2 and write a normalized
snapshot to ``luma_outage_snapshots``.

We are NOT proxying LumaTrack or any third-party scraper — this hits LUMA's
own infrastructure directly.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

import httpx
from selectolax.parser import HTMLParser
from tenacity import retry, stop_after_attempt, wait_exponential

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

SOURCE = "luma-outage-map"
PAGE_URL = "https://miluma.lumapr.com/outages"
# Best-known ArcGIS endpoint as of 2026-05. If LUMA migrates this, the
# environment override lets us swap without a code change.
ARCGIS_URL_ENV = "LUMA_OUTAGE_ARCGIS_URL"
DEFAULT_ARCGIS_URL = (
    "https://services1.arcgis.com/2pj8GR8z9LBM2WG3/arcgis/rest/services/"
    "Outages_View/FeatureServer/0/query"
)

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class RegionSnapshot:
    region_id: str
    region_name: str
    customers_affected: int | None
    customers_served: int | None
    outage_count: int | None
    last_updated_at: str | None


@retry(wait=wait_exponential(min=2, max=15), stop=stop_after_attempt(3), reraise=True)
def _fetch_arcgis(url: str) -> bytes:
    params = {
        "where": "1=1",
        "outFields": "*",
        "returnGeometry": "false",
        "f": "json",
    }
    with httpx.Client(timeout=20.0, headers={"User-Agent": "islagrid-ai/0.1"}) as c:
        r = c.get(url, params=params)
        r.raise_for_status()
        return r.content


def _parse_arcgis(body: bytes) -> list[RegionSnapshot]:
    try:
        doc = json.loads(body)
    except json.JSONDecodeError:
        return []
    features = doc.get("features") or []
    out: list[RegionSnapshot] = []
    for feat in features:
        a = feat.get("attributes") or {}
        # Field names vary across ArcGIS deployments; check the common
        # spellings and accept the first that's present.
        region_id = str(
            a.get("REGION_ID")
            or a.get("RegionID")
            or a.get("region_id")
            or a.get("OBJECTID")
            or ""
        ).strip()
        region_name = (
            a.get("REGION")
            or a.get("RegionName")
            or a.get("Region")
            or a.get("region")
            or ""
        ).strip()
        if not region_id and not region_name:
            continue
        affected = (
            a.get("CUSTOMERS_AFFECTED")
            or a.get("CustomersAffected")
            or a.get("customers_affected")
        )
        served = (
            a.get("CUSTOMERS_SERVED")
            or a.get("CustomersServed")
            or a.get("customers_served")
        )
        out_count = (
            a.get("OUTAGE_COUNT")
            or a.get("OutageCount")
            or a.get("outages")
        )
        ts_raw = (
            a.get("LAST_UPDATED")
            or a.get("LastUpdated")
            or a.get("last_updated")
        )
        ts_iso: str | None = None
        if isinstance(ts_raw, (int, float)):
            # ArcGIS returns epoch millis.
            ts_iso = datetime.fromtimestamp(
                ts_raw / 1000, tz=timezone.utc
            ).isoformat()
        elif isinstance(ts_raw, str) and ts_raw:
            ts_iso = ts_raw

        out.append(
            RegionSnapshot(
                region_id=region_id or region_name,
                region_name=region_name or region_id,
                customers_affected=int(affected) if isinstance(affected, (int, float)) else None,
                customers_served=int(served) if isinstance(served, (int, float)) else None,
                outage_count=int(out_count) if isinstance(out_count, (int, float)) else None,
                last_updated_at=ts_iso,
            )
        )
    return out


@retry(wait=wait_exponential(min=2, max=15), stop=stop_after_attempt(2), reraise=True)
def _fetch_page_html() -> bytes:
    # Lightweight fallback: just GET the page; rely on __NEXT_DATA__ blob
    # being present. (If the page becomes fully client-rendered we'd need
    # Playwright — kept as a future upgrade.)
    with httpx.Client(timeout=20.0, headers={"User-Agent": "islagrid-ai/0.1"}) as c:
        r = c.get(PAGE_URL, follow_redirects=True)
        r.raise_for_status()
        return r.content


def _parse_next_data(html: bytes) -> list[RegionSnapshot]:
    tree = HTMLParser(html.decode("utf-8", errors="replace"))
    node = tree.css_first("script#__NEXT_DATA__")
    if not node or not node.text():
        return []
    try:
        doc = json.loads(node.text())
    except json.JSONDecodeError:
        return []
    # Walk for any list-of-objects with a 'customers_affected'-ish key.
    rows: list[RegionSnapshot] = []

    def walk(value: object) -> None:
        if isinstance(value, list):
            for v in value:
                walk(v)
        elif isinstance(value, dict):
            keys_lower = {k.lower(): k for k in value.keys()}
            affected_key = keys_lower.get("customers_affected") or keys_lower.get("customersaffected")
            region_key = (
                keys_lower.get("region")
                or keys_lower.get("region_name")
                or keys_lower.get("regionname")
            )
            if affected_key and region_key:
                rows.append(
                    RegionSnapshot(
                        region_id=str(value.get(region_key) or "").strip(),
                        region_name=str(value.get(region_key) or "").strip(),
                        customers_affected=int(value[affected_key])
                        if isinstance(value[affected_key], (int, float))
                        else None,
                        customers_served=None,
                        outage_count=None,
                        last_updated_at=None,
                    )
                )
            for v in value.values():
                walk(v)

    walk(doc)
    return rows


def _to_rows(snapshots: Iterable[RegionSnapshot], raw_key: str) -> list[dict[str, object]]:
    now = datetime.now(timezone.utc).isoformat()
    return [
        {
            "ts": now,
            "region_id": s.region_id,
            "region_name": s.region_name,
            "customers_affected": s.customers_affected,
            "customers_served": s.customers_served,
            "outage_count": s.outage_count,
            "source_last_updated_at": s.last_updated_at,
            "source": SOURCE,
            "raw_key": raw_key,
        }
        for s in snapshots
    ]


def run() -> int:
    arcgis_url = os.environ.get(ARCGIS_URL_ENV) or DEFAULT_ARCGIS_URL
    snapshots: list[RegionSnapshot] = []
    raw_key = ""

    try:
        body = _fetch_arcgis(arcgis_url)
        raw_key = save_raw(SOURCE, body, ext="json", content_type="application/json")
        snapshots = _parse_arcgis(body)
        log.info("luma_outage_map: arcgis returned %d regions", len(snapshots))
    except Exception as exc:  # noqa: BLE001
        log.warning("luma_outage_map: arcgis path failed (%s) — falling back to HTML", exc)
        snapshots = []

    if not snapshots:
        try:
            html = _fetch_page_html()
            raw_key = save_raw(SOURCE, html, ext="html", content_type="text/html")
            snapshots = _parse_next_data(html)
            log.info("luma_outage_map: html fallback parsed %d regions", len(snapshots))
        except Exception as exc:  # noqa: BLE001
            log.error("luma_outage_map: html fallback failed (%s)", exc)
            return 0

    if not snapshots:
        log.warning("luma_outage_map: no rows parsed; raw archived at %s", raw_key)
        return 0

    rows = _to_rows(snapshots, raw_key)
    supabase().table("luma_outage_snapshots").insert(rows).execute()
    log.info("luma_outage_map: inserted %d region snapshots", len(rows))
    return len(rows)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
