"""
Unverified-tier ingestion for grid-related X/Twitter accounts.

Primary path is a Nitter mirror RSS feed (no auth, no terms violation),
fallback is the X v2 API free tier (500 reads/month) when X_BEARER_TOKEN is
set. Output rows always carry `source = 'social.x.unverified'` so the UI can
visually separate them from anything official.

We poll a small list of known PR grid accounts; add more by setting
SOCIAL_HANDLES env var to a comma-separated list (handles without @).
"""

from __future__ import annotations

import logging
import os
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

SOURCE = "social.x.unverified"
DEFAULT_HANDLES = ("LUMAEnergyPR", "aeepr")
NITTER_HOSTS = (
    "nitter.poast.org",
    "nitter.privacydev.net",
    "nitter.net",
)

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Post:
    handle: str
    id: str
    ts: str  # ISO
    text: str
    url: str


@retry(wait=wait_exponential(min=2, max=15), stop=stop_after_attempt(3), reraise=True)
def _fetch_nitter(handle: str, host: str) -> bytes:
    url = f"https://{host}/{handle}/rss"
    with httpx.Client(timeout=15.0, follow_redirects=True) as client:
        r = client.get(url, headers={"User-Agent": "islagrid-ai/0.1"})
        r.raise_for_status()
        return r.content


def _parse_nitter(handle: str, body: bytes) -> list[Post]:
    posts: list[Post] = []
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return posts
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        guid = (item.findtext("guid") or link).strip()
        if not title or not link:
            continue
        try:
            ts = datetime.strptime(pub, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            ts = datetime.now(timezone.utc).isoformat()
        posts.append(Post(handle=handle, id=guid, ts=ts, text=title, url=link))
    return posts


def _fetch_x_api(handle: str, bearer: str) -> list[Post]:
    # Free-tier endpoint: /2/users/by/username/{handle} → id, then
    # /2/users/{id}/tweets?max_results=5. We compress these into one call by
    # asking for username lookups inline.
    headers = {"Authorization": f"Bearer {bearer}", "User-Agent": "islagrid-ai/0.1"}
    with httpx.Client(timeout=15.0, headers=headers) as client:
        u = client.get(f"https://api.x.com/2/users/by/username/{handle}")
        if u.status_code != 200:
            log.warning("X API user lookup %s: %s", handle, u.status_code)
            return []
        user_id = u.json().get("data", {}).get("id")
        if not user_id:
            return []
        t = client.get(
            f"https://api.x.com/2/users/{user_id}/tweets",
            params={"max_results": 5, "tweet.fields": "created_at"},
        )
        if t.status_code != 200:
            log.warning("X API tweets %s: %s", handle, t.status_code)
            return []
        data = t.json().get("data", []) or []
        return [
            Post(
                handle=handle,
                id=str(item["id"]),
                ts=item.get("created_at") or datetime.now(timezone.utc).isoformat(),
                text=item.get("text", ""),
                url=f"https://x.com/{handle}/status/{item['id']}",
            )
            for item in data
        ]


def _try_nitter(handle: str) -> list[Post]:
    last: Exception | None = None
    for host in NITTER_HOSTS:
        try:
            body = _fetch_nitter(handle, host)
            save_raw(SOURCE, body, ext="xml", content_type="application/rss+xml")
            posts = _parse_nitter(handle, body)
            if posts:
                return posts
        except Exception as exc:  # noqa: BLE001
            last = exc
            continue
    if last is not None:
        log.warning("All nitter hosts failed for %s: %s", handle, last)
    return []


def _handles() -> Iterable[str]:
    raw = os.environ.get("SOCIAL_HANDLES", "").strip()
    if raw:
        return tuple(h.strip().lstrip("@") for h in raw.split(",") if h.strip())
    return DEFAULT_HANDLES


def run() -> int:
    bearer = os.environ.get("X_BEARER_TOKEN", "").strip()
    rows: list[dict[str, str | None]] = []
    for handle in _handles():
        posts = _try_nitter(handle)
        if not posts and bearer:
            posts = _fetch_x_api(handle, bearer)
        for p in posts[:5]:  # cap per handle so a chatty account can't flood
            rows.append(
                {
                    "id": f"x:{handle}:{p.id}",
                    "ts": p.ts,
                    "source": SOURCE,
                    "category": "social",
                    "text": f"@{handle}: {p.text[:280]}",
                    "url": p.url,
                    "raw_key": None,
                }
            )

    if rows:
        supabase().table("official_updates").upsert(rows, on_conflict="id").execute()
    log.info("social_unverified: wrote %d rows", len(rows))
    return len(rows)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
