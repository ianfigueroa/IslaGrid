import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { DEMO_MODE } from "@/lib/demo";
import { fallbackRate, pickActiveRate, type RateCategory } from "@/lib/rates";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = (url.searchParams.get("category") ?? "residential") as RateCategory;
  if (category !== "residential" && category !== "commercial") {
    return NextResponse.json({ error: "invalid category" }, { status: 400 });
  }

  if (DEMO_MODE) {
    return NextResponse.json({ rate: fallbackRate(category), demo: true });
  }

  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("preb_rates")
      .select("effective_date, rate_category, rate_per_kwh, source_url");
    if (error) throw new Error(error.message);
    const rate =
      pickActiveRate(data ?? [], category, new Date()) ?? fallbackRate(category);
    return NextResponse.json({ rate });
  } catch {
    return NextResponse.json({ rate: fallbackRate(category), fallback: true });
  }
}
