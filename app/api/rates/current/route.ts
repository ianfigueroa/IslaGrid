import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { pickActiveRate, seedRate, type RateCategory } from "@/lib/rates";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = (url.searchParams.get("category") ??
    "residential") as RateCategory;
  if (category !== "residential" && category !== "commercial") {
    return NextResponse.json({ error: "invalid category" }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      rate: seedRate(category),
      reason: "supabase_unconfigured",
    });
  }

  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("preb_rates")
      .select("effective_date, rate_category, rate_per_kwh, source_url");
    if (error) throw new Error(error.message);
    const real = pickActiveRate(data ?? [], category, new Date());
    if (real) return NextResponse.json({ rate: real });
    return NextResponse.json({
      rate: seedRate(category),
      reason: "ingest_pending",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "rate fetch failed";
    return NextResponse.json({
      rate: seedRate(category),
      reason: "supabase_error",
      error: message,
    });
  }
}
