"""
Ingest LUMA's "Averías más relevantes" / "Notable outages" page.

URLs:
  https://lumapr.com/averias-mas-relevantes/    (es)
  https://lumapr.com/notable-outages/?lang=en   (en)

Per LUMA: "the information on this page reflects outages impacting greater
than 500 customers." Entries typically include municipality, sector, ETR
window, and a short description. The list is client-rendered so we use the
same Playwright pattern as luma_service_updates.

Each entry is upserted into `official_updates` with category
``notable-outage`` so the UI feed can filter on it independently of avisos.
A dedup id is derived from a stable hash of the entry text — re-running
within a short window is a no-op.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sys
from datetime import UTC, datetime
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright
from selectolax.parser import HTMLParser

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase
from ._playwright import BROWSER_ARGS

_HOST = (os.environ.get("LUMA_OPERATOR_HOST") or "lumapr.com").rstrip("/")
URL = f"https://{_HOST}/averias-mas-relevantes/"
SOURCE = f"{_HOST}/averias-mas-relevantes"

log = logging.getLogger(__name__)


def _safe_href(href: str | None) -> str:
    """
    Sanitize a scraped <a href>. The result is stored in official_updates.url
    and later rendered as an <a href> / window.open() target in the public UI,
    so a `javascript:` or `data:` scheme would be clickable stored-XSS. Accept
    only http(s) and site-relative paths; anything else falls back to the page
    URL itself (always safe, always relevant).
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
        browser = p.chromium.launch(args=BROWSER_ARGS)
        ctx = browser.new_context(
            user_agent="islagrid-ai/0.1 (+contact@islagrid.app)",
            locale="es-PR",
        )
        page = ctx.new_page()
        page.goto(URL, wait_until="domcontentloaded", timeout=45_000)
        # The list hydrates a few seconds after DOM ready.
        page.wait_for_timeout(5_000)
        html = page.content()
        browser.close()
        return html


def _parse(html: str) -> list[dict[str, str]]:
    tree = HTMLParser(html)
    items: list[dict[str, str]] = []
    # LUMA wraps each entry in a row; class names have churned across redesigns
    # so we accept a list of plausible selectors. Anything that has a heading
    # plus paragraph siblings is treated as one outage entry.
    selectors = [
        ".outage-row",
        ".notable-outage",
        ".outage-card",
        "tr.outage",
        "article.outage",
        ".elementor-post",
        "li.outage-item",
    ]
    nodes = []
    for sel in selectors:
        found = tree.css(sel)
        if found:
            nodes = found
            break
    if not nodes:
        # Last-ditch: any table row with both a municipality-like token and an
        # ETR-like time token. Keeps us from going silent if LUMA rebuilds.
        for tr in tree.css("tr"):
            cells = [c.text(strip=True) for c in tr.css("td, th")]
            text = " | ".join(cells)
            if not text or len(cells) < 2:
                continue
            if any(t for t in cells if t.isdigit() and len(t) > 2):
                items.append({"text": text, "url": URL})
        return items

    for node in nodes:
        title_node = node.css_first("h2, h3, h4, .title, .municipality")
        title = title_node.text(strip=True) if title_node else ""
        body = " ".join(p.text(strip=True) for p in node.css("p, .description, .etr, .sector, td"))
        text = (f"{title} — {body}").strip(" —")
        if not text:
            continue
        href_node = node.css_first("a")
        href = href_node.attributes.get("href") if href_node else None
        items.append({"text": text[:500], "url": _safe_href(href)})
    return items


def run() -> int:
    html = _fetch()
    raw_key = save_raw(SOURCE, html.encode("utf-8"), ext="html", content_type="text/html")
    posts = _parse(html)
    if not posts:
        log.warning("luma_averias: no items parsed; raw at %s", raw_key)
        return 0

    now_iso = datetime.now(UTC).isoformat()
    payload = [
        {
            "id": f"averia:{hashlib.sha1(p['text'].encode('utf-8')).hexdigest()[:16]}",
            "ts": now_iso,
            "source": SOURCE,
            "category": "notable-outage",
            "text": p["text"],
            "url": p["url"],
            "raw_key": raw_key,
        }
        for p in posts
    ]
    supabase().table("official_updates").upsert(payload, on_conflict="id").execute()
    log.info("luma_averias: upserted %d entries", len(payload))
    return len(payload)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
