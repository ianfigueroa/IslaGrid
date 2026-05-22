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
    """Whole-word match against the slugged muni names.

    Earlier this did a bare substring check (`token in lowered`), which
    matched "san-juan" inside "san-juanito" and similar overlapping slugs.
    Switching to regex word-boundary on the dashed slug eliminates that:
    in the slug 'x-san-juan-y' a dash is a non-word char so `\\bsan-juan\\b`
    matches between the dashes, but 'san-juanito' has no boundary after
    'juan' and is rejected. We iterate longest-first so the most specific
    name wins (e.g. 'san-german' before any shorter overlap).
    """
    lowered = _slug(text)
    tokens = sorted(
        (t for t in index if len(t) >= 3),
        key=len,
        reverse=True,
    )
    for token in tokens:
        if re.search(rf"\b{re.escape(token)}\b", lowered):
            return index[token]
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
        # Hash on stable fields only — `source` + `id` (from official_updates,
        # which itself is a stable hash of the raw notice). DO NOT include
        # `started_at` here: official_updates.ts gets overwritten with the
        # latest scrape time on every upsert, so hashing it produced a new
        # event row per scrape and stacked 6–11 duplicates on the scorecard.
        # `text` stays in the hash because two distinct notices that happen to
        # share an id (shouldn't, but defensive) still get different events.
        event_id = "ev:" + hashlib.sha1(
            f"{row.get('source')}|{row.get('id')}|{text}".encode("utf-8")
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
        # Surface upsert failures with context. supabase-py raises APIError on
        # HTTP non-2xx already, but the bare stack trace doesn't tell us how
        # many events were in-flight — wrap so a future failure is debuggable.
        try:
            sb.table("outage_events").upsert(events, on_conflict="id").execute()
        except Exception as e:
            log.error(
                "outage_events: upsert failed for %d events: %s",
                len(events),
                e,
            )
            raise
    log.info("outage_events: extracted %d events from last %d days", len(events), window_days)
    return len(events)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(0 if run() >= 0 else 1)
