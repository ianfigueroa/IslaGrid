"""
Backfill LUMA region snapshots from the public SuperSonicHub1 archive.

LUMA does not publish a historical outage dataset. Our own 5-min poller has
only been running a few weeks. To close the gap, we lean on a community
archive — github.com/SuperSonicHub1/luma-energy-outages — which has been
committing the ``regionsWithoutService`` JSON to git since Sept 2023.

The archive has ~33k commits touching ``service_statistics.json`` (they
re-commit on every scrape run, often dozens/day). For ML + trend visuals,
we only need *daily* resolution, so we keep the **latest commit per day**
and drop the rest. That cuts the workload from 33k blobs to ~540 with
the same end-state.

Performance:
  - Full clone (not blob:none). The repo is ~970MB but a full clone runs
    in ~60s on GH Actions, and `git show` becomes a local op afterward.
    `--filter=blob:none` was 60x slower in practice — every `git show`
    spawned a network fetch.
  - `git cat-file --batch` streams blob contents in one subprocess, so we
    don't pay fork+exec overhead per snapshot.

Idempotent: wipes prior rows tagged with this source before inserting.
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
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ..pipeline.supabase_client import supabase

SOURCE = "luma-archive-supersonichub1"
REPO_URL = "https://github.com/SuperSonicHub1/luma-energy-outages.git"
TARGET_FILE = "service_statistics.json"

log = logging.getLogger(__name__)


def _run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> str:
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
    """Full clone (no blob filter) so `git show` is purely local afterward."""
    if repo_dir.exists():
        shutil.rmtree(repo_dir)
    log.info("Cloning %s into %s …", REPO_URL, repo_dir)
    _run(["git", "clone", "--no-checkout", REPO_URL, str(repo_dir)])


def _daily_commits(repo_dir: Path) -> list[tuple[str, datetime]]:
    """Return [(sha, ts)] for the latest commit per UTC day that touched the
    target file. Commits are walked newest-first, so we keep the first sha we
    see for each date (which is the latest of that day)."""
    raw = _run(
        ["git", "log", "--format=%H %at", "--", TARGET_FILE],
        cwd=repo_dir,
    )
    seen: dict[date, tuple[str, datetime]] = {}
    total = 0
    for line in raw.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2:
            continue
        sha, epoch = parts
        try:
            ts = datetime.fromtimestamp(int(epoch), tz=UTC)
        except (TypeError, ValueError):
            continue
        total += 1
        day = ts.date()
        if day not in seen:
            seen[day] = (sha, ts)
    log.info(
        "Walked %d commits touching %s, picked %d (one latest per day)",
        total,
        TARGET_FILE,
        len(seen),
    )
    # Return oldest-first so logs read naturally.
    return sorted(seen.values(), key=lambda x: x[1])


def _resolve_blobs(
    repo_dir: Path, commits: list[tuple[str, datetime]]
) -> list[tuple[str, datetime, str]]:
    """Map each commit → the blob sha for ``service_statistics.json`` at that
    commit. Uses `git rev-parse` in a single subprocess by writing refs to
    stdin via `git cat-file --batch-check`."""
    refs = "\n".join(f"{sha}:{TARGET_FILE}" for sha, _ in commits) + "\n"
    p = subprocess.run(
        ["git", "cat-file", "--batch-check=%(objectname) %(objecttype)"],
        cwd=str(repo_dir),
        input=refs.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    out_lines = p.stdout.decode("utf-8", "replace").splitlines()
    # `git cat-file --batch-check` emits one line per input ref, in order.
    # A length mismatch means we'd silently zip+truncate and lose snapshot
    # days. Refuse rather than ingest a corrupt subset.
    if len(out_lines) != len(commits):
        raise RuntimeError(
            f"git cat-file output mismatch: {len(commits)} refs in, "
            f"{len(out_lines)} lines out. Refusing to truncate via zip()."
        )
    resolved: list[tuple[str, datetime, str]] = []
    for (sha, ts), line in zip(commits, out_lines):
        parts = line.strip().split()
        if len(parts) >= 2 and parts[1] == "blob":
            resolved.append((sha, ts, parts[0]))
    log.info("Resolved %d / %d blob shas", len(resolved), len(commits))
    return resolved


def _read_blobs(
    repo_dir: Path, items: list[tuple[str, datetime, str]]
) -> list[tuple[datetime, dict[str, Any]]]:
    """Stream every JSON blob through `git cat-file --batch`. One subprocess,
    one round-trip per blob, no fork/exec overhead."""
    refs = "\n".join(blob_sha for _, _, blob_sha in items) + "\n"
    p = subprocess.run(
        ["git", "cat-file", "--batch"],
        cwd=str(repo_dir),
        input=refs.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    stream = p.stdout
    out: list[tuple[datetime, dict[str, Any]]] = []
    cursor = 0
    for _, ts, blob_sha in items:
        # Header line: "<sha> blob <size>\n", then <size> bytes, then "\n".
        nl = stream.find(b"\n", cursor)
        if nl < 0:
            break
        header = stream[cursor:nl].decode("ascii", "replace")
        cursor = nl + 1
        parts = header.split()
        if len(parts) < 3 or parts[1] != "blob":
            continue
        try:
            size = int(parts[2])
        except ValueError:
            continue
        body = stream[cursor : cursor + size]
        cursor += size + 1  # +1 for the trailing newline cat-file emits
        try:
            payload = json.loads(body.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            continue
        out.append((ts, payload))
    log.info("Parsed %d JSON blobs", len(out))
    return out


def _parse_luma_ts(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        ast = timezone(timedelta(hours=-4))
        return (
            datetime.strptime(raw, "%m/%d/%Y %I:%M %p")
            .replace(tzinfo=ast)
            .astimezone(UTC)
        )
    except ValueError:
        return None


def _to_rows(
    payload: dict[str, Any], snapshot_ts: datetime
) -> list[dict[str, Any]]:
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
    supabase().table("luma_outage_snapshots").delete().eq("source", SOURCE).execute()


def run(workdir: Path | None = None, batch_size: int = 500) -> int:
    repo_dir = workdir or Path(tempfile.gettempdir()) / "luma-energy-outages-archive"
    _clone(repo_dir)

    commits = _daily_commits(repo_dir)
    if not commits:
        log.warning("No commits found.")
        return 0

    resolved = _resolve_blobs(repo_dir, commits)
    if not resolved:
        log.warning("No blob shas resolved.")
        return 0

    blobs = _read_blobs(repo_dir, resolved)
    if not blobs:
        log.warning("No blobs parsed.")
        return 0

    _wipe_archive_rows()
    log.info("Wiped prior rows with source=%s", SOURCE)

    seen_keys: set[tuple[str, str]] = set()
    payload: list[dict[str, Any]] = []
    for commit_ts, body in blobs:
        snapshot_ts = _parse_luma_ts(body.get("timestamp")) or commit_ts
        for row in _to_rows(body, snapshot_ts):
            key = (row["ts"], row["region_id"])
            if key in seen_keys:
                continue
            seen_keys.add(key)
            payload.append(row)

    if not payload:
        log.warning("No rows synthesized.")
        return 0

    sb = supabase()
    written = 0
    for start in range(0, len(payload), batch_size):
        chunk = payload[start : start + batch_size]
        sb.table("luma_outage_snapshots").insert(chunk).execute()
        written += len(chunk)
        if (start // batch_size) % 5 == 0:
            log.info("Inserted %d / %d rows…", written, len(payload))

    log.info(
        "luma_archive_backfill: done; wrote %d rows from %d daily snapshots",
        written,
        len(blobs),
    )
    return written


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workdir")
    args = parser.parse_args()
    workdir = Path(args.workdir) if args.workdir else None
    return run(workdir=workdir)


if __name__ == "__main__":
    sys.exit(0 if main() >= 0 else 1)
