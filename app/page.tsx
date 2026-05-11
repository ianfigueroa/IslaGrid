import { ControlRoom } from "./(map)/_components/ControlRoom";
import type { GridSnapshot } from "@/lib/supabase";
import type { UpdateItem, UpdateTier } from "./(map)/_components/UpdateTimeline";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 60;

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
  if (row.source.endsWith("/avisos") || row.category === "announcement")
    return "announcement";
  if (row.source.startsWith("community")) return "community";
  return "official";
}

async function fetchInitial(): Promise<{
  snapshot: GridSnapshot | null;
  updates: UpdateItem[];
}> {
  if (!isSupabaseConfigured()) {
    return { snapshot: null, updates: [] };
  }
  try {
    const supabase = getServerSupabase();
    const [{ data: snap }, { data: feed }] = await Promise.all([
      supabase
        .from("grid_snapshots")
        .select("*")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle<GridSnapshot>(),
      supabase
        .from("official_updates")
        .select("id, ts, source, category, text, url")
        .order("ts", { ascending: false })
        .limit(40),
    ]);
    const updates: UpdateItem[] = (feed ?? []).map((r: UpdateRow) => ({
      id: r.id,
      ts: r.ts,
      source: classifyTier(r),
      category: r.category ?? undefined,
      text: r.text,
      url: r.url ?? undefined,
    }));
    return { snapshot: snap ?? null, updates };
  } catch {
    return { snapshot: null, updates: [] };
  }
}

export default async function Page() {
  const { snapshot, updates } = await fetchInitial();
  return <ControlRoom initialSnapshot={snapshot} initialUpdates={updates} />;
}
