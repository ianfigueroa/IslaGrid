"""
Pull LUMA BPS Monitoring daily availability PDFs.

Workflow:
  1. List the BPS page and find the newest .pdf link.
  2. Skip if we've already ingested that filename.
  3. Download and parse — store availability/reserves/generation summary as an
     `official_updates` row, and the raw PDF in R2.

This source is daily and informational; it doesn't drive `grid_snapshots`.
"""

from __future__ import annotations

import logging
import os
import re
import sys
from datetime import datetime, timezone

from io import BytesIO

import httpx
import pdfplumber

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

# Successor-operator swap: set LUMA_OPERATOR_HOST in env to redirect all
# luma_* parsers without code changes. See docs/RUNBOOK.md.
_HOST = (os.environ.get("LUMA_OPERATOR_HOST") or "lumapr.com").rstrip("/")
PAGE_URL = f"https://{_HOST}/bps-monitoring/"
SOURCE = f"{_HOST}/bps"

log = logging.getLogger(__name__)


def _find_latest_pdf(html: str) -> str | None:
    candidates = re.findall(r"https://lumapr\.com/so_document/[^\"' ]+\.pdf", html, re.IGNORECASE)
    return candidates[0] if candidates else None


def _already_ingested(filename: str) -> bool:
    res = (
        supabase()
        .table("official_updates")
        .select("id")
        .eq("id", filename)
        .limit(1)
        .execute()
    )
    return bool(res.data)


def _summarize(pdf_bytes: bytes) -> str:
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        pages = [p.extract_text() or "" for p in pdf.pages[:2]]
    text = "\n".join(pages)
    # Keep it terse — the timeline can show 600 chars max.
    snippet = re.sub(r"\s+", " ", text).strip()
    return snippet[:600] + ("…" if len(snippet) > 600 else "")


def run() -> int:
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        index = client.get(
            PAGE_URL, headers={"User-Agent": "islagrid-ai/0.1 (+contact@islagrid.app)"}
        )
        pdf_url = _find_latest_pdf(index.text)
        if not pdf_url:
            log.warning("No BPS PDF link found on %s", PAGE_URL)
            return 0
        filename = pdf_url.rsplit("/", 1)[-1]
        if _already_ingested(filename):
            log.info("BPS PDF %s already ingested", filename)
            return 0
        pdf = client.get(pdf_url)
    raw_key = save_raw(SOURCE, pdf.content, ext="pdf", content_type="application/pdf")

    try:
        summary = _summarize(pdf.content)
    except Exception as e:  # pdfplumber is finicky — never let it crash the pipeline
        log.warning("Could not summarize BPS PDF: %s", e)
        summary = f"BPS daily report posted: {filename}"

    supabase().table("official_updates").insert(
        {
            "id": filename,
            "ts": datetime.now(timezone.utc).isoformat(),
            "source": SOURCE,
            "category": "bps-daily",
            "text": summary,
            "url": pdf_url,
            "raw_key": raw_key,
        }
    ).execute()
    log.info("BPS update stored: %s", filename)
    return 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
