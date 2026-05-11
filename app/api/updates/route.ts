import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { DEMO_MODE, demoUpdates } from "@/lib/demo";

interface UpdateRow {
  id: string;
  ts: string;
  source: string;
  category: string | null;
  text: string;
  url: string | null;
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
    .limit(40);

  if (error) return NextResponse.json({ items: [], error: error.message });

  const items = (data ?? []).map((r: UpdateRow) => ({
    id: r.id,
    ts: r.ts,
    source: r.source.startsWith("community") ? "community" : "official",
    category: r.category ?? undefined,
    text: r.text,
    url: r.url ?? undefined,
  }));

  return NextResponse.json({ items });
}
