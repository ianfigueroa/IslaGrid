import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { DEMO_MODE, demoUpdates } from "@/lib/demo";
import type { UpdateTier } from "@/app/(map)/_components/UpdateTimeline";

interface UpdateRow {
  id: string;
  ts: string;
  source: string;
  category: string | null;
  text: string;
  url: string | null;
}

function classifyTier(row: UpdateRow): UpdateTier {
  if (row.source.startsWith("social.")) return "unverified";
  if (row.category === "planned-work") return "planned";
  if (row.source.endsWith("/avisos") || row.category === "announcement") return "announcement";
  if (row.source.startsWith("community")) return "community";
  return "official";
}

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET() {
  if (DEMO_MODE) {
    return NextResponse.json({ items: demoUpdates(), note: "demo" });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("official_updates")
    .select("id, ts, source, category, text, url")
    .order("ts", { ascending: false })
    .limit(60);

  if (error) return NextResponse.json({ items: [], error: error.message });

  const items = (data ?? []).map((r: UpdateRow) => ({
    id: r.id,
    ts: r.ts,
    source: classifyTier(r),
    category: r.category ?? undefined,
    text: r.text,
    url: r.url ?? undefined,
  }));

  return NextResponse.json({ items });
}
