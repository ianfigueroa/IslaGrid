"""
Scrape LUMA's "Resumen del Sistema" page for demand, reserves, and peaks.

The page is JS-rendered; we use Playwright to wait for the MW elements before
reading the DOM. When LUMA's back-end is in maintenance the same page renders
empty MW slots with a maintenance disclaimer — we detect this and mark the
snapshot `source_stale=True` instead of pretending we got numbers.
"""

from __future__ import annotations

import logging
import os
import re
import sys
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright

from ..pipeline.risk import GridInputs, classify
from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

# If/when the operator contract transitions, set LUMA_OPERATOR_HOST to the
# successor's domain (no scheme, no trailing slash). All luma_* parsers honor
# this env var so swapping is a config-only change. See docs/RUNBOOK.md.
_HOST = (os.environ.get("LUMA_OPERATOR_HOST") or "lumapr.com").rstrip("/")
URL = f"https://{_HOST}/resumen-del-sistema/"
SOURCE = _HOST

LABELS = {
    "demand": ["Demanda Actual", "Current Demand"],
    "next_hour": ["Demanda Próxima", "Next Hour Demand"],
    "reserve_current": ["Reserva Actual", "Current Reserve"],
    "peak_demand": ["Demanda Pico", "Peak Demand"],
    "peak_reserve": ["Reserva Pico", "Peak Reserve"],
}

MAINTENANCE_HINTS = [
    "en mantenimiento",
    "under maintenance",
    "podría no estar actualizada",
]

log = logging.getLogger(__name__)


def _grab_number_near_label(html: str, label_variants: list[str]) -> float | None:
    """
    LUMA's markup repeats label/MW pairs:
        <h3 class="label">Demanda Actual</h3>
        <p class="mw-text">2418<span>MW</span></p>
    The MW text immediately follows the label in source order.
    """
    for label in label_variants:
        pattern = re.compile(
            rf"{re.escape(label)}.{{0,500}}?<p[^>]*>\s*([\d,\.]+)\s*<span",
            re.IGNORECASE | re.DOTALL,
        )
        m = pattern.search(html)
        if not m:
            continue
        raw = m.group(1).replace(",", "")
        try:
            return float(raw)
        except ValueError:
            continue
    return None


def _fetch() -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        ctx = browser.new_context(user_agent="islagrid-ai/0.1 (+contact@islagrid.app)")
        page = ctx.new_page()
        page.goto(URL, wait_until="domcontentloaded", timeout=45_000)
        # Give JS up to 5s to populate MW values; we accept stale state if it doesn't.
        page.wait_for_timeout(5_000)
        html = page.content()
        browser.close()
        return html


def run() -> int:
    html = _fetch()
    body = html.encode("utf-8")
    raw_key = save_raw(SOURCE, body, ext="html", content_type="text/html; charset=utf-8")

    is_stale = any(h in html.lower() for h in MAINTENANCE_HINTS)
    demand = _grab_number_near_label(html, LABELS["demand"])
    next_demand = _grab_number_near_label(html, LABELS["next_hour"])
    reserve = _grab_number_near_label(html, LABELS["reserve_current"])
    peak_d = _grab_number_near_label(html, LABELS["peak_demand"])
    peak_r = _grab_number_near_label(html, LABELS["peak_reserve"])

    # Compute total generation as the closest proxy we can get without more parsing.
    # LUMA's page doesn't always expose available capacity; leave None when unknown.
    available_capacity = None
    if demand is not None and reserve is not None:
        available_capacity = demand + reserve

    verdict = classify(
        GridInputs(
            current_demand_mw=demand,
            next_hour_demand_mw=next_demand,
            available_capacity_mw=available_capacity,
            operational_reserve_mw=reserve,
            source_stale=is_stale,
        )
    )

    row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "current_demand_mw": demand,
        "next_hour_demand_mw": next_demand,
        "total_generation_mw": available_capacity,
        "available_capacity_mw": available_capacity,
        "spinning_reserve_mw": None,
        "operational_reserve_mw": reserve,
        "peak_demand_forecast_mw": peak_d,
        "peak_reserve_forecast_mw": peak_r,
        "status": verdict.status,
        "status_reasons": verdict.reasons,
        "source": SOURCE,
        "source_stale": is_stale,
        "raw_key": raw_key,
    }
    supabase().table("grid_snapshots").insert(row).execute()
    log.info("LUMA snapshot stored: status=%s stale=%s raw=%s", verdict.status, is_stale, raw_key)
    return 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() else 1)
