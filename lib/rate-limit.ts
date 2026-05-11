/**
 * Sliding-window rate limit backed by Upstash Redis.
 *
 * Falls back to "allow with a warning" when Redis isn't configured — we'd
 * rather serve a researcher than 500 on env misconfig. Production must
 * configure Upstash for the limit to actually bind.
 */

import { Redis } from "@upstash/redis";

let redis: Redis | null = null;
function client(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
  /** True when Upstash wasn't configured — caller may want to log. */
  unbounded?: boolean;
}

/**
 * Sliding-window-ish: a single Redis key per (id, window) with INCR + EXPIRE.
 * Less accurate than true sliding-window, far cheaper. Adequate for API
 * rate-limiting on free tiers.
 */
export async function checkRate(
  id: string,
  limit: number,
  windowSeconds: number,
): Promise<RateDecision> {
  const r = client();
  if (!r) {
    return { allowed: true, remaining: limit, resetSeconds: windowSeconds, unbounded: true };
  }
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `rl:${id}:${windowSeconds}:${bucket}`;
  const count = await r.incr(key);
  if (count === 1) {
    await r.expire(key, windowSeconds + 5);
  }
  const remaining = Math.max(0, limit - count);
  const resetSeconds = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
  return { allowed: count <= limit, remaining, resetSeconds };
}
