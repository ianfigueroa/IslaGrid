import { NextResponse } from "next/server";
import { publicHandler } from "@/lib/public-api";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const GET = publicHandler(
  { route: "/api/public/generation/current" },
  async () => {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ items: [], reason: "supabase_unconfigured" });
    }
    const supa = getServerSupabase();
    // Latest snapshot per plant within the last hour.
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { data, error } = await supa
      .from("generation_snapshots")
      .select("ts, plant_id, fuel, mw, available_mw, source")
      .gte("ts", since)
      .order("ts", { ascending: false })
      .limit(1000);

    if (error) {
      return NextResponse.json(
        { items: [], reason: "supabase_error", error: error.message },
        { status: 502 },
      );
    }

    // Dedupe per plant — keep newest only.
    const seen = new Map<string, (typeof data)[number]>();
    for (const row of data ?? []) {
      const id = row.plant_id as string;
      if (!seen.has(id)) seen.set(id, row);
    }
    const items = Array.from(seen.values());

    return NextResponse.json({
      items,
      count: items.length,
      reason: items.length === 0 ? "ingest_pending" : undefined,
    });
  },
);
