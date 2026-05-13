"""
Probe + ingest AEE/PREPA's ArcGIS load-shedding dashboard.

The dashboard at
  https://aeepr.maps.arcgis.com/apps/dashboards/1995c773fceb468db8b7f7d34899df94
is a thin wrapper around one or more FeatureServer layers. The exact layer URLs
are not published, so the workflow is:

  1. (one-time, manual) Open the dashboard in a browser with DevTools → Network
     → filter on `FeatureServer`. Copy the URLs into the AEEPR_LAYERS env var
     as a comma-separated list. Save it to GitHub Actions secrets and the
     RUNBOOK.
  2. This script polls each layer URL with `f=json&where=1=1&outFields=*` and
     stores raw responses to R2. When at least one layer parses cleanly, rows
     are written to official_updates (and, later, outage_labels).

Until AEEPR_LAYERS is set this script is a no-op that records its own missing
configuration to the log — it never crashes the workflow.
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

SOURCE = "aeepr.maps.arcgis.com"

log = logging.getLogger(__name__)


def _layer_urls() -> list[str]:
    raw = os.environ.get("AEEPR_LAYERS", "").strip()
    return [u.strip() for u in raw.split(",") if u.strip()]


@retry(wait=wait_exponential(min=2, max=20), stop=stop_after_attempt(3), reraise=True)
def _fetch(url: str) -> bytes:
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        r = client.get(
            url,
            params={"f": "json", "where": "1=1", "outFields": "*"},
            headers={"User-Agent": "islagrid-ai/0.1 (+contact@islagrid.app)"},
        )
        r.raise_for_status()
        return r.content


def run() -> int:
    urls = _layer_urls()
    if not urls:
        log.warning(
            "AEEPR_LAYERS env var not set — skipping. See ingestion/src/sources/aeepr_arcgis.py for setup."
        )
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    count = 0
    for url in urls:
        try:
            body = _fetch(url)
        except Exception as exc:
            log.warning("AEEPR layer fetch failed for %s: %s", url, exc)
            continue
        raw_key = save_raw(SOURCE, body, ext="json", content_type="application/json")
        # Parsing is intentionally deferred until the layer schemas are known.
        # The raw archive lets us backfill once we wire field mapping.
        supabase().table("official_updates").upsert(
            [
                {
                    "id": f"aeepr-snapshot:{raw_key}",
                    "ts": now_iso,
                    "source": SOURCE,
                    "category": "arcgis-snapshot",
                    "text": f"AEE/PREPA ArcGIS snapshot captured ({len(body)} bytes).",
                    "url": url,
                    "raw_key": raw_key,
                }
            ],
            on_conflict="id",
        ).execute()
        count += 1
    log.info("aeepr_arcgis snapshots saved: %d", count)
    return count


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
