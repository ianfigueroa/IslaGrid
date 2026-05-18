/**
 * API-key auth for the public API.
 *
 * Keys look like `ig_<prefix>_<secret>`. `<prefix>` is 8 chars in plaintext
 * for display only; `<secret>` is the random body. We hash the full key with
 * HMAC-SHA-256 using a server-side pepper (`API_KEY_PEPPER`). Rotating the
 * pepper invalidates every key — that is the intended escape hatch.
 *
 * In dev or when the pepper is unset we fall back to plain SHA-256 so local
 * setups don't require the env var; prod operators should always set the
 * pepper (logged at startup when missing).
 */

import crypto from "node:crypto";
import { getServiceSupabase, isSupabaseConfigured } from "./supabase";

export interface ApiKey {
  id: string;
  name: string;
  tier: "researcher" | "commercial" | "internal";
  ratePerMinute: number;
  ratePerDay: number;
}

export function hashKey(key: string): string {
  const pepper = process.env.API_KEY_PEPPER;
  if (!pepper) {
    // In production a missing pepper means stored hashes are precomputable
    // from any low-entropy key. Refuse to start the request rather than
    // silently degrade to plain SHA-256 the way the old code did.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "API_KEY_PEPPER must be set in production. Refusing to hash keys with SHA-256-only fallback.",
      );
    }
    return crypto.createHash("sha256").update(key).digest("hex");
  }
  return crypto.createHmac("sha256", pepper).update(key).digest("hex");
}

export function extractKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  const header = req.headers.get("x-islagrid-api-key");
  if (header) return header.trim() || null;
  return null;
}

export async function lookupKey(rawKey: string): Promise<ApiKey | null> {
  if (!isSupabaseConfigured()) return null;
  const supa = getServiceSupabase();
  const { data, error } = await supa
    .from("api_keys")
    .select("id, name, tier, rate_per_minute, rate_per_day, status")
    .eq("key_hash", hashKey(rawKey))
    .maybeSingle();
  if (error || !data) return null;
  if (data.status !== "active") return null;
  return {
    id: data.id as string,
    name: data.name as string,
    tier: data.tier as ApiKey["tier"],
    ratePerMinute: Number(data.rate_per_minute),
    ratePerDay: Number(data.rate_per_day),
  };
}

export async function recordUsage(
  apiKeyId: string,
  route: string,
  status: number,
  durationMs: number,
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supa = getServiceSupabase();
    await Promise.all([
      supa
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", apiKeyId),
      supa.from("api_request_log").insert({
        api_key_id: apiKeyId,
        route,
        status_code: status,
        duration_ms: durationMs,
      }),
    ]);
  } catch {
    /* logging is best-effort — never block a response */
  }
}
