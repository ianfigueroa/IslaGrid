import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  computeMunicipalityHistory,
  computeMuniPercentile,
  WINDOW_DAYS,
  type MunicipalityHistory,
  type WindowKey,
} from "@/lib/reliability";

export const dynamic = "force-dynamic";
export const revalidate = 300;

interface Payload {
  history?: MunicipalityHistory;
  reason?: "supabase_unconfigured" | "bad_window" | "supabase_error";
  error?: string;
}

function parseWindow(raw: string | null): WindowKey | null {
  if (!raw) return "365d";
  if (raw in WINDOW_DAYS) return raw as WindowKey;
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const windowKey = parseWindow(url.searchParams.get("window"));
  if (!windowKey) {
    const body: Payload = { reason: "bad_window" };
    return NextResponse.json(body, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    const body: Payload = { reason: "supabase_unconfigured" };
    return NextResponse.json(body);
  }

  try {
    const supabase = getServerSupabase();
    // Run history + percentile in parallel — percentile needs to scan all
    // municipios so it's the slower of the two; running them concurrently
    // shaves ~150ms off the API response on warm queries.
    const [history, percentile] = await Promise.all([
      computeMunicipalityHistory(supabase, id, windowKey),
      computeMuniPercentile(supabase, id, windowKey),
    ]);
    const body: Payload = {
      history: { ...history, percentile },
    };
    return NextResponse.json(body, {
      headers: {
        "Cache-Control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "history fetch failed";
    const body: Payload = { reason: "supabase_error", error: message };
    return NextResponse.json(body, { status: 500 });
  }
}
