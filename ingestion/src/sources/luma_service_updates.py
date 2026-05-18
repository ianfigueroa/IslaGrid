"""
Ingest LUMA's "Avisos" page — Spanish-language service notices. These are
short announcements, often outage-related, that LUMA publishes outside their
structured planned-work table. Each entry becomes an `official_updates`
row and feeds the Phase 8 outage-events NER.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright
from selectolax.parser import HTMLParser

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

_HOST = (os.environ.get("LUMA_OPERATOR_HOST") or "lumapr.com").rstrip("/")
URL = f"https://{_HOST}/avisos/"
SOURCE = f"{_HOST}/avisos"

log = logging.getLogger(__name__)


def _safe_href(href: str | None) -> str:
    """Sanitize a scraped <a href>. Stored in `official_updates.url` and
    rendered as an <a> target in the UI, so `javascript:` / `data:` schemes
    would be clickable stored-XSS. Accept only http(s) and site-relative
    paths; anything else falls back to the source URL itself.

    Mirror of the same helper in `luma_averias.py` — kept inline here for
    surgical scope; the cleanup commit consolidates both into a shared lib.
    """
    if not href:
        return URL
    href = href.strip()
    if href.startswith("/"):
        return f"https://{_HOST}{href}"
    try:
        scheme = urlparse(href).scheme.lower()
    except ValueError:
        return URL
    return href if scheme in ("http", "https") else URL


def _fetch() -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        ctx = browser.new_context(user_agent="islagrid-ai/0.1 (+contact@islagrid.app)")
        page = ctx.new_page()
        page.goto(URL, wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_timeout(3_500)
        html = page.content()
        browser.close()
        return html


def _parse(html: str) -> list[dict[str, str]]:
    tree = HTMLParser(html)
    items: list[dict[str, str]] = []
    # The avisos page uses <article> wrappers for each post; fall back to any
    # h2/h3 followed by text if the markup shifts.
    for art in tree.css("article, .aviso, .post-card"):
        title_node = art.css_first("h2, h3, .title")
        if not title_node:
            continue
        title = title_node.text(strip=True)
        body = " ".join(p.text(strip=True) for p in art.css("p")) or ""
        href = (title_node.css_first("a") or art.css_first("a"))
        raw_url = href.attributes.get("href") if href else None
        url = _safe_href(raw_url)
        text = f"{title} — {body[:280]}".strip(" —")
        if not text:
            continue
        items.append({"title": title, "text": text, "url": url})
    return items


def run() -> int:
    html = _fetch()
    raw_key = save_raw(SOURCE, html.encode("utf-8"), ext="html", content_type="text/html")
    posts = _parse(html)
    if not posts:
        log.warning("luma avisos: no items parsed; raw at %s", raw_key)
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    payload = [
        {
            "id": f"aviso:{hashlib.sha1(p['text'].encode('utf-8')).hexdigest()[:16]}",
            "ts": now_iso,
            "source": SOURCE,
            "category": "announcement",
            "text": p["text"],
            "url": p["url"],
            "raw_key": raw_key,
        }
        for p in posts
    ]
    supabase().table("official_updates").upsert(payload, on_conflict="id").execute()
    log.info("luma avisos: upserted %d posts", len(payload))
    return len(payload)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
