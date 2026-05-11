import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 60;

interface OutageRow {
  id: string;
  municipality_id: string | null;
  started_at: string;
  ended_at: string | null;
  kind: "planned" | "unplanned" | "restored" | "unknown";
  source: string;
  source_url: string | null;
  snippet: string | null;
}

interface EtaRow {
  outage_event_id: string;
  ts: string;
  low_hours: number;
  high_hours: number;
  confidence: "low" | "medium" | "high";
  model_version: string;
  reasons: string[];
}

interface CauseRow {
  outage_event_id: string;
  ts: string;
  cause:
    | "weather"
    | "vegetation"
    | "planned_maintenance"
    | "generation_shortage"
    | "equipment"
    | "transmission"
    | "distribution"
    | "unknown";
  confidence: "low" | "medium" | "high";
  model_version: string;
  reasons: string[];
}

interface Payload {
  outage: OutageRow | null;
  eta: {
    range_hours: [number, number];
    /** Human-readable range string — always a range, never a fixed time. */
    label: string;
    confidence: "low" | "medium" | "high";
    model_version: string;
    reasons: string[];
    ts: string;
  } | null;
  cause: CauseRow | null;
  timeline: Array<{
    id: string;
    ts: string;
    source: string;
    text: string;
    url: string | null;
  }>;
  reason?: "supabase_unconfigured" | "not_found" | "supabase_error";
  error?: string;
}

function formatEtaLabel(low: number, high: number): string {
  if (low < 1 && high < 1) return `under 1 hour`;
  if (Math.round(low) === Math.round(high)) return `~${Math.round(low)} hours`;
  return `${low.toFixed(1).replace(/\.0$/, "")}–${high
    .toFixed(1)
    .replace(/\.0$/, "")} hours`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!isSupabaseConfigured()) {
    const body: Payload = {
      outage: null,
      eta: null,
      cause: null,
      timeline: [],
      reason: "supabase_unconfigured",
    };
    return NextResponse.json(body);
  }

  const supa = getServerSupabase();
  const [{ data: outage, error: outageErr }, { data: eta }, { data: cause }] =
    await Promise.all([
      supa
        .from("outage_events")
        .select(
          "id, municipality_id, started_at, ended_at, kind, source, source_url, snippet",
        )
        .eq("id", id)
        .maybeSingle<OutageRow>(),
      supa
        .from("restoration_eta_predictions")
        .select(
          "outage_event_id, ts, low_hours, high_hours, confidence, model_version, reasons",
        )
        .eq("outage_event_id", id)
        .maybeSingle<EtaRow>(),
      supa
        .from("cause_predictions")
        .select(
          "outage_event_id, ts, cause, confidence, model_version, reasons",
        )
        .eq("outage_event_id", id)
        .maybeSingle<CauseRow>(),
    ]);

  if (outageErr) {
    const body: Payload = {
      outage: null,
      eta: null,
      cause: null,
      timeline: [],
      reason: "supabase_error",
      error: outageErr.message,
    };
    return NextResponse.json(body, { status: 500 });
  }
  if (!outage) {
    const body: Payload = {
      outage: null,
      eta: null,
      cause: null,
      timeline: [],
      reason: "not_found",
    };
    return NextResponse.json(body, { status: 404 });
  }

  // Pull a small timeline of official_updates around the event window so the
  // panel can render "what happened" without another fetch.
  const since = new Date(
    new Date(outage.started_at).getTime() - 60 * 60 * 1000,
  ).toISOString();
  const { data: updates } = await supa
    .from("official_updates")
    .select("id, ts, source, text, url")
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(20);

  const body: Payload = {
    outage,
    eta: eta
      ? {
          range_hours: [eta.low_hours, eta.high_hours],
          label: formatEtaLabel(eta.low_hours, eta.high_hours),
          confidence: eta.confidence,
          model_version: eta.model_version,
          reasons: eta.reasons,
          ts: eta.ts,
        }
      : null,
    cause: cause ?? null,
    timeline: (updates ?? []).map((r) => ({
      id: r.id,
      ts: r.ts,
      source: r.source,
      text: r.text,
      url: r.url,
    })),
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control":
        "public, max-age=60, s-maxage=120, stale-while-revalidate=180",
    },
  });
}
