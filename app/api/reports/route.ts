import crypto from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { isValidType, type ReportType } from "@/lib/reports";
import { pointToCell } from "@/lib/h3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOURLY_LIMIT_PER_IP = 30;
const IP_SALT = process.env.REPORT_IP_SALT ?? "islagrid-report-salt-v1";

interface SubmitBody {
  type?: string;
  lat?: number;
  lon?: number;
  note?: string;
}

/**
 * IPv6 addresses have many string representations (`::1`, `0:0:0:0:0:0:0:1`,
 * `[::1]`, mixed-case). Hashing the raw string would let an attacker bypass
 * the rate limit just by varying capitalization. Normalize before hashing.
 */
function normalizeIp(raw: string): string {
  let candidate = raw.trim();
  // Strip bracket notation: [2001:db8::1]:port → 2001:db8::1
  if (candidate.startsWith("[")) {
    const end = candidate.indexOf("]");
    if (end > 0) candidate = candidate.slice(1, end);
  }
  // Strip port from IPv4 form: 1.2.3.4:5678 → 1.2.3.4
  if (candidate.split(":").length === 2 && isIP(candidate.split(":")[0])) {
    candidate = candidate.split(":")[0];
  }
  if (!isIP(candidate)) return "unknown";
  return candidate.toLowerCase();
}

function hashIp(ip: string): string {
  return crypto
    .createHash("sha256")
    .update(`${IP_SALT}:${ip}`)
    .digest("hex")
    .slice(0, 32);
}

function clientIp(req: Request): string {
  // Only trust X-Forwarded-For when the entry validates as a real IP. The
  // first comma-separated entry is the original client per RFC 7239.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0];
    const normalized = normalizeIp(first);
    if (normalized !== "unknown") return normalized;
  }
  const real = req.headers.get("x-real-ip");
  if (real) {
    const normalized = normalizeIp(real);
    if (normalized !== "unknown") return normalized;
  }
  return "unknown";
}

export async function POST(req: Request) {
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
  const { error } = await supa
    .from("community_reports")
    .insert({ type, h3, ip_hash: ipHash, user_id: null });

  if (error) {
    return NextResponse.json(
      { error: "Could not save report.", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, h3 });
}
