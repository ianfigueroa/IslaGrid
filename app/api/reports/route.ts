import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { isValidType, type ReportType } from "@/lib/reports";
import { pointToCell } from "@/lib/h3";
import { locateMunicipality } from "@/lib/municipality-locator";
import { clientIp, hashIp } from "@/lib/client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOURLY_LIMIT_PER_IP = 30;

/**
 * Same-origin guard. Anonymous POST endpoints get hit by random forms /
 * scripts on third-party sites; we only accept requests whose Origin matches
 * our own host. `REPORTS_ALLOWED_ORIGINS` (comma-separated) lets ops add more.
 */
function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  // A missing Origin header is only acceptable in local dev — production
  // browsers always emit it on cross-origin requests, and a stripped header
  // is the easiest way for an attacker to bypass a same-origin check.
  if (!origin) return process.env.NODE_ENV !== "production";
  const allowed = new Set<string>([
    "http://localhost:3000",
    "http://localhost:3001",
    ...(process.env.NEXT_PUBLIC_SITE_URL ? [process.env.NEXT_PUBLIC_SITE_URL] : []),
    ...(process.env.REPORTS_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()) ?? []),
  ]);
  return allowed.has(origin);
}

// Strict shape — note/comment/free-text fields are intentionally absent so
// nothing user-supplied reaches the DOM as HTML. If freeform notes are
// ever wanted, they must arrive with length caps + HTML stripping.
interface SubmitBody {
  type?: string;
  lat?: number;
  lon?: number;
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) {
    return NextResponse.json(
      { error: "Cross-origin requests not allowed." },
      { status: 403 },
    );
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Reports are disabled in this environment." },
      { status: 503 },
    );
  }

  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.type || !isValidType(body.type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  if (
    typeof body.lat !== "number" ||
    typeof body.lon !== "number" ||
    body.lat < 17 ||
    body.lat > 19.5 ||
    body.lon < -68.5 ||
    body.lon > -64
  ) {
    return NextResponse.json(
      { error: "Coordinates outside Puerto Rico" },
      { status: 400 },
    );
  }

  const type = body.type as ReportType;
  const h3 = pointToCell(body.lat, body.lon);
  // Resolve the municipality once at insert time so per-muni aggregates don't
  // need a spatial join later. Null when the point is outside every polygon
  // (offshore, in coastal-water cells, etc.) — those still aggregate by H3.
  const municipalityId = await locateMunicipality(body.lat, body.lon);
  const ip = clientIp(req);
  const ipHash = hashIp(ip);

  const supa = getServerSupabase();

  // Soft rate-limit: count this IP's reports in the last hour. Cheap because
  // ip_hash + ts have an implicit index from the table's btree on ts.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recent } = await supa
    .from("community_reports")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("ts", since);

  if ((recent ?? 0) >= HOURLY_LIMIT_PER_IP) {
    return NextResponse.json(
      { error: "Hourly limit reached. Try again later." },
      { status: 429 },
    );
  }

  // Insert. The schema deliberately does NOT have a column for exact lat/lon —
  // only the H3 cell — so we cannot accidentally leak coords later.
  const { error } = await supa.from("community_reports").insert({
    type,
    h3,
    municipality_id: municipalityId,
    ip_hash: ipHash,
    user_id: null,
  });

  if (error) {
    // Generic body to clients; full error logged server-side. The previous
    // `detail: error.message` echoed PostgREST messages that include schema
    // and column names.
    // eslint-disable-next-line no-console
    console.error("[reports] insert failed", error);
    return NextResponse.json(
      { error: "Could not save report." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, h3 });
}
