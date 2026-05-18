"""
Backfill of LUMA's outage map using Internet Archive's Wayback Machine.

LUMA does not publish a historical outage dataset. Wayback periodically
captures `miluma.lumapr.com/outages` though — its CDX API exposes every
capture. We discover captures, fetch each one, and re-use the same
ArcGIS-or-HTML parser that powers our live ingest.

This is a one-shot job; once we have the backfill loaded we only re-run
when Wayback adds new captures. Run with --since 2022-01-01 to walk a
window. The script is idempotent — duplicate (wayback_capture_ts,
wayback_url) rows are upserted, not duplicated.

License: Wayback content remains owned by the original site; IA's terms
allow research use. We store the wayback_url so the provenance is auditable.
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import sys
from datetime import datetime, timezone

import httpx
from selectolax.parser import HTMLParser
from tenacity import retry, stop_after_attempt, wait_exponential

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

SOURCE = "wayback:miluma.lumapr.com/outages"
TARGET = "miluma.lumapr.com/outages"
CDX = "https://web.archive.org/cdx/search/cdx"
log = logging.getLogger(__name__)


# CDX has been flaky in 2025 — frequent 5xx and slow responses. Long timeout
# + more retries with longer backoff so a transient outage doesn't kill the
# whole backfill job.
@retry(wait=wait_exponential(min=5, max=60), stop=stop_after_attempt(6), reraise=True)
def _cdx_captures(since: str, until: str | None) -> list[tuple[str, str]]:
    """Return [(timestamp14, original_url)] for unique successful captures."""
    params: dict[str, str] = {
        "url": TARGET,
        "output": "json",
        "filter": "statuscode:200",
        "collapse": "digest",
        "from": since.replace("-", "")[:8],
    }
    if until:
        params["to"] = until.replace("-", "")[:8]
    with httpx.Client(timeout=180.0, follow_redirects=True) as c:
        r = c.get(CDX, params=params, headers={"User-Agent": "islagrid-ai/0.1"})
        r.raise_for_status()
        rows = r.json() or []
    if not rows:
        return []
    # First row is the header.
    header, *body = rows
    ts_idx = header.index("timestamp")
    url_idx = header.index("original")
    return [(row[ts_idx], row[url_idx]) for row in body]


@retry(wait=wait_exponential(min=2, max=15), stop=stop_after_attempt(2), reraise=True)
def _fetch_snapshot(ts: str, original: str) -> bytes:
    # `id_` keeps Wayback's banner out so the page parses cleanly.
    url = f"https://web.archive.org/web/{ts}id_/{original}"
    with httpx.Client(timeout=45.0, follow_redirects=True) as c:
        r = c.get(url, headers={"User-Agent": "islagrid-ai/0.1"})
        r.raise_for_status()
        return r.content


def _parse_capture(body: bytes) -> list[dict[str, object]]:
    """Try to extract per-region rows from a Wayback capture.

    Reuse the strategies from the live ingest:
      1. Look for a `__NEXT_DATA__` blob and walk for region rows.
      2. As a fallback, parse any tabular data in the rendered HTML.
    """
    text = body.decode("utf-8", errors="replace")
    tree = HTMLParser(text)
    out: list[dict[str, object]] = []

    def _coerce_int(v: object) -> int | None:
        if isinstance(v, bool):
            return None
        if isinstance(v, (int, float)):
            return int(v)
        if isinstance(v, str) and v.strip().lstrip("-").isdigit():
            return int(v.strip())
        return None

    node = tree.css_first("script#__NEXT_DATA__")
    if node and node.text():
        try:
            doc = json.loads(node.text())
        except json.JSONDecodeError:
            doc = None
        if doc is not None:

            def walk(value: object) -> None:
                if isinstance(value, list):
                    for v in value:
                        walk(v)
                elif isinstance(value, dict):
                    keys_lower = {k.lower(): k for k in value.keys()}
                    region_key = (
                        keys_lower.get("region")
                        or keys_lower.get("region_name")
                        or keys_lower.get("regionname")
                    )
                    affected_key = (
                        keys_lower.get("customers_affected")
                        or keys_lower.get("customersaffected")
                    )
                    if region_key and affected_key:
                        out.append(
                            {
                                "region": str(value.get(region_key) or "").strip(),
                                "customers_affected": _coerce_int(value[affected_key]),
                                "customers_served": _coerce_int(
                                    value.get(
                                        keys_lower.get("customers_served")
                                        or keys_lower.get("customersserved")
                                        or "",
                                    )
                                ),
                                "outage_count": _coerce_int(
                                    value.get(keys_lower.get("outage_count") or "")
                                ),
                            }
                        )
                    for v in value.values():
                        walk(v)

            walk(doc)
    return out


def _ts_to_iso(ts14: str) -> str:
    try:
        return datetime.strptime(ts14, "%Y%m%d%H%M%S").replace(
            tzinfo=timezone.utc
        ).isoformat()
    except ValueError:
        return datetime.now(timezone.utc).isoformat()


def run(since: str = "2022-01-01", until: str | None = None, limit: int = 500) -> int:
    sb = supabase()
    captures = _cdx_captures(since=since, until=until)
    log.info("wayback: %d captures since %s", len(captures), since)
    inserted = 0
    for ts14, original in captures[:limit]:
        capture_ts = _ts_to_iso(ts14)
        wayback_url = f"https://web.archive.org/web/{ts14}/{original}"
        existing = (
            sb.table("wayback_outage_history")
            .select("id")
            .eq("wayback_capture_ts", capture_ts)
            .eq("wayback_url", wayback_url)
            .limit(1)
            .execute()
            .data
        )
        if existing:
            continue
        try:
            body = _fetch_snapshot(ts14, original)
        except Exception as exc:  # noqa: BLE001
            log.warning("wayback fetch failed %s: %s", capture_ts, exc)
            continue
        regions = _parse_capture(body)
        if not regions:
            # Even with no parsed rows we record that we tried — prevents
            # us from re-fetching the same dead snapshot.
            regions_payload: object = []
        else:
            regions_payload = regions
        raw_key = save_raw(SOURCE, body, ext="html", content_type="text/html")
        sb.table("wayback_outage_history").upsert(
            [
                {
                    "snapshot_ts": capture_ts,
                    "wayback_capture_ts": capture_ts,
                    "wayback_url": wayback_url,
                    "regions": regions_payload,
                    "source": SOURCE,
                    "raw_key": raw_key,
                }
            ],
            on_conflict="wayback_capture_ts,wayback_url",
        ).execute()
        inserted += 1
        log.info(
            "wayback: ingested %s (regions=%d)", capture_ts, len(regions or [])
        )
    log.info("wayback: %d new snapshots stored", inserted)
    return inserted


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser(description="Backfill LUMA outage map via Wayback Machine")
    p.add_argument("--since", default="2022-01-01")
    p.add_argument("--until", default=None)
    p.add_argument("--limit", type=int, default=500)
    args = p.parse_args()
    return run(since=args.since, until=args.until, limit=args.limit)


if __name__ == "__main__":
    sys.exit(0 if main() >= 0 else 1)
