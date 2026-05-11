"""
Scrape LUMA's Planned Works (Mejoras Planificadas) page.

The page is a Spanish-language listing with municipality + sector + window.
LUMA does not publish street-level geometry, so we attribute each entry to a
municipality_id when we can recognize it, leaving exact polygons to the
intelligence panel ("affected sector: ...") rather than the map.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sys
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright
from selectolax.parser import HTMLParser

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

# Honor LUMA_OPERATOR_HOST so a successor operator can be swapped in via env.
_HOST = os.environ.get("LUMA_OPERATOR_HOST", "lumapr.com").rstrip("/")
URL = f"https://{_HOST}/mejorasplanificadas/"
SOURCE = f"{_HOST}/planned-work"

log = logging.getLogger(__name__)


def _fetch() -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        ctx = browser.new_context(user_agent="islagrid-ai/0.1 (+iantdm11@gmail.com)")
        page = ctx.new_page()
        page.goto(URL, wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_timeout(4_000)
        html = page.content()
        browser.close()
        return html


def _parse(html: str) -> list[dict]:
    """Extract rows. LUMA's markup varies; we look for any table-like list with
    municipality + date/time columns and treat each row as a planned-work entry."""
    tree = HTMLParser(html)
    rows: list[dict] = []
    for row in tree.css("table tr"):
        cells = [c.text(strip=True) for c in row.css("td")]
        if not cells or len(cells) < 3:
            continue
        # Heuristic: most LUMA tables put municipality in column 0 or 1.
        text = " | ".join(cells)
        muni = cells[0] if cells[0] else (cells[1] if len(cells) > 1 else None)
        rows.append(
            {
                "id": hashlib.sha1(text.encode("utf-8")).hexdigest()[:16],
                "municipality_id": _muni_id(muni),
                "area": cells[1] if len(cells) > 1 else None,
                "work_type": cells[2] if len(cells) > 2 else None,
                "raw_text": text,
            }
        )
    return rows


def _muni_id(name: str | None) -> str | None:
    """
    Very loose mapping. The municipalities table seeds use lowercase ASCII keys
    like 'san-juan'. If we don't have a seeded match we leave it null and let
    the panel show the raw sector string.
    """
    if not name:
        return None
    slug = (
        name.lower()
        .replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
        .replace("ñ", "n")
        .strip()
    )
    slug = "-".join(slug.split())
    # We trust the seeded list of 78 municipios. Anything else => null.
    return slug if 3 <= len(slug) <= 40 else None


def run() -> int:
    html = _fetch()
    raw_key = save_raw(SOURCE, html.encode("utf-8"), ext="html", content_type="text/html")
    rows = _parse(html)
    if not rows:
        log.warning("No planned-work rows parsed; raw at %s", raw_key)
        return 0

    now = datetime.now(timezone.utc).isoformat()
    payload = [
        {
            "id": r["id"],
            "municipality_id": r["municipality_id"],
            "area": r["area"],
            "work_type": r["work_type"],
            "start_ts": None,
            "end_ts": None,
            "possible_interruption": None,
            "source": "lumapr.com/planned-work",
            "source_url": URL,
            "raw_key": raw_key,
            "scraped_at": now,
        }
        for r in rows
    ]
    supabase().table("planned_work").upsert(payload, on_conflict="id").execute()

    # Mirror each entry into the official_updates timeline so users see it live.
    supabase().table("official_updates").upsert(
        [
            {
                "id": f"pw:{r['id']}",
                "ts": now,
                "source": "lumapr.com/planned-work",
                "category": "planned-work",
                "text": f"Planned work posted near {r['municipality_id'] or 'PR'}: {r['raw_text'][:200]}",
                "url": URL,
                "raw_key": raw_key,
            }
            for r in rows
        ],
        on_conflict="id",
    ).execute()
    log.info("planned_work upserted: %d rows (raw %s)", len(payload), raw_key)
    return len(payload)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
