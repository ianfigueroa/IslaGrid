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
from datetime import UTC, datetime

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

# LUMA's Resumen page renders each metric as a JS gauge. The numeric value
# is NOT in the static HTML's <p class="mw-text"> (that stays literally "MW")
# — it lives in a `data-value` attribute on the enclosing `.gauge-container`
# div, set by JS after load. We match each gauge by its <h3 class="label">
# text. The two "Pico" values are plain text rather than gauges.
GAUGE_LABELS = {
    "demand": ["Demanda Actual", "Current Demand"],
    "next_hour": ["Demanda Próxima", "Next Hour Demand"],
    "reserve_current": ["Reserva Actual", "Current Reserve"],
}
TEXT_LABELS = {
    "peak_demand": ["Demanda Pico", "Peak Demand"],
    "peak_reserve": ["Reserva Pico", "Peak Reserve"],
}

MAINTENANCE_HINTS = [
    "en mantenimiento",
    "under maintenance",
    "podría no estar actualizada",
]

log = logging.getLogger(__name__)


def _to_float(raw: str | None) -> float | None:
    if not raw:
        return None
    try:
        return float(raw.replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def _fetch() -> tuple[str, dict[str, float | None], str]:
    """Return (raw_html, parsed_values, visible_text)."""
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        ctx = browser.new_context(user_agent="islagrid-ai/0.1 (+contact@islagrid.app)")
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle", timeout=60_000)
        # The gauges populate their data-value attribute via JS after load.
        page.wait_for_timeout(6_000)
        html = page.content()
        # Each .gauge-container carries data-value + an inner .label. Pull all
        # of them as {label: value} so we don't depend on DOM source order.
        gauges = page.eval_on_selector_all(
            ".gauge-container",
            "els => els.map(e => ({"
            " label: (e.querySelector('.label')?.textContent || '').trim(),"
            " value: e.getAttribute('data-value')"
            "}))",
        )
        visible_text = page.locator("body").inner_text()
        browser.close()

    by_label = {g["label"]: g["value"] for g in gauges if g.get("label")}
    values: dict[str, float | None] = {}
    for key, variants in GAUGE_LABELS.items():
        values[key] = None
        for variant in variants:
            if variant in by_label:
                values[key] = _to_float(by_label[variant])
                break
    # "Pico" values render as plain text like "2730MW".
    for key, variants in TEXT_LABELS.items():
        values[key] = None
        for variant in variants:
            m = re.search(
                rf"{re.escape(variant)}[\s\S]{{0,80}}?([\d,]+)\s*MW",
                visible_text,
                re.IGNORECASE,
            )
            if m:
                values[key] = _to_float(m.group(1))
                break
    return html, values, visible_text


def run() -> int:
    html, parsed, visible_text = _fetch()
    body = html.encode("utf-8")
    raw_key = save_raw(SOURCE, body, ext="html", content_type="text/html; charset=utf-8")

    has_maintenance_banner = any(
        h in html.lower() or h in visible_text.lower() for h in MAINTENANCE_HINTS
    )
    demand = parsed["demand"]
    next_demand = parsed["next_hour"]
    reserve = parsed["reserve_current"]
    peak_d = parsed["peak_demand"]
    peak_r = parsed["peak_reserve"]
    # The "podría no estar actualizada" disclaimer is on the page chronically,
    # even when the MW values are fresh. Only treat the snapshot as stale when
    # the banner is present AND every core number is missing — that's the
    # actual "blank slots + maintenance" state the comment up top describes.
    is_stale = has_maintenance_banner and demand is None and reserve is None

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
        "ts": datetime.now(UTC).isoformat(),
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
