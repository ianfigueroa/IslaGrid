import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";
// 30s cache: the upstream ingest is on a 5-min cron, and the floating "Last
// hour" card on the map polls at this same cadence — pretty much pointless
// to go tighter unless we move ingest off GitHub Actions.
export const revalidate = 30;

export interface RecentUpdate {
  id: string;
  ts: string;
  source: string;
  category: string | null;
  text: string;
  url: string | null;
}

interface Payload {
  updates: RecentUpdate[];
  fetched_at: string;
  reason?: "supabase_unconfigured" | "supabase_error";
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json<Payload>({
      updates: [],
      fetched_at: new Date().toISOString(),
      reason: "supabase_unconfigured",
    });
  }
  try {
    const supabase = getServerSupabase();
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("official_updates")
      .select("id, ts, source, category, text, url")
      .gte("ts", since)
      .order("ts", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    const payload: Payload = {
      updates: (data ?? []) as RecentUpdate[],
      fetched_at: new Date().toISOString(),
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control":
          "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    return NextResponse.json<Payload>(
      {
        updates: [],
        fetched_at: new Date().toISOString(),
        reason: "supabase_error",
      },
      { status: 500, headers: { "x-error": message } },
    );
  }
}
