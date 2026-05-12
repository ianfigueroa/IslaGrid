"""
Mastodon public-timeline ingest for PR grid keywords.

Hits the public `/api/v2/search` endpoint on a configurable instance (default
mastodon.social). No auth required for unauthenticated read of public posts.
Matching posts land in ``official_updates`` with ``source = 'social.mastodon'``
and category ``social``.

Mastodon is a federated network: a single instance only sees what its users
follow, so volume on PR-specific topics is low. We still ingest it because
the posts that DO surface are usually from technical / news accounts that
are higher signal than the Bluesky firehose average.
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any

import httpx
from selectolax.parser import HTMLParser
from tenacity import retry, stop_after_attempt, wait_exponential

from ..pipeline.supabase_client import supabase

SOURCE = "social.mastodon"
DEFAULT_INSTANCE = "mastodon.social"

DEFAULT_KEYWORDS = (
    "apagón Puerto Rico",
    "LUMA Energy",
    "sin luz PR",
    "Genera PR",
)

log = logging.getLogger(__name__)


@retry(wait=wait_exponential(min=2, max=15), stop=stop_after_attempt(3), reraise=True)
def _search(instance: str, query: str, limit: int = 20) -> dict[str, Any]:
    url = f"https://{instance}/api/v2/search"
    params = {"q": query, "type": "statuses", "limit": limit, "resolve": "false"}
    with httpx.Client(timeout=20.0, headers={"User-Agent": "islagrid-ai/0.1"}) as c:
        r = c.get(url, params=params)
        r.raise_for_status()
        return r.json()


def _strip_html(html: str) -> str:
    if not html:
        return ""
    return HTMLParser(html).text(separator=" ").strip()


def _keywords() -> tuple[str, ...]:
    raw = os.environ.get("MASTODON_KEYWORDS", "").strip()
    if raw:
        return tuple(k.strip() for k in raw.split(",") if k.strip())
    return DEFAULT_KEYWORDS


def _row_from_status(status: dict[str, Any]) -> dict[str, str | None] | None:
    text = _strip_html(status.get("content") or "")
    if not text:
        return None
    status_id = str(status.get("id") or "")
    url = status.get("url") or ""
    if not status_id or not url:
        return None
    handle = (status.get("account") or {}).get("acct") or "unknown"
    created = status.get("created_at") or datetime.now(timezone.utc).isoformat()
    return {
        "id": f"masto:{status_id}",
        "ts": created,
        "source": SOURCE,
        "category": "social",
        "text": f"@{handle}: {text[:280]}",
        "url": url,
        "raw_key": None,
    }


def run() -> int:
    instance = os.environ.get("MASTODON_INSTANCE", DEFAULT_INSTANCE).strip() or DEFAULT_INSTANCE
    rows: list[dict[str, str | None]] = []
    seen: set[str] = set()
    for keyword in _keywords():
        try:
            doc = _search(instance, keyword)
        except Exception as exc:  # noqa: BLE001
            log.warning("mastodon search failed for %r: %s", keyword, exc)
            continue
        for status in doc.get("statuses", []):
            row = _row_from_status(status)
            if row is None:
                continue
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            rows.append(row)

    if rows:
        supabase().table("official_updates").upsert(rows, on_conflict="id").execute()
    log.info("mastodon_pr: wrote %d rows from %s", len(rows), instance)
    return len(rows)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
