"""
LUMA outage map ingest — region-level customer counts.

Real source (discovered via the MiLUMA portal's XHR traffic):
  https://api.miluma.lumapr.com/miluma-outage-api/outage/regionsWithoutService

Schema (verified 2026-05):
    {
      "regions": [
        {
          "name": "San Juan",
          "totalClients": 253068,
          "totalClientsWithoutService": 421,
          "totalClientsWithService": 252647,
          "totalClientsAffectedByPlannedOutage": 12,
          "totalClientsAffectedByLoadShed": 0,
          "percentageClientsWithoutService": 0.17,
          "percentageClientsWithService": 99.83
        },
        ...
      ],
      "totals": { ... },
      "timestamp": "05/13/2026 11:50 AM"
    }

We write one row per region per ingest run to `luma_outage_snapshots` so the
existing UI freshness chips / region rollups keep working unchanged. The
``totalClientsAffectedByLoadShed`` and ``totalClientsAffectedByPlannedOutage``
fields are folded into `outage_count` as a coarse "anything not normal"
counter; the raw JSON in R2 retains the full structure for re-parsing.

There is no headless browser dependency — the JSON endpoint is public and
unauthenticated as of 2026-05. If LUMA closes it, the next-best path is to
fall back to Playwright on https://miluma.lumapr.com/outages (their page is a
thin client over this same API).
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

SOURCE = "luma-outage-map"
DEFAULT_API_URL = (
    "https://api.miluma.lumapr.com/miluma-outage-api/outage/regionsWithoutService"
)
USER_AGENT = "islagrid-ai/0.1 (+contact@islagrid.app)"

log = logging.getLogger(__name__)


def _api_url() -> str:
    return os.environ.get("LUMA_OUTAGE_API_URL") or DEFAULT_API_URL


@retry(wait=wait_exponential(min=2, max=15), stop=stop_after_attempt(3), reraise=True)
def _fetch(url: str) -> bytes:
    with httpx.Client(
        timeout=20.0,
        follow_redirects=True,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Origin": "https://miluma.lumapr.com",
            "Referer": "https://miluma.lumapr.com/",
        },
    ) as c:
        r = c.get(url)
        r.raise_for_status()
        return r.content


def _parse_timestamp(raw: str | None) -> str | None:
    """MiLUMA reports timestamps like ``05/13/2026 11:50 AM`` in AST (UTC-4)."""
    if not raw:
        return None
    try:
        # No timezone in the source — assume Atlantic Standard Time (no DST).
        # Attach AST explicitly rather than relying on the runner's local tz:
        # astimezone() on a naive datetime treats it as system-local, which is
        # only correct on a UTC runner and silently wrong everywhere else.
        from datetime import timedelta, timezone

        ast = timezone(timedelta(hours=-4))
        dt = datetime.strptime(raw, "%m/%d/%Y %I:%M %p").replace(tzinfo=ast)
        return dt.astimezone(UTC).isoformat()
    except ValueError:
        return None


def _to_rows(payload: dict[str, Any], raw_key: str) -> list[dict[str, Any]]:
    now = datetime.now(UTC).isoformat()
    source_ts = _parse_timestamp(payload.get("timestamp"))
    rows: list[dict[str, Any]] = []
    for r in payload.get("regions") or []:
        name = (r.get("name") or "").strip()
        if not name:
            continue
        without = r.get("totalClientsWithoutService")
        load_shed = r.get("totalClientsAffectedByLoadShed") or 0
        planned = r.get("totalClientsAffectedByPlannedOutage") or 0
        served = r.get("totalClientsWithService")
        rows.append(
            {
                "ts": now,
                "region_id": name.lower().replace(" ", "-"),
                "region_name": name,
                "customers_affected": int(without) if isinstance(without, (int, float)) else None,
                "customers_served": int(served) if isinstance(served, (int, float)) else None,
                # MiLUMA doesn't expose a raw "outage_count"; encode the
                # combined "anything non-normal" tally so the UI can render
                # a single magnitude per region. Detail still lives in raw.
                "outage_count": int((load_shed or 0) + (planned or 0)) or None,
                "source_last_updated_at": source_ts,
                "source": SOURCE,
                "raw_key": raw_key,
            }
        )
    return rows


def run() -> int:
    url = _api_url()
    try:
        body = _fetch(url)
    except Exception as exc:
        log.error("luma_outage_map: api fetch failed (%s)", exc)
        return 0
    raw_key = save_raw(SOURCE, body, ext="json", content_type="application/json")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        log.error("luma_outage_map: invalid JSON from %s — %s; raw archived %s", url, exc, raw_key)
        return 0
    rows = _to_rows(payload, raw_key)
    if not rows:
        log.warning("luma_outage_map: no regions parsed; raw archived %s", raw_key)
        return 0
    supabase().table("luma_outage_snapshots").insert(rows).execute()
    log.info("luma_outage_map: inserted %d region rows (raw %s)", len(rows), raw_key)
    return len(rows)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
