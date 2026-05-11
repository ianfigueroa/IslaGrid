import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

interface PlannedWorkRow {
  id: string;
  municipality_id: string | null;
  area: string | null;
  work_type: string | null;
  start_ts: string | null;
  end_ts: string | null;
  possible_interruption: boolean | null;
  source_url: string | null;
  scraped_at: string;
}

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ items: [] });
  }

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("planned_work")
    .select(
      "id, municipality_id, area, work_type, start_ts, end_ts, possible_interruption, source_url, scraped_at",
    )
    .order("scraped_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ items: [], error: error.message });
  }

  return NextResponse.json({ items: (data ?? []) as PlannedWorkRow[] });
}
