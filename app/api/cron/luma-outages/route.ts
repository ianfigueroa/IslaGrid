import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * 1-minute Vercel cron that pulls the LUMA region-level outage feed and
 * upserts a fresh `luma_outage_snapshots` row per region. This is the data
 * the customers-without-power banner reads. We're allowed to poll fast
 * because miluma.lumapr.com's endpoint is a static JSON file behind a CDN —
 * no headless browser, no auth, sub-200ms response.
 *
 * The GitHub Actions `ingest-luma` workflow still runs every 5 min and is the
 * authoritative path for raw-payload archival to R2 (forensics + replay).
 * This cron is purely a freshness booster for the live banner — if it fails,
 * the 5-min path still keeps things accurate.
 *
 * Auth: Vercel scheduled crons attach `Authorization: Bearer <CRON_SECRET>`
 * to the request. We reject anything else so this endpoint can't be hit by
 * randos to inflate our Supabase write quota.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 10s is enough for one httpx round-trip + a 7-region insert. If miluma is
// slow, we'd rather time out and let the next minute's tick try again than
// hold the Vercel function open.
export const maxDuration = 10;

const API_URL =
  process.env.LUMA_OUTAGE_API_URL ||
  "https://api.miluma.lumapr.com/miluma-outage-api/outage/regionsWithoutService";

const USER_AGENT = "islagrid-ai/0.1 (+contact@islagrid.app)";

interface LumaRegionPayload {
  name?: string;
  totalClientsWithoutService?: number;
  totalClientsWithService?: number;
  totalClientsAffectedByLoadShed?: number;
  totalClientsAffectedByPlannedOutage?: number;
}

interface LumaFeedPayload {
  regions?: LumaRegionPayload[];
  timestamp?: string;
}

interface SnapshotRow {
  ts: string;
  region_id: string;
  region_name: string;
  customers_affected: number | null;
  customers_served: number | null;
  outage_count: number | null;
  source_last_updated_at: string | null;
  source: string;
}

export async function GET(req: NextRequest) {
  // Vercel cron sends `Authorization: Bearer <CRON_SECRET>` — reject anything
  // else so this endpoint isn't an open door to LUMA's API + our DB.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Length-equalize so timingSafeEqual doesn't throw, then constant-time
  // compare. A naive `auth !== expected` leaks the prefix one char at a time
  // — irrelevant for a 32+ char secret in practice but trivial to fix.
  const provided = Buffer.from(auth);
  const expectedBuf = Buffer.from(expected);
  const ok =
    provided.length === expectedBuf.length &&
    timingSafeEqual(provided, expectedBuf);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "supabase_unconfigured" }, { status: 503 });
  }

  let payload: LumaFeedPayload;
  try {
    const res = await fetch(API_URL, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        Origin: "https://miluma.lumapr.com",
        Referer: "https://miluma.lumapr.com/",
      },
      // No revalidate — every minute we want a fresh hit.
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `upstream_${res.status}` },
        { status: 502 },
      );
    }
    payload = (await res.json()) as LumaFeedPayload;
  } catch (err) {
    // Log details server-side; return a generic body so we don't leak
    // resolved hostnames, certificate strings, or upstream stack traces.
    // eslint-disable-next-line no-console
    console.error("[cron luma-outages] upstream fetch failed", err);
    return NextResponse.json({ ok: false, error: "upstream_unreachable" }, { status: 502 });
  }

  const rows = toSnapshotRows(payload);
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, note: "empty_payload" });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.from("luma_outage_snapshots").insert(rows);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[cron luma-outages] insert failed", error);
    return NextResponse.json({ ok: false, error: "db_write_failed" }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    inserted: rows.length,
    source_ts: rows[0].source_last_updated_at,
  });
}

function toSnapshotRows(payload: LumaFeedPayload): SnapshotRow[] {
  const now = new Date().toISOString();
  const sourceTs = parseAstTimestamp(payload.timestamp);
  const rows: SnapshotRow[] = [];
  for (const r of payload.regions ?? []) {
    const name = (r.name ?? "").trim();
    if (!name) continue;
    const without = r.totalClientsWithoutService;
    const served = r.totalClientsWithService;
    const loadShed = r.totalClientsAffectedByLoadShed ?? 0;
    const planned = r.totalClientsAffectedByPlannedOutage ?? 0;
    rows.push({
      ts: now,
      region_id: name.toLowerCase().replace(/\s+/g, "-"),
      region_name: name,
      customers_affected: Number.isFinite(without) ? Math.trunc(without!) : null,
      customers_served: Number.isFinite(served) ? Math.trunc(served!) : null,
      // Match the Python ingest: "anything non-normal" tally per region, or
      // NULL when there's nothing to report.
      outage_count: loadShed + planned > 0 ? loadShed + planned : null,
      source_last_updated_at: sourceTs,
      source: "luma-outage-map",
    });
  }
  return rows;
}

/**
 * MiLUMA reports timestamps like "05/13/2026 11:50 AM" in Atlantic Standard
 * Time (UTC-4, no DST). Parse them into UTC ISO so downstream code doesn't
 * have to think about the runner's local timezone.
 */
function parseAstTimestamp(raw: string | undefined): string | null {
  if (!raw) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/.exec(raw);
  if (!match) return null;
  const [, mm, dd, yyyy, hh, mi, ampm] = match;
  let hours = Number(hh) % 12;
  if (ampm === "PM") hours += 12;
  // Build UTC by adding 4h to the AST wall-clock.
  const utc = new Date(
    Date.UTC(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      hours + 4,
      Number(mi),
      0,
      0,
    ),
  );
  if (Number.isNaN(utc.getTime())) return null;
  return utc.toISOString();
}
