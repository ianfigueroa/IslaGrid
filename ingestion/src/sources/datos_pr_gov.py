"""
Ingest generation-by-plant from datos.pr.gov.

This is the *preferred* generation source — structured JSON, 5-minute cadence
when up. As of 2026-05-11 the host returns a maintenance redirect; we still
save the raw response so a future replay finishes the picture.
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

URL = "https://datos.pr.gov/datasourcev2/dsgeneracionporplanta"
SOURCE = "datos.pr.gov"

log = logging.getLogger(__name__)


@retry(wait=wait_exponential(min=2, max=20), stop=stop_after_attempt(3), reraise=True)
def _fetch() -> tuple[bytes, str]:
    """Return (raw_bytes, final_url) so we can detect maintenance redirects."""
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        r = client.get(URL, headers={"User-Agent": "islagrid-ai/0.1 (+iantdm11@gmail.com)"})
        return r.content, str(r.url)


def _looks_like_maintenance(final_url: str, body: bytes) -> bool:
    if "pr-gov-mantenimiento" in final_url:
        return True
    head = body[:2048].lower()
    return b"mantenimiento" in head and b"<html" in head


def _normalize_fuel(raw: str | None) -> str:
    if not raw:
        return "unknown"
    raw = raw.strip().lower()
    if any(x in raw for x in ("oil", "diesel", "bunker", "fuel oil")):
        return "oil"
    if "gas" in raw or "lng" in raw:
        return "gas"
    if "coal" in raw or "carbon" in raw:
        return "coal"
    if "solar" in raw or "pv" in raw:
        return "solar"
    if "wind" in raw or "eolic" in raw:
        return "wind"
    if "hydro" in raw or "hidro" in raw:
        return "hydro"
    if "landfill" in raw or "vertedero" in raw:
        return "landfill"
    if any(x in raw for x in ("battery", "bess", "storage", "baterias")):
        return "battery"
    if "peak" in raw:
        return "peaker"
    return "unknown"


def _parse(body: bytes) -> list[dict[str, Any]]:
    """
    Parse the datos.pr.gov payload. Format may vary by API version; we try the
    common shapes (`{plantas: [...]}`, `[...]`, `{data: [...]}`). Each entry
    is expected to expose name, capacity, output, and fuel-ish fields.
    """
    import json

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return []

    rows: list[dict[str, Any]] = []
    if isinstance(data, dict):
        items = data.get("plantas") or data.get("data") or data.get("rows") or []
    else:
        items = data

    if not isinstance(items, list):
        return []

    for item in items:
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                "plant_id": str(
                    item.get("plant_id") or item.get("id") or item.get("nombre") or item.get("name") or ""
                ).strip(),
                "mw": _num(item.get("mw") or item.get("output_mw") or item.get("generacion")),
                "available_mw": _num(item.get("available_mw") or item.get("capacidad")),
                "fuel": _normalize_fuel(
                    item.get("fuel") or item.get("tipo") or item.get("combustible")
                ),
            }
        )
    return [r for r in rows if r["plant_id"]]


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def run() -> int:
    """Returns count of rows upserted; 0 if source is in maintenance."""
    body, final_url = _fetch()
    raw_key = save_raw(SOURCE, body, ext="json", content_type="application/json")

    if _looks_like_maintenance(final_url, body):
        log.warning("datos.pr.gov in maintenance — raw saved at %s, no rows written", raw_key)
        return 0

    rows = _parse(body)
    if not rows:
        log.warning("datos.pr.gov returned no parseable rows; raw at %s", raw_key)
        return 0

    ts = datetime.now(timezone.utc).isoformat()
    payload = [
        {
            "ts": ts,
            "plant_id": r["plant_id"],
            "fuel": r["fuel"],
            "mw": r["mw"],
            "available_mw": r["available_mw"],
            "source": SOURCE,
            "raw_key": raw_key,
        }
        for r in rows
    ]
    supabase().table("generation_snapshots").upsert(
        payload, on_conflict="ts,plant_id"
    ).execute()
    log.info("datos.pr.gov: upserted %d rows (raw %s)", len(payload), raw_key)
    return len(payload)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
