import { NextResponse } from "next/server";
import {
  getServerSupabase,
  isSupabaseConfigured,
  type GridSnapshot,
} from "@/lib/supabase";
import { fuseGridSnapshots } from "@/lib/grid-fusion";

export const dynamic = "force-dynamic";
export const revalidate = 60;

interface Payload {
  snapshot: GridSnapshot | null;
  source_map?: Partial<Record<keyof GridSnapshot, string>>;
  reason?: "supabase_unconfigured" | "ingest_pending" | "supabase_error";
  error?: string;
}

async function latestBySource(
  supabase: ReturnType<typeof getServerSupabase>,
  source: string,
) {
  const res = await supabase
    .from("grid_snapshots")
    .select("*")
    .eq("source", source)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle<GridSnapshot>();
  return res.data ?? null;
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    const body: Payload = { snapshot: null, reason: "supabase_unconfigured" };
    return NextResponse.json(body);
  }

  const supabase = getServerSupabase();

  // Pull the freshest row from each upstream source independently. Field-level
  // fusion (see lib/grid-fusion.ts) then picks the right value for each field
  // from the source that's authoritative for it. This stops a stale merged
  // row from masking newer Genera numbers, and stops a raw Genera-only row
  // from blanking out the demand column when the merge job is between cycles.
  const [genera, luma, merged, anyLatest] = await Promise.all([
    latestBySource(supabase, "genera-pr.com"),
    latestBySource(supabase, "lumapr.com"),
    latestBySource(supabase, "islagrid-merged"),
    supabase
      .from("grid_snapshots")
      .select("*")
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle<GridSnapshot>()
      .then((r) => r.data ?? null),
  ]);

  const { snapshot, source_map } = fuseGridSnapshots({
    genera,
    luma,
    merged,
    anyLatest,
  });

  const body: Payload = {
    snapshot,
    source_map: snapshot ? source_map : undefined,
    reason: snapshot ? undefined : "ingest_pending",
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control":
        "public, max-age=60, s-maxage=60, stale-while-revalidate=120",
    },
  });
}
