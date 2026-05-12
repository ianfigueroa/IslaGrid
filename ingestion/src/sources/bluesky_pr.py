"""
Bluesky public-firehose ingest, filtered to PR grid keywords.

Uses the public app.bsky.feed.searchPosts endpoint — no auth required for
read access. Filters in Spanish + English on outage-related terms. Every
matching post lands in ``official_updates`` with ``source = 'social.bluesky'``
and category ``social`` so the UI clearly flags it as unverified.

Bluesky's free public API has a rate limit; we keep the call count low by
combining keywords into one search per run.
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from ..pipeline.supabase_client import supabase

SOURCE = "social.bluesky"
SEARCH_URL = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts"

# Keywords we OR-combine. Bluesky's search is whole-word; we include both
# Spanish and English forms because the timeline is bilingual.
DEFAULT_KEYWORDS = (
    "apagón puerto rico",
    "sin luz pr",
    "LUMA energía",
    "LUMA outage",
    "generación pr",
    "apagones",
)

log = logging.getLogger(__name__)


@retry(wait=wait_exponential(min=2, max=15), stop=stop_after_attempt(3), reraise=True)
def _search(query: str, limit: int = 25) -> dict[str, Any]:
    params = {"q": query, "limit": limit, "sort": "latest"}
    with httpx.Client(timeout=20.0, headers={"User-Agent": "islagrid-ai/0.1"}) as c:
        r = c.get(SEARCH_URL, params=params)
        r.raise_for_status()
        return r.json()


def _keywords() -> tuple[str, ...]:
    raw = os.environ.get("BLUESKY_KEYWORDS", "").strip()
    if raw:
        return tuple(k.strip() for k in raw.split(",") if k.strip())
    return DEFAULT_KEYWORDS


def _row_from_post(post: dict[str, Any]) -> dict[str, str | None] | None:
    record = post.get("record") or {}
    text = (record.get("text") or "").strip()
    if not text:
        return None
    uri = post.get("uri") or ""
    if not uri.startswith("at://"):
        return None
    # at://{did}/app.bsky.feed.post/{rkey}
    parts = uri[5:].split("/")
    if len(parts) < 3:
        return None
    did, _, rkey = parts[0], parts[1], parts[2]
    handle = (post.get("author") or {}).get("handle") or did
    created = record.get("createdAt") or datetime.now(timezone.utc).isoformat()
    web_url = f"https://bsky.app/profile/{handle}/post/{rkey}"
    return {
        "id": f"bsky:{did}:{rkey}",
        "ts": created,
        "source": SOURCE,
        "category": "social",
        "text": f"@{handle}: {text[:280]}",
        "url": web_url,
        "raw_key": None,
    }


def run() -> int:
    rows: list[dict[str, str | None]] = []
    seen_ids: set[str] = set()
    for keyword in _keywords():
        try:
            doc = _search(keyword)
        except Exception as exc:  # noqa: BLE001
            log.warning("bluesky search failed for %r: %s", keyword, exc)
            continue
        for post in doc.get("posts", []):
            row = _row_from_post(post)
            if row is None:
                continue
            if row["id"] in seen_ids:
                continue
            seen_ids.add(row["id"])
            rows.append(row)

    if rows:
        supabase().table("official_updates").upsert(rows, on_conflict="id").execute()
    log.info("bluesky_pr: wrote %d rows", len(rows))
    return len(rows)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
