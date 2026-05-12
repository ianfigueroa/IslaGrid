/**
 * Sliding-window rate limit backed by Upstash Redis.
 *
 * In dev: falls back to "allow + unbounded:true" when Redis isn't configured.
 * In prod: returns disabled:true so callers can fail-closed for public endpoints
 * that must not run unbounded. The app-side anon routes can still pass through.
 */

import { Redis } from "@upstash/redis";

let redis: Redis | null = null;
let warnedMissingProd = false;
function client(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === "production" && !warnedMissingProd) {
      warnedMissingProd = true;
      // eslint-disable-next-line no-console
      console.error(
        "[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN unset in production. " +
          "Public API routes will fail-closed. Configure Upstash to enable.",
      );
    }
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
  /** True when Upstash isn't configured — caller may want to log. */
  unbounded?: boolean;
  /** True when running in prod without Upstash; callers should fail-closed. */
  disabled?: boolean;
}

/**
 * Single Redis key per (id, window) with INCR + EXPIRE. Cheaper than a true
 * sliding-window; adequate for API rate-limiting on free tiers.
 */
export async function checkRate(
  id: string,
  limit: number,
  windowSeconds: number,
): Promise<RateDecision> {
  const r = client();
  if (!r) {
    const isProd = process.env.NODE_ENV === "production";
    return {
      allowed: !isProd,
      remaining: isProd ? 0 : limit,
      resetSeconds: windowSeconds,
      unbounded: !isProd,
      disabled: isProd,
    };
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
