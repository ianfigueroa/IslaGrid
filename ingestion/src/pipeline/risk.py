"""
Heuristic grid status — visible, auditable. No ML.

Inputs come from `grid_snapshots` and `generation_snapshots`. Output is a
status enum plus a list of human-readable reasons.

This module is `from __future__ import annotations` so it imports cleanly even
without `supabase` installed (the GH Actions environment installs it; pure
type checks do not need it).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

GridStatus = Literal["normal", "watch", "strained", "critical", "stale", "unknown"]


@dataclass
class GridInputs:
    current_demand_mw: float | None = None
    next_hour_demand_mw: float | None = None
    available_capacity_mw: float | None = None
    operational_reserve_mw: float | None = None
    spinning_reserve_mw: float | None = None
    active_critical_outage: bool = False
    source_stale: bool = False
    target_reserve_mw: float = 250.0  # PREB-derived target; revisit when ingested


@dataclass
class GridVerdict:
    status: GridStatus
    reasons: list[str] = field(default_factory=list)


def classify(inputs: GridInputs) -> GridVerdict:
    if inputs.source_stale:
        return GridVerdict(status="stale", reasons=["Upstream source reports maintenance / blank values"])

    missing = [
        name
        for name in (
            "current_demand_mw",
            "available_capacity_mw",
            "operational_reserve_mw",
        )
        if getattr(inputs, name) is None
    ]
    if missing:
        return GridVerdict(status="unknown", reasons=[f"Missing input: {', '.join(missing)}"])

    demand = inputs.current_demand_mw  # type: ignore[assignment]
    avail = inputs.available_capacity_mw  # type: ignore[assignment]
    op_reserve = inputs.operational_reserve_mw  # type: ignore[assignment]
    next_demand = inputs.next_hour_demand_mw or demand

    forecast_margin = avail - next_demand
    reserve_gap = op_reserve - inputs.target_reserve_mw

    reasons: list[str] = []

    if inputs.active_critical_outage or reserve_gap < 0:
        if inputs.active_critical_outage:
            reasons.append("Active major outage reported by LUMA")
        if reserve_gap < 0:
            reasons.append(
                f"Operational reserve below target ({op_reserve:.0f} MW vs {inputs.target_reserve_mw:.0f} MW target)"
            )
        return GridVerdict(status="critical", reasons=reasons)

    if forecast_margin < 0.05 * avail:
        reasons.append(
            f"Forecast margin tight ({forecast_margin:.0f} MW headroom against {next_demand:.0f} MW expected demand)"
        )
        return GridVerdict(status="strained", reasons=reasons)

    if forecast_margin < 0.10 * avail:
        reasons.append(
            f"Forecast margin narrowing ({forecast_margin:.0f} MW headroom)"
        )
        return GridVerdict(status="watch", reasons=reasons)

    reasons.append(
        f"Reserves healthy ({op_reserve:.0f} MW operational, {forecast_margin:.0f} MW forecast headroom)"
    )
    return GridVerdict(status="normal", reasons=reasons)
