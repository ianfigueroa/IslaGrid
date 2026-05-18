"""
Backfill LUMA region snapshots from the public SuperSonicHub1 archive.

LUMA does not publish a historical outage dataset. Our own 5-min poller has
only been running a few weeks. To close the gap, we lean on a community
archive — github.com/SuperSonicHub1/luma-energy-outages — which has been
committing the same ``regionsWithoutService`` JSON to git once per day from
Sept 2023 through March 2025. ~540 daily snapshots of the 7 LUMA regions.

This is a one-shot ingest. Run once, fill the gap, then forget about it.
Idempotent — re-running just refreshes the same `source` rows.

Algorithm:
  1. Shallow-clone the archive repo (blob:none, so PNG history doesn't bloat).
  2. ``git log`` the commits that ever touched ``service_statistics.json``.
  3. For each commit, ``git show`` the blob, parse the JSON, build region rows
     keyed by the JSON's own ``timestamp`` field (falling back to commit time).
  4. Wipe any existing rows tagged with our archive source, then bulk-insert.

We tag these rows with ``source='luma-archive-supersonichub1'`` so they stay
clearly separate from our live ``luma-outage-map`` feed, and so a re-run can
be cleanly wiped + replaced without touching live data.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from ..pipeline.supabase_client import supabase

SOURCE = "luma-archive-supersonichub1"
REPO_URL = "https://github.com/SuperSonicHub1/luma-energy-outages.git"
TARGET_FILE = "service_statistics.json"

log = logging.getLogger(__name__)


def _run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> str:
    """Run a git command, return stdout. Surfaces non-zero exits as exceptions."""
    p = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and p.returncode != 0:
        raise RuntimeError(
            f"command failed ({p.returncode}): {' '.join(cmd)}\n"
            f"stderr: {p.stderr.decode('utf-8', 'replace')[:500]}"
        )
    return p.stdout.decode("utf-8", "replace")


def _clone(repo_dir: Path) -> None:
    """Partial clone — skip blobs we don't need, then fetch lazily."""
    if repo_dir.exists():
        shutil.rmtree(repo_dir)
    log.info("Cloning %s into %s (this can take a minute)…", REPO_URL, repo_dir)
    _run(
        [
            "git",
            "clone",
            "--filter=blob:none",
            "--no-checkout",
            REPO_URL,
            str(repo_dir),
        ]
    )


def _commit_blobs(repo_dir: Path) -> Iterable[tuple[str, datetime]]:
    """Yield (commit_sha, author_ts) for every commit that touched the target.

    ``author_ts`` becomes the snapshot timestamp fallback when the JSON itself
    doesn't carry one we can parse.
    """
    raw = _run(
        ["git", "log", "--format=%H %at", "--", TARGET_FILE],
        cwd=repo_dir,
    )
    for line in raw.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2:
            continue
        sha, epoch = parts
        try:
            ts = datetime.fromtimestamp(int(epoch), tz=UTC)
        except (TypeError, ValueError):
            continue
        yield sha, ts


def _show_blob(repo_dir: Path, sha: str) -> dict[str, Any] | None:
    """Return parsed JSON for ``service_statistics.json`` at ``sha``."""
    try:
        raw = _run(
            ["git", "show", f"{sha}:{TARGET_FILE}"],
            cwd=repo_dir,
            check=False,
        )
    except RuntimeError:
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _parse_luma_ts(raw: str | None) -> datetime | None:
    """The JSON ``timestamp`` field is AST (UTC-4) without an explicit zone."""
    if not raw:
        return None
    try:
        ast = timezone(timedelta(hours=-4))
        return datetime.strptime(raw, "%m/%d/%Y %I:%M %p").replace(tzinfo=ast).astimezone(UTC)
    except ValueError:
        return None


def _to_rows(payload: dict[str, Any], snapshot_ts: datetime) -> list[dict[str, Any]]:
    """Reshape one capture into per-region rows matching luma_outage_snapshots."""
    rows: list[dict[str, Any]] = []
    iso = snapshot_ts.isoformat()
    for r in payload.get("regions") or []:
        name = (r.get("name") or "").strip()
        if not name:
            continue
        without = r.get("totalClientsWithoutService")
        served = r.get("totalClientsWithService")
        load_shed = r.get("totalClientsAffectedByLoadShed") or 0
        planned = r.get("totalClientsAffectedByPlannedOutage") or 0
        # Mirror the live ingest: outage_count is the "anything not normal"
        # counter (without + load_shed + planned). Coarse but matches.
        outage_count: int | None = None
        if isinstance(without, (int, float)):
            outage_count = int(without) + int(load_shed) + int(planned)
        rows.append(
            {
                "ts": iso,
                "region_id": name.lower().replace(" ", "-"),
                "region_name": name,
                "customers_affected": int(without) if isinstance(without, (int, float)) else None,
                "customers_served": int(served) if isinstance(served, (int, float)) else None,
                "outage_count": outage_count,
                "source": SOURCE,
            }
        )
    return rows


def _wipe_archive_rows() -> None:
    """Drop any prior rows from this source so re-runs don't duplicate."""
    sb = supabase()
    sb.table("luma_outage_snapshots").delete().eq("source", SOURCE).execute()


def run(workdir: Path | None = None, batch_size: int = 500) -> int:
    repo_dir = workdir or Path(tempfile.gettempdir()) / "luma-energy-outages-archive"
    _clone(repo_dir)

    commits = list(_commit_blobs(repo_dir))
    log.info("Found %d commits touching %s", len(commits), TARGET_FILE)
    if not commits:
        return 0

    _wipe_archive_rows()
    log.info("Wiped prior rows with source=%s", SOURCE)

    payload: list[dict[str, Any]] = []
    skipped = 0
    seen_keys: set[tuple[str, str]] = set()  # (iso_ts, region_id)

    for sha, commit_ts in commits:
        blob = _show_blob(repo_dir, sha)
        if not blob:
            skipped += 1
            continue
        snapshot_ts = _parse_luma_ts(blob.get("timestamp")) or commit_ts
        for row in _to_rows(blob, snapshot_ts):
            key = (row["ts"], row["region_id"])
            if key in seen_keys:
                continue
            seen_keys.add(key)
            payload.append(row)

    if not payload:
        log.warning("No rows synthesized from %d commits (skipped %d).", len(commits), skipped)
        return 0

    sb = supabase()
    written = 0
    for start in range(0, len(payload), batch_size):
        chunk = payload[start : start + batch_size]
        sb.table("luma_outage_snapshots").insert(chunk).execute()
        written += len(chunk)
        if start % (batch_size * 5) == 0:
            log.info("Inserted %d / %d rows…", written, len(payload))

    log.info(
        "luma_archive_backfill: done; wrote %d rows from %d commits (skipped %d blobs)",
        written,
        len(commits),
        skipped,
    )
    return written


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workdir",
        help="Optional path for the local clone (defaults to a tempdir).",
    )
    args = parser.parse_args()
    workdir = Path(args.workdir) if args.workdir else None
    return run(workdir=workdir)


if __name__ == "__main__":
    sys.exit(0 if main() >= 0 else 1)
