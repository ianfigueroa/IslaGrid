"""
Scrape Genera PR's public generation dashboard.

URL: https://genera-pr.com/data-generacion

Genera PR operates PREPA's thermal generation assets (post-2023 contract) and
publishes a live page with system-level values:

  - Generación Total del Sistema   (Total Generation, MW)
  - Capacidad Disponible            (Available Capacity, MW)
  - Reserva en Rotación             (Spinning Reserve, MW)
  - Reserva Operacional             (Operational Reserve, MW)
  - Demanda Pronosticada            (Forecast Demand, MW)

The page is Cloudflare-fronted and React-rendered; plain httpx returns 403.
We use Playwright (already in the pipeline for luma_system_overview) so this
scraper costs an extra ~3s per run and no new dependency.

The numbers feed `grid_snapshots` alongside LUMA's Resumen del Sistema. When
both sources fire on the same cron Genera tends to publish ~5 min before
LUMA, so it lets the UI surface fresh values even when LUMA's page lags.

Output: one row in `grid_snapshots` per run, source = 'genera-pr.com'. The
existing schema already has every column we need.
"""

from __future__ import annotations

import logging
import re
import sys
import unicodedata
from datetime import UTC, datetime
from typing import Any

from playwright.sync_api import sync_playwright

from ..pipeline.risk import GridInputs, classify
from ..pipeline.snapshot import save_raw
from ..pipeline.supabase_client import supabase

SOURCE = "genera-pr.com"
URL = "https://genera-pr.com/data-generacion"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 "
    "islagrid-ai/0.1 (+contact@islagrid.app)"
)

# Multiple Spanish/English label variants — Genera has changed labels twice
# in the public record, so a permissive match list saves us a deploy.
LABELS = {
    "total_generation": [
        "Generación Total del Sistema",
        "Generación Total",
        "Total Generation",
    ],
    "available_capacity": [
        "Capacidad Disponible",
        "Available Capacity",
    ],
    "spinning_reserve": [
        "Reserva en Rotación",
        "Reserva Rodante",
        "Spinning Reserve",
    ],
    "operational_reserve": [
        "Reserva Operacional",
        "Operational Reserve",
    ],
    "forecast_demand": [
        "Demanda Pronosticada",
        "Pronóstico de Demanda",
        "Demanda Proyectada",
        "Forecast Demand",
    ],
    "current_demand": [
        "Demanda Actual",
        "Current Demand",
    ],
}

# Per-plant gauges, grouped exactly as Genera lays them out. Names are matched
# case-insensitively against the rendered DOM; the value is the first MW-ish
# number that follows the name. Genera renames/reorders these occasionally so
# anything not found is simply skipped (not an error).
PLANTS_BY_CATEGORY: dict[str, list[str]] = {
    "base": ["San Juan", "Palo Seco", "Costa Sur", "Aguirre"],
    "peak": [
        "Mayaguez",
        "Cambalache",
        "Turbina de Gas",
        "Ciclo Combinado Aguirre",
        "Palo Seco TM",
        "San Juan TM",
    ],
    "backup": [
        "TM Power Generation San Juan & Palo Seco",
        "Daguao",
        "Jobos",
        "Vega Baja",
        "Yabucoa",
        "Vieques",
        "Culebra",
    ],
    "private": ["EcoEléctrica", "Eco Eléctrica", "AES"],
    "renewable": ["Solar", "Viento", "Hidro", "Hydroeléctrico", "Gas de Vertedero"],
}

# Fuel-mix bar chart labels (percentages).
FUEL_LABELS: dict[str, list[str]] = {
    "bunker": ["Bunker"],
    "diesel": ["Diesel"],
    "lng": ["LNG"],
    "coal": ["Coal", "Carbón"],
    "renewable": ["Renew", "Renovable"],
}

log = logging.getLogger(__name__)


# Each plant gauge is an <svg> with several <text> nodes ([value, "MW", min,
# max]); the value node populates LATE (after a gauge animation), so a leading
# empty/decorative <text> is common. We collect every <text>, pick the first
# numeric one, and pair it with the nearest ancestor's <h3> title — robust
# against Genera reordering cards or interleaving section headers.
_GAUGE_PAIR_JS = """
els => els.map(svg => {
  let anc = svg.parentElement;
  while (anc && !anc.querySelector('h3')) anc = anc.parentElement;
  const title = anc ? (anc.querySelector('h3')?.textContent || '').trim() : '';
  const texts = [...svg.querySelectorAll('text')].map(t => (t.textContent || '').trim());
  const num = texts.find(t => t !== '' && t.toUpperCase() !== 'MW' && /^-?\\d/.test(t));
  return { title, value: num ?? null };
}).filter(x => x.title && x.value !== null)
"""

# Wait until the gauges have actually drawn their numbers — at least 6 svgs
# with a numeric <text>. Genera animates these in well after networkidle.
_GAUGE_READY_JS = """
() => {
  let n = 0;
  for (const svg of document.querySelectorAll('svg')) {
    for (const t of svg.querySelectorAll('text')) {
      const v = (t.textContent || '').trim();
      if (v && v.toUpperCase() !== 'MW' && /^-?\\d/.test(v)) { n++; break; }
    }
  }
  return n >= 6;
}
"""


def _fetch() -> tuple[str, list[dict[str, Any]]]:
    """Return (raw_html, [{title, value}]) for every plant gauge on the page."""
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        ctx = browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1280, "height": 900},
            locale="es-PR",
        )
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle", timeout=60_000)
        # Genera hydrates the gauges from a JSON fetch on mount, then animates
        # the needle/number. Wait for the numbers to actually appear; fall
        # back to a fixed delay if the predicate never settles.
        try:
            page.wait_for_function(_GAUGE_READY_JS, timeout=20_000)
        except Exception:
            page.wait_for_timeout(8_000)
        html = page.content()
        gauges = page.eval_on_selector_all("svg", _GAUGE_PAIR_JS)
        browser.close()
        return html, gauges


def _grab_number(html: str, label_variants: list[str]) -> float | None:
    """
    Genera's markup repeats label/value pairs in a few shapes. We try
    successively more permissive regexes; each pattern is tight enough to
    avoid pulling MW values from unrelated paragraphs on the page.
    """
    text = html
    for label in label_variants:
        # Pattern A: "<label>...<...number...>MW"
        pat_a = re.compile(
            rf"{re.escape(label)}[\s\S]{{0,400}}?([\-+]?\d[\d,\.]*)\s*<[^>]*>\s*MW",
            re.IGNORECASE,
        )
        m = pat_a.search(text)
        # Pattern B: bare " 1,234.5 MW" near the label
        if not m:
            pat_b = re.compile(
                rf"{re.escape(label)}[\s\S]{{0,400}}?([\-+]?\d[\d,\.]*)\s*MW",
                re.IGNORECASE,
            )
            m = pat_b.search(text)
        if not m:
            continue
        raw = m.group(1).replace(",", "")
        try:
            return float(raw)
        except ValueError:
            continue
    return None


def _parse(html: str) -> dict[str, float | None]:
    return {key: _grab_number(html, variants) for key, variants in LABELS.items()}


def _grab_value_after(html: str, label: str, unit: str) -> float | None:
    """First `<number> <unit>` that appears within 300 chars after `label`."""
    pat = re.compile(
        rf"{re.escape(label)}[\s\S]{{0,300}}?([\-+]?\d[\d,\.]*)\s*(?:<[^>]*>\s*)?{unit}",
        re.IGNORECASE,
    )
    m = pat.search(html)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def _to_float(raw: str | None) -> float | None:
    if raw is None:
        return None
    try:
        return float(str(raw).replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def _norm(s: str) -> str:
    """Lowercase, strip accents + spaces — for fuzzy plant-name matching."""
    nfkd = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c)).replace(" ", "")


# Gauges that are NOT plants — Genera renders these alongside the plant cards
# (the two demand gauges, plus the fuel-mix chart's "Porcientos" header).
_NON_PLANT_TITLES = {
    _norm(t)
    for t in (
        "Demanda Próxima Hora",
        "Demanda Máxima Registrada Hoy",
        "Porcientos",
        "Energía Generada por Fuente de Combustible",
    )
}


def _parse_plants(gauges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Pair each gauge {title, value} with a category. Genera lists some plants
    twice (e.g. Palo Seco appears under base AND backup) so we consume an
    ordered expected list — the Nth "Palo Seco" gauge in page order maps to
    the Nth "Palo Seco" entry across the category lists.
    """
    expected = [
        (_norm(name), cat)
        for cat, names in PLANTS_BY_CATEGORY.items()
        for name in names
    ]
    used = [False] * len(expected)
    rows: list[dict[str, Any]] = []
    for g in gauges:
        title = (g.get("title") or "").strip()
        if not title or _norm(title) in _NON_PLANT_TITLES:
            continue
        mw = _to_float(g.get("value"))
        if mw is None:
            continue
        nt = _norm(title)
        category = "unknown"
        # Two passes so a loose substring never wins over a real name. Pass 1:
        # exact normalized match ("sanjuan" == "sanjuan"). Pass 2: substring,
        # only if nothing matched exactly — this catches "Ciclo Combinado
        # Aguirre" → "aguirre" without letting "aguirre" hijack it in pass 1.
        idx = next(
            (i for i, (name, _c) in enumerate(expected) if not used[i] and name == nt),
            None,
        )
        if idx is None:
            idx = next(
                (
                    i
                    for i, (name, _c) in enumerate(expected)
                    if not used[i] and (name in nt or nt in name)
                ),
                None,
            )
        if idx is not None:
            category = expected[idx][1]
            used[idx] = True
        rows.append({"plant_name": title, "category": category, "output_mw": mw})
    # Surface mapping drift loudly: any plant Genera renders that we can't
    # categorize is excluded from the renewable-percentage derivation below
    # and from the per-category dashboards, so missing entries silently
    # distort the fuel mix. Log them once per run so PLANTS_BY_CATEGORY can
    # be kept in sync.
    unknown = [r["plant_name"] for r in rows if r["category"] == "unknown"]
    if unknown:
        log.warning(
            "genera_pr: %d plant(s) not in PLANTS_BY_CATEGORY (treated as unknown): %s",
            len(unknown),
            ", ".join(sorted(set(unknown))),
        )
    return rows


def _parse_fuel_mix(html: str) -> list[dict[str, Any]]:
    """Fuel-mix percentages from the 'Energía Generada por Fuente' chart."""
    rows: list[dict[str, Any]] = []
    for fuel, labels in FUEL_LABELS.items():
        pct: float | None = None
        for label in labels:
            pct = _grab_value_after(html, label, "%")
            if pct is None:
                # The chart often renders the number with no % sign — take the
                # bare integer immediately after the label instead.
                m = re.search(
                    rf"{re.escape(label)}[\s\S]{{0,120}}?<[^>]*>\s*(\d{{1,3}})\s*<",
                    html,
                    re.IGNORECASE,
                )
                if m:
                    try:
                        pct = float(m.group(1))
                    except ValueError:
                        pct = None
            if pct is not None:
                break
        if pct is not None and 0 <= pct <= 100:
            rows.append({"fuel_type": fuel, "pct": pct})
    return rows


def run() -> int:
    html, gauges = _fetch()
    raw_key = save_raw(
        SOURCE, html.encode("utf-8"), ext="html", content_type="text/html; charset=utf-8"
    )
    parsed = _parse(html)

    demand = parsed["current_demand"]
    forecast = parsed["forecast_demand"]
    available = parsed["available_capacity"]
    op_reserve = parsed["operational_reserve"]
    spin_reserve = parsed["spinning_reserve"]
    total_gen = parsed["total_generation"]

    # We're stale only when every gauge is blank. Genera doesn't currently
    # have a maintenance banner so checking just the numeric envelope is
    # enough — if they add one later, mirror the luma_system_overview pattern.
    is_stale = all(v is None for v in parsed.values())

    verdict = classify(
        GridInputs(
            current_demand_mw=demand,
            next_hour_demand_mw=forecast,
            available_capacity_mw=available,
            operational_reserve_mw=op_reserve,
            spinning_reserve_mw=spin_reserve,
            source_stale=is_stale,
        )
    )

    row: dict[str, Any] = {
        "ts": datetime.now(UTC).isoformat(),
        "current_demand_mw": demand,
        "next_hour_demand_mw": forecast,
        "total_generation_mw": total_gen,
        "available_capacity_mw": available,
        "spinning_reserve_mw": spin_reserve,
        "operational_reserve_mw": op_reserve,
        "peak_demand_forecast_mw": None,
        "peak_reserve_forecast_mw": None,
        "status": verdict.status,
        "status_reasons": verdict.reasons,
        "source": SOURCE,
        "source_stale": is_stale,
        "raw_key": raw_key,
    }
    supabase().table("grid_snapshots").insert(row).execute()
    log.info(
        "genera_pr snapshot stored: status=%s stale=%s gen=%s avail=%s op_reserve=%s raw=%s",
        verdict.status,
        is_stale,
        total_gen,
        available,
        op_reserve,
        raw_key,
    )

    # Per-plant + fuel-mix breakdown. These write to tables added in migration
    # 0023; if that migration hasn't been applied yet the inserts fail loudly
    # in the log but never break the (already-committed) grid_snapshots row.
    now_iso = row["ts"]
    plants = _parse_plants(gauges)
    if plants:
        try:
            supabase().table("plant_snapshots").insert(
                [{**p, "ts": now_iso, "source": SOURCE, "raw_key": raw_key} for p in plants]
            ).execute()
            log.info("genera_pr: inserted %d plant rows", len(plants))
        except Exception as exc:
            log.warning(
                "genera_pr: plant_snapshots insert failed (%s) — migration 0023 applied?",
                exc,
            )

    fuel_mix = _parse_fuel_mix(html)
    # The on-page fuel-mix widget reports only Genera's thermal portfolio
    # (LNG/bunker/coal/diesel) and shows renewable as 0% even when third-party
    # solar/wind/hydro plants are producing. Derive renewable from plant
    # outputs so the chart reflects total system mix.
    if plants and total_gen and total_gen > 0:
        renewable_mw = sum(
            (p.get("output_mw") or 0)
            for p in plants
            if p.get("category") == "renewable"
        )
        derived_pct = round(renewable_mw / total_gen * 100, 1)
        fuel_mix = [f for f in fuel_mix if f.get("fuel_type") != "renewable"]
        fuel_mix.append({"fuel_type": "renewable", "pct": derived_pct})
    # Integrity check: percentages should sum to 100±2. If Genera adds/renames
    # a fuel column or our renewable derivation drifts, log a WARN and
    # proportionally renormalize so downstream consumers (FUEL MIX widget,
    # carbon-intensity calc) don't quietly publish a sum that's not 100.
    if fuel_mix:
        total_pct = sum(float(f.get("pct") or 0) for f in fuel_mix)
        if total_pct > 0 and abs(total_pct - 100) > 2:
            log.warning(
                "genera_pr: fuel_mix percentages sum to %.1f%% (expected 100); "
                "renormalizing. raw mix=%s",
                total_pct,
                fuel_mix,
            )
            scale = 100.0 / total_pct
            fuel_mix = [
                {**f, "pct": round(float(f.get("pct") or 0) * scale, 1)}
                for f in fuel_mix
            ]
    if fuel_mix:
        try:
            supabase().table("fuel_mix_snapshots").insert(
                [{**f, "ts": now_iso, "source": SOURCE, "raw_key": raw_key} for f in fuel_mix]
            ).execute()
            log.info("genera_pr: inserted %d fuel-mix rows", len(fuel_mix))
        except Exception as exc:
            log.warning(
                "genera_pr: fuel_mix_snapshots insert failed (%s) — migration 0023 applied?",
                exc,
            )

    return 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() else 1)
