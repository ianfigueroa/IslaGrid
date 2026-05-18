"""
One-shot ingest of DOE EAGLE-I historical outage data, scoped to Puerto Rico.

EAGLE-I (Environment for Analysis of Geo-Located Energy Information) is
maintained by Oak Ridge National Lab and publishes a county-level archive
of customer-affected outage counts at 15-minute resolution. It covers
2014-2022 today; ORNL refreshes the archive periodically.

Distribution: ORNL hosts the dataset on figshare. The most recent published
release we trust is 24237376 ("Historical Electric Power Outage Data for
the United States 2014-2023"). We expose the URL via env so a future
re-release can be ingested without a code change.

This is a heavy job — the full archive is multi-GB. We stream the CSVs,
filter to FIPS state = 72 (Puerto Rico) before parsing, and upsert in
batches of 5k. Idempotent: re-running tops up only the rows that don't
already exist.

License: public domain (US federal work). Citation: see the figshare DOI.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import logging
import os
import sys
import zipfile
from datetime import datetime, timezone
from typing import Iterator

import httpx

from ..pipeline.supabase_client import supabase

SOURCE = "eagle-i"
log = logging.getLogger(__name__)

# Default ORNL/figshare release. Override with EAGLE_I_DATA_URL.
DEFAULT_URL = os.environ.get(
    "EAGLE_I_DATA_URL",
    # User can supply a direct ZIP/CSV URL; we don't hardcode a figshare
    # file id since those rotate per release. The README at
    # https://figshare.com/articles/dataset/24237376 documents the latest.
    "",
)

PR_FIPS_STATE = "72"

# FIPS county code (3 digits, zero-padded) → municipalities.id slug. The
# `eagle_i_outages.municipality_id` column FKs into `municipalities.id`, which
# uses a hand-curated kebab-case slug (no diacritics) rather than the raw
# FIPS code. Without this map every Eagle-i row fails the FK and the run
# aborts on the first batch.
FIPS_TO_SLUG: dict[str, str] = {
    "001": "adjuntas",       "003": "aguada",         "005": "aguadilla",
    "007": "aguas-buenas",   "009": "aibonito",       "011": "anasco",
    "013": "arecibo",        "015": "arroyo",         "017": "barceloneta",
    "019": "barranquitas",   "021": "bayamon",        "023": "cabo-rojo",
    "025": "caguas",         "027": "camuy",          "029": "canovanas",
    "031": "carolina",       "033": "catano",         "035": "cayey",
    "037": "ceiba",          "039": "ciales",         "041": "cidra",
    "043": "coamo",          "045": "comerio",        "047": "corozal",
    "049": "culebra",        "051": "dorado",         "053": "fajardo",
    "054": "florida",        "055": "guanica",        "057": "guayama",
    "059": "guayanilla",     "061": "guaynabo",       "063": "gurabo",
    "065": "hatillo",        "067": "hormigueros",    "069": "humacao",
    "071": "isabela",        "073": "jayuya",         "075": "juana-diaz",
    "077": "juncos",         "079": "lajas",          "081": "lares",
    "083": "las-marias",     "085": "las-piedras",    "087": "loiza",
    "089": "luquillo",       "091": "manati",         "093": "maricao",
    "095": "maunabo",        "097": "mayaguez",       "099": "moca",
    "101": "morovis",        "103": "naguabo",        "105": "naranjito",
    "107": "orocovis",       "109": "patillas",       "111": "penuelas",
    "113": "ponce",          "115": "quebradillas",   "117": "rincon",
    "119": "rio-grande",     "121": "sabana-grande",  "123": "salinas",
    "125": "san-german",     "127": "san-juan",       "129": "san-lorenzo",
    "131": "san-sebastian",  "133": "santa-isabel",   "135": "toa-alta",
    "137": "toa-baja",       "139": "trujillo-alto",  "141": "utuado",
    "143": "vega-alta",      "145": "vega-baja",      "147": "vieques",
    "149": "villalba",       "151": "yabucoa",        "153": "yauco",
}


def _iter_csv_rows(stream: io.BufferedReader) -> Iterator[dict[str, str]]:
    """Yield rows from a gz-or-plain CSV stream, lowercased headers."""
    # Sniff first two bytes for gzip magic.
    head = stream.peek(2)[:2]
    if head == b"\x1f\x8b":
        opened: io.IOBase = gzip.GzipFile(fileobj=stream, mode="rb")
    else:
        opened = stream
    text = io.TextIOWrapper(opened, encoding="utf-8", errors="replace")
    reader = csv.DictReader(text)
    for row in reader:
        yield {k.lower().strip(): (v or "").strip() for k, v in row.items()}


def _parse_ts(raw: str) -> str | None:
    """EAGLE-I uses 'YYYY-MM-DD HH:MM:SS' (UTC). Tolerate trailing 'Z'."""
    if not raw:
        return None
    cleaned = raw.replace("T", " ").replace("Z", "").strip()
    try:
        dt = datetime.strptime(cleaned[:19], "%Y-%m-%d %H:%M:%S").replace(
            tzinfo=timezone.utc
        )
        return dt.isoformat()
    except ValueError:
        return None


def _muni_id(fips_state: str, fips_county: str) -> str | None:
    if fips_state != PR_FIPS_STATE:
        return None
    if not fips_county.isdigit() or len(fips_county) != 3:
        return None
    # Returning None for unmapped codes is fine — the row still lands in
    # eagle_i_outages with municipality_id NULL, and downstream label
    # synthesis just skips it. The FK only applies when a value is present.
    return FIPS_TO_SLUG.get(fips_county)


def _open_archive(url: str) -> Iterator[io.BufferedReader]:
    """Stream the file at url; if it's a zip, yield each .csv member."""
    with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as r:
        r.raise_for_status()
        buf = io.BytesIO()
        for chunk in r.iter_bytes(chunk_size=1 << 20):
            buf.write(chunk)
        buf.seek(0)
        head = buf.read(4)
        buf.seek(0)
        # Zip magic
        if head[:2] == b"PK":
            with zipfile.ZipFile(buf) as zf:
                for member in zf.namelist():
                    if not member.lower().endswith((".csv", ".csv.gz")):
                        continue
                    with zf.open(member) as inner:
                        # zipfile returns a non-BufferedReader; wrap.
                        yield io.BufferedReader(inner)  # type: ignore[arg-type]
        else:
            yield io.BufferedReader(buf)  # type: ignore[arg-type]


def run(url: str | None = None, batch_size: int = 5000) -> int:
    target = url or DEFAULT_URL
    if not target:
        log.error(
            "EAGLE_I_DATA_URL not set and no --url provided. "
            "See https://figshare.com/articles/dataset/24237376 for the "
            "latest release archive.",
        )
        return 0

    sb = supabase()
    total = 0
    seen = 0
    batch: list[dict[str, object]] = []

    for stream in _open_archive(target):
        for row in _iter_csv_rows(stream):
            seen += 1
            # ORNL's public Eagle-i CSVs use a single combined `fips_code`
            # (5-digit county FIPS) rather than separate state/county columns.
            # Tolerate both shapes so the scraper still works on the older
            # research releases that did split them.
            combined = (row.get("fips_code") or row.get("county_fips") or "").strip()
            if combined and combined.isdigit() and len(combined) >= 4:
                # Pad to 5 in case leading zero was stripped (e.g. "1001" → "01001").
                padded = combined.zfill(5)
                fips_state = padded[:2]
                fips_county = padded[2:5]
            else:
                fips_state = (row.get("fips_state_code") or row.get("fips_state") or "").zfill(2)
                fips_county = (
                    row.get("fips_county_code") or row.get("fips_county") or ""
                ).zfill(3)
            if fips_state != PR_FIPS_STATE:
                continue
            ts = _parse_ts(
                row.get("run_start_time")
                or row.get("run_time")
                or row.get("ts")
                or row.get("timestamp")
                or ""
            )
            if not ts:
                continue
            # ORNL writes the per-county affected count as `sum`. Older releases
            # used `customers_out`. Accept both.
            customers_out_raw = (
                row.get("sum")
                or row.get("customers_out")
                or row.get("customers_affected")
                or "0"
            )
            try:
                customers_out = int(float(customers_out_raw))
            except ValueError:
                continue
            batch.append(
                {
                    "ts": ts,
                    "fips_state": fips_state,
                    "fips_county": fips_county,
                    "municipality_id": _muni_id(fips_state, fips_county),
                    "customers_out": customers_out,
                    "source": SOURCE,
                }
            )
            if len(batch) >= batch_size:
                sb.table("eagle_i_outages").upsert(
                    batch, on_conflict="ts,fips_state,fips_county"
                ).execute()
                total += len(batch)
                log.info("eagle_i: upserted %d rows (running total %d)", len(batch), total)
                batch = []

    if batch:
        sb.table("eagle_i_outages").upsert(
            batch, on_conflict="ts,fips_state,fips_county"
        ).execute()
        total += len(batch)
    log.info("eagle_i: done; scanned %d rows, kept %d PR rows", seen, total)
    if seen > 0 and total == 0:
        log.error(
            "eagle_i: scanned %d rows but kept 0 — the source columns may have "
            "changed. Expected one of fips_code/county_fips/fips_state. "
            "First-row header keys: %s",
            seen,
            "(see DictReader headers above)",
        )
    return total


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser(description="Ingest DOE EAGLE-I historical outage data")
    p.add_argument("--url", help="Override EAGLE_I_DATA_URL")
    p.add_argument("--batch-size", type=int, default=5000)
    args = p.parse_args()
    return run(url=args.url, batch_size=args.batch_size)


if __name__ == "__main__":
    sys.exit(0 if main() >= 0 else 1)
