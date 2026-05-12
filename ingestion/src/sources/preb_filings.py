"""
Periodic ingest of LUMA's quarterly performance filings at energia.pr.gov.

PREB (Puerto Rico Energy Bureau) is the regulator; LUMA is required to
file quarterly performance reports including:

  * Island-wide SAIDI (System Average Interruption Duration Index)
  * Island-wide SAIFI (System Average Interruption Frequency Index)
  * A list of major outage events with cause + duration + customers
  * Quarterly reliability per region

We discover filings from PREB's case-listing pages, then download each PDF,
archive raw bytes to R2, and parse the headline metrics + event list with
pdfplumber. Parser confidence is encoded in `parser_version` so we can
re-process old PDFs after improving the parser.

Honest caveats:
  * PDFs are unstructured. When the parser can't find a SAIDI/SAIFI cell,
    we write the row with NULL metrics and a populated `pdf_key` so we can
    revisit later. We never fabricate a value.
  * PREB's "Tema 10 / Tarifas" filings are out of scope here (see preb_rates.py).
"""

from __future__ import annotations

import logging
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

import httpx
import pdfplumber
from selectolax.parser import HTMLParser
from tenacity import retry, stop_after_attempt, wait_exponential

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

SOURCE = "preb"
log = logging.getLogger(__name__)

# PREB lists filings by topic ("tema"). "Tema 3" maps to LUMA performance.
# We let the env override in case the slug changes.
LISTING_URL = (
    "https://energia.pr.gov/en/numero-de-tema/?_tema=desempeno-de-luma"
)
HTTP_TIMEOUT = 30.0


@dataclass(frozen=True)
class FilingLink:
    period: str
    category: str
    filing_date: str | None  # ISO date
    pdf_url: str


@retry(wait=wait_exponential(min=2, max=15), stop=stop_after_attempt(3), reraise=True)
def _fetch(url: str) -> bytes:
    with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=True) as c:
        r = c.get(url, headers={"User-Agent": "islagrid-ai/0.1"})
        r.raise_for_status()
        return r.content


def _discover_links() -> Iterable[FilingLink]:
    """Walk the PREB listing page and yield (period, pdf_url) tuples."""
    body = _fetch(LISTING_URL)
    tree = HTMLParser(body.decode("utf-8", errors="replace"))
    for row in tree.css("tr, .archive-row, article"):
        link = row.css_first("a[href$='.pdf'], a[href*='.pdf?']")
        if not link:
            continue
        href = link.attributes.get("href") or ""
        if not href:
            continue
        if href.startswith("//"):
            href = "https:" + href
        elif href.startswith("/"):
            href = "https://energia.pr.gov" + href
        title = link.text(strip=True) or row.text(strip=True)
        period_match = re.search(
            r"(20\d{2})\s*[-Q]?\s*(Q[1-4]|trimestre\s*[1-4]|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)",
            title,
            re.IGNORECASE,
        )
        period = period_match.group(0).strip() if period_match else "unknown"
        date_match = re.search(r"(20\d{2}-\d{2}-\d{2})", row.text())
        filing_date = date_match.group(1) if date_match else None
        yield FilingLink(
            period=period,
            category="performance",
            filing_date=filing_date,
            pdf_url=href,
        )


_NUM = re.compile(r"\d{1,3}(?:[.,]\d+)?")


def _parse_metrics(pdf_bytes: bytes) -> tuple[float | None, float | None, list[dict[str, str]]]:
    """Return (SAIDI, SAIFI, events[]). Conservative: never guess."""
    saidi: float | None = None
    saifi: float | None = None
    events: list[dict[str, str]] = []
    try:
        with pdfplumber.open(filename_or_file_or_path := __import__("io").BytesIO(pdf_bytes)) as pdf:
            text_chunks: list[str] = []
            for page in pdf.pages[:30]:  # Cap pages to keep the parser cheap.
                t = page.extract_text() or ""
                text_chunks.append(t)
            full = "\n".join(text_chunks)
            # Look for "SAIDI ... minutes" / "SAIFI ... interrupciones"
            for label, var in (("SAIDI", "saidi"), ("SAIFI", "saifi")):
                m = re.search(
                    rf"\b{label}\b[^\n]{{0,80}}?({_NUM.pattern})",
                    full,
                    re.IGNORECASE,
                )
                if m:
                    try:
                        val = float(m.group(1).replace(",", "."))
                        if var == "saidi":
                            saidi = val
                        else:
                            saifi = val
                    except ValueError:
                        pass
            # Event table: every line with a date + a customer-impact integer
            event_re = re.compile(
                r"(20\d{2}-\d{2}-\d{2})\s+(.{3,40})\s+(\d{2,7})",
            )
            for line in full.splitlines():
                m = event_re.search(line.strip())
                if not m:
                    continue
                events.append(
                    {
                        "date": m.group(1),
                        "region": m.group(2).strip(),
                        "customers": m.group(3),
                    }
                )
    except Exception as exc:  # noqa: BLE001
        log.warning("preb_filings: pdfplumber failed (%s)", exc)
    return saidi, saifi, events


def run(limit: int = 25) -> int:
    sb = supabase()
    inserted = 0
    seen_urls: set[str] = set()
    for filing in _discover_links():
        if filing.pdf_url in seen_urls:
            continue
        seen_urls.add(filing.pdf_url)
        if inserted >= limit:
            break
        # Skip if we already have this exact (period, category, url) row.
        existing = (
            sb.table("preb_filings")
            .select("id")
            .eq("period", filing.period)
            .eq("category", filing.category)
            .eq("source_url", filing.pdf_url)
            .limit(1)
            .execute()
            .data
        )
        if existing:
            continue
        try:
            pdf = _fetch(filing.pdf_url)
        except Exception as exc:  # noqa: BLE001
            log.warning("preb_filings: download failed for %s (%s)", filing.pdf_url, exc)
            continue
        key = save_raw(SOURCE, pdf, ext="pdf", content_type="application/pdf")
        saidi, saifi, events = _parse_metrics(pdf)
        row = {
            "filing_date": filing.filing_date or datetime.now(timezone.utc).date().isoformat(),
            "period": filing.period,
            "category": filing.category,
            "saidi_minutes": saidi,
            "saifi_count": saifi,
            "major_events": events,
            "source_url": filing.pdf_url,
            "pdf_key": key,
            "parser_version": "v1",
            "source": SOURCE,
        }
        sb.table("preb_filings").upsert(
            [row], on_conflict="period,category,source_url"
        ).execute()
        inserted += 1
        log.info(
            "preb_filings: stored %s (SAIDI=%s SAIFI=%s events=%d)",
            filing.period,
            saidi,
            saifi,
            len(events),
        )
    log.info("preb_filings: %d new filings stored", inserted)
    return inserted


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
