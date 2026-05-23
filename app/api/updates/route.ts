import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { UpdateTier } from "@/app/(map)/_components/UpdateTimeline";

interface UpdateRow {
  id: string;
  ts: string;
  source: string;
  category: string | null;
  text: string;
  url: string | null;
}

interface Payload {
  items: Array<{
    id: string;
    ts: string;
    source: UpdateTier;
    category?: string;
    text: string;
    url?: string;
  }>;
  reason?: "supabase_unconfigured" | "ingest_pending" | "supabase_error";
  error?: string;
}

function classifyTier(row: UpdateRow): UpdateTier {
  if (row.source.startsWith("social.")) return "unverified";
  if (row.category === "planned-work") return "planned";
  if (row.source.endsWith("/avisos") || row.category === "announcement")
    return "announcement";
  if (row.source.startsWith("community")) return "community";
  return "official";
}

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET() {
  if (!isSupabaseConfigured()) {
    const body: Payload = { items: [], reason: "supabase_unconfigured" };
    return NextResponse.json(body);
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("official_updates")
    .select("id, ts, source, category, text, url")
    .order("ts", { ascending: false })
    .limit(60);

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[updates] supabase read failed", error);
    const body: Payload = {
      items: [],
      reason: "supabase_error",
    };
    return NextResponse.json(body);
  }

  const items = (data ?? []).map((r: UpdateRow) => ({
    id: r.id,
    ts: r.ts,
    source: classifyTier(r),
    category: r.category ?? undefined,
    text: r.text,
    url: r.url ?? undefined,
  }));

  const body: Payload = {
    items,
    reason: items.length === 0 ? "ingest_pending" : undefined,
  };
  return NextResponse.json(body);
}
