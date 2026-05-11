"""
Scrape PREB rate orders from energia.pr.gov.

Workflow:
  1. List the "tarifas" tag page on PREB and grab the latest rate-order PDFs.
  2. Skip PDFs we've already ingested (deduped by URL → R2 key).
  3. Archive the raw PDF to R2 first (so reparses are always possible).
  4. Try to parse the four core line items per category. If we find fewer than
     all four for either residential or commercial, we DO NOT insert — the seed
     stays in place. Better to under-update than guess a wrong cent.
  5. On confident parse, upsert one row per (effective_date, rate_category)
     into `preb_rates`, tagging `source_doc_url` and `source_pdf_key`.

PREB tariff feed: https://energia.pr.gov/numero-de-tema/?_tema=tarifas
"""

from __future__ import annotations

import logging
import os
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from io import BytesIO
from typing import Iterable

import httpx
import pdfplumber

from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

PAGE_URL = "https://energia.pr.gov/numero-de-tema/?_tema=tarifas"
SOURCE = "preb"
USER_AGENT = "islagrid-ai/0.1 (+iantdm11@gmail.com)"

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ParsedRate:
    """Components extracted from a single rate-order PDF for one category."""

    category: str  # "residential" | "commercial"
    base: float
    fuel_adj: float
    purchased_pwr: float
    fixed_monthly: float
    effective_date: date

    def rows(
        self, *, source_doc_url: str, source_pdf_key: str
    ) -> list[dict[str, object]]:
        common = {
            "effective_date": self.effective_date.isoformat(),
            "source_url": source_doc_url,
            "source_doc_url": source_doc_url,
            "source_pdf_key": source_pdf_key,
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        }
        return [
            {**common, "rate_category": f"{self.category}_base", "rate_per_kwh": self.base},
            {**common, "rate_category": f"{self.category}_fuel_adj", "rate_per_kwh": self.fuel_adj},
            {**common, "rate_category": f"{self.category}_purchased_pwr", "rate_per_kwh": self.purchased_pwr},
            {**common, "rate_category": f"{self.category}_fixed", "rate_per_kwh": self.fixed_monthly},
        ]


def _list_pdfs(html: str) -> list[str]:
    # Permissive — energia.pr.gov serves PDFs from /wp-content/uploads/...
    matches = re.findall(
        r"https://energia\.pr\.gov/wp-content/uploads/[^\"'<> ]+\.pdf",
        html,
        re.IGNORECASE,
    )
    # Preserve order, dedupe.
    seen: set[str] = set()
    ordered: list[str] = []
    for m in matches:
        if m not in seen:
            seen.add(m)
            ordered.append(m)
    return ordered


def _already_ingested(pdf_url: str) -> bool:
    res = (
        supabase()
        .table("preb_rates")
        .select("effective_date")
        .eq("source_doc_url", pdf_url)
        .limit(1)
        .execute()
    )
    return bool(res.data)


_NUM = r"(?:\$\s*)?(\d+(?:[.,]\d{1,5}))"
_MONEY_OR_KWH = re.compile(rf"\b{_NUM}\s*(?:per\s*kWh|/?kWh|\$)?", re.IGNORECASE)


def _find_number(text: str, *needles: str) -> float | None:
    """
    Look for a numeric value within a 240-char window after any of `needles`.
    Returns None when no reliable hit is found — caller treats that as a
    parse failure rather than guessing.
    """
    lowered = text.lower()
    for needle in needles:
        idx = lowered.find(needle.lower())
        if idx == -1:
            continue
        window = text[idx : idx + 240]
        m = _MONEY_OR_KWH.search(window)
        if not m:
            continue
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            continue
    return None


def _find_effective_date(text: str) -> date | None:
    # Common phrasing on PREB orders: "effective <Month> <day>, <year>" or
    # Spanish "vigencia a partir del <day> de <month> de <year>".
    en = re.search(
        r"effective\s+(?:on\s+)?([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})",
        text,
        re.IGNORECASE,
    )
    if en:
        try:
            return datetime.strptime(
                f"{en.group(1)} {en.group(2)} {en.group(3)}", "%B %d %Y"
            ).date()
        except ValueError:
            pass
    iso = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
    if iso:
        try:
            return date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        except ValueError:
            return None
    return None


def parse_pdf(pdf_bytes: bytes) -> list[ParsedRate]:
    """
    Extract residential + commercial rate components.

    Returns an empty list when confidence is low; the pipeline then archives
    the raw PDF but writes no DB rows.
    """
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        text = "\n".join(p.extract_text() or "" for p in pdf.pages)

    effective = _find_effective_date(text)
    if not effective:
        log.warning("preb_rates: no effective date found, skipping")
        return []

    parsed: list[ParsedRate] = []
    for category, needles in (
        (
            "residential",
            {
                "base": ("Residential Basic", "Residential Energy", "Residential base"),
                "fuel_adj": ("Fuel Adjustment", "Fuel adjustment"),
                "purchased_pwr": ("Purchased Power", "Purchased power"),
                "fixed_monthly": ("Customer Charge", "Cargo de Cliente", "Fixed Monthly"),
            },
        ),
        (
            "commercial",
            {
                "base": ("Commercial Basic", "General Service", "Commercial base"),
                "fuel_adj": ("Fuel Adjustment", "Fuel adjustment"),
                "purchased_pwr": ("Purchased Power", "Purchased power"),
                "fixed_monthly": ("Customer Charge", "Cargo de Cliente", "Fixed Monthly"),
            },
        ),
    ):
        components: dict[str, float] = {}
        ok = True
        for key, terms in needles.items():
            value = _find_number(text, *terms)
            if value is None:
                ok = False
                break
            components[key] = value
        if not ok:
            log.warning(
                "preb_rates: confidence too low for %s — skipping insert", category
            )
            continue
        parsed.append(
            ParsedRate(
                category=category,
                base=components["base"],
                fuel_adj=components["fuel_adj"],
                purchased_pwr=components["purchased_pwr"],
                fixed_monthly=components["fixed_monthly"],
                effective_date=effective,
            )
        )
    return parsed


def _upsert(rows: Iterable[dict[str, object]]) -> None:
    payload = list(rows)
    if not payload:
        return
    supabase().table("preb_rates").upsert(
        payload, on_conflict="effective_date,rate_category"
    ).execute()


def _override_page_url() -> str:
    return os.environ.get("PREB_TARIFFS_URL", PAGE_URL)


def run(limit_pdfs: int = 3) -> int:
    """
    Process up to `limit_pdfs` newest rate-order PDFs. Returns the count of
    PDFs that produced at least one confident parse (and therefore wrote
    rows).
    """
    inserted = 0
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        index = client.get(_override_page_url(), headers={"User-Agent": USER_AGENT})
        pdfs = _list_pdfs(index.text)[:limit_pdfs]
        if not pdfs:
            log.warning("preb_rates: no PDFs found on %s", _override_page_url())
            return 0

        for pdf_url in pdfs:
            if _already_ingested(pdf_url):
                log.info("preb_rates: %s already ingested", pdf_url)
                continue
            resp = client.get(pdf_url, headers={"User-Agent": USER_AGENT})
            if resp.status_code != 200 or not resp.content:
                log.warning("preb_rates: %s returned %s", pdf_url, resp.status_code)
                continue
            raw_key = save_raw(
                SOURCE,
                resp.content,
                ext="pdf",
                content_type="application/pdf",
            )

            try:
                parsed = parse_pdf(resp.content)
            except Exception as exc:  # pdfplumber can throw on malformed PDFs
                log.exception("preb_rates: parse failure for %s: %s", pdf_url, exc)
                parsed = []

            if not parsed:
                # Archive succeeded; no row written. The seed in lib/rates.ts +
                # migration 0003 keeps serving until a future PDF parses cleanly.
                log.info("preb_rates: archived %s but no rows written", pdf_url)
                continue

            all_rows: list[dict[str, object]] = []
            for category_rates in parsed:
                all_rows.extend(
                    category_rates.rows(
                        source_doc_url=pdf_url, source_pdf_key=raw_key
                    )
                )
            _upsert(all_rows)
            inserted += 1
            log.info(
                "preb_rates: wrote %d rows for %s (effective %s)",
                len(all_rows),
                pdf_url,
                parsed[0].effective_date.isoformat(),
            )
    return inserted


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    sys.exit(0 if run() >= 0 else 1)
