// UpdateTimeline.tsx now exports only the shared types. The bottom
// timeline + right-drawer UIs were replaced by StatusPanel in the
// new chrome design — the feed renders there instead. Other callers
// (e.g. /api/updates) still import these types, so we keep them here
// as the single source of truth.

export type UpdateTier =
  | "official"
  | "planned"
  | "announcement"
  | "community"
  | "model"
  | "unverified";

export interface UpdateItem {
  id: string;
  ts: string;
  source: UpdateTier;
  category?: string;
  text: string;
  url?: string;
}
