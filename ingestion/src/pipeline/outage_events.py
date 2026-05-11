"""
Extract structured outage events from official_updates rows.

Regex-only — no LLM. The trick is the 78-municipality whitelist: we
recognize a municipality name when it appears in text, then classify the
event kind from a small set of verbs/nouns. Output rows seed
`outage_events`, which is the primary label source for the Phase 9 ML
model. Confidence is encoded by `kind` (`unplanned` > `planned` > `unknown`).
"""

from __future__ import annotations

import hashlib
import logging
import re
import sys
import unicodedata
from datetime import datetime, timezone

from .supabase_client import supabase

log = logging.getLogger(__name__)

# Verbs/nouns that tip us off to an unplanned event vs. planned maintenance.
UNPLANNED_PATTERNS = re.compile(
    r"\b("
    r"interrupcion|interrupción|fallo|aver[íi]a|apag[oó]n|outage|"
    r"sin servicio|sin energ[íi]a|sin luz|down|de-energiz"
    r")\b",
    re.IGNORECASE,
)
PLANNED_PATTERNS = re.compile(
    r"\b("
    r"mejoras planificadas|mantenimiento|planned (work|outage)|programad[oa]"
    r")\b",
    re.IGNORECASE,
)
RESTORED_PATTERNS = re.compile(
    r"\b(restablecido|restaurado|restored|servicio normalizado)\b",
    re.IGNORECASE,
)


def _slug(name: str) -> str:
    norm = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    return "-".join(norm.lower().split())


def _muni_index() -> dict[str, str]:
    """Map normalized municipality name → id slug."""
    rows = supabase().table("municipalities").select("id, name").execute().data or []
    index = {}
    for row in rows:
        index[_slug(row["name"])] = row["id"]
        # Also index the slug itself so 'san-juan' matches directly.
        index[row["id"]] = row["id"]
    return index


def _detect_kind(text: str) -> str:
    if RESTORED_PATTERNS.search(text):
        return "restored"
    if UNPLANNED_PATTERNS.search(text):
        return "unplanned"
    if PLANNED_PATTERNS.search(text):
        return "planned"
    return "unknown"


def _find_municipality(text: str, index: dict[str, str]) -> str | None:
    lowered = _slug(text)
    for token, muni_id in index.items():
        if len(token) < 3:
            continue
        # Token match against the slugged text: cheap O(n*m) for our scale (78 munis).
        if token in lowered:
            return muni_id
    return None


def run(window_days: int = 14) -> int:
    sb = supabase()
    cutoff = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    rows = (
        sb.table("official_updates")
        .select("id, ts, source, category, text, url, raw_key")
        .order("ts", desc=True)
        .limit(500)
        .execute()
        .data
    ) or []

    index = _muni_index()
    events: list[dict[str, str | None]] = []
    for row in rows:
        text = row.get("text") or ""
        if not text:
            continue
        kind = _detect_kind(text)
        if kind == "unknown" and row.get("category") not in ("planned-work", "announcement"):
            continue
        muni = _find_municipality(text, index)
        started = row.get("ts") or cutoff
        snippet = text[:280]
        event_id = "ev:" + hashlib.sha1(
            f"{row.get('source')}|{started}|{snippet[:120]}".encode("utf-8")
        ).hexdigest()[:16]
        events.append(
            {
                "id": event_id,
                "municipality_id": muni,
                "started_at": started,
                "ended_at": None,
                "kind": kind if kind != "unknown" else ("planned" if row.get("category") == "planned-work" else "unknown"),
                "source": row.get("source"),
                "source_url": row.get("url"),
                "snippet": snippet,
                "raw_key": row.get("raw_key"),
            }
        )

    if events:
        sb.table("outage_events").upsert(events, on_conflict="id").execute()
    log.info("outage_events: extracted %d events from last %d days", len(events), window_days)
    return len(events)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
