/**
 * Wrapper for /api/public/* handlers. Validates the API key (when present),
 * enforces per-key or per-IP rate limits, and tags responses with rate
 * headers so clients can self-throttle.
 *
 * Anonymous tier: 60 req/min and 1000 req/day per IP. Tight on purpose —
 * researchers should mint a free key.
 *
 * Keyed tier: per-key limits from the api_keys table.
 */

import { NextResponse } from "next/server";
import { checkRate } from "./rate-limit";
import { extractKey, lookupKey, recordUsage, type ApiKey } from "./api-keys";
import { clientIp } from "./client-ip";

const ANON_PER_MIN = 60;
const ANON_PER_DAY = 1000;

function ipFrom(req: Request): string {
  const ip = clientIp(req);
  return ip === "unknown" ? "anon:unknown" : ip;
}

interface PublicHandler {
  (req: Request, ctx: { apiKey: ApiKey | null }): Promise<NextResponse>;
}

export interface PublicMeta {
  /** Used in rate-limit IDs and the request log. */
  route: string;
}

export function publicHandler(
  meta: PublicMeta,
  handler: PublicHandler,
): (req: Request) => Promise<NextResponse> {
  return async (req: Request) => {
    const start = Date.now();
    const rawKey = extractKey(req);
    const apiKey = rawKey ? await lookupKey(rawKey) : null;

    const principalId = apiKey ? `key:${apiKey.id}` : `ip:${ipFrom(req)}`;
    const perMinLimit = apiKey?.ratePerMinute ?? ANON_PER_MIN;
    const perDayLimit = apiKey?.ratePerDay ?? ANON_PER_DAY;

    const [perMin, perDay] = await Promise.all([
      checkRate(`${principalId}:m`, perMinLimit, 60),
      checkRate(`${principalId}:d`, perDayLimit, 86400),
    ]);

    // Fail-closed in prod when Upstash is missing — public API must not run
    // without a binding limit. Dev still passes through (unbounded:true).
    if (perMin.disabled || perDay.disabled) {
      return NextResponse.json(
        {
          error: "Public API is temporarily unavailable (rate limiter not configured).",
          docs: "/docs/api",
        },
        { status: 503 },
      );
    }

    if (!perMin.allowed || !perDay.allowed) {
      const limit = !perMin.allowed ? "per-minute" : "per-day";
      const reset = !perMin.allowed ? perMin.resetSeconds : perDay.resetSeconds;
      const res = NextResponse.json(
        {
          error: `Rate limit exceeded (${limit}).`,
          retry_after_seconds: reset,
          tier: apiKey?.tier ?? "anonymous",
          docs: "/docs/api#rate-limits",
        },
        { status: 429 },
      );
      addRateHeaders(res, perMin, perDay, perMinLimit, perDayLimit, apiKey);
      if (apiKey) void recordUsage(apiKey.id, meta.route, 429, Date.now() - start);
      return res;
    }

    if (rawKey && !apiKey) {
      return NextResponse.json(
        { error: "Invalid or revoked API key.", docs: "/docs/api#auth" },
        { status: 401 },
      );
    }

    let res: NextResponse;
    try {
      res = await handler(req, { apiKey });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[public-api]", meta.route, err);
      res = NextResponse.json({ error: "Internal error." }, { status: 500 });
    }

    addRateHeaders(res, perMin, perDay, perMinLimit, perDayLimit, apiKey);
    if (apiKey) {
      void recordUsage(apiKey.id, meta.route, res.status, Date.now() - start);
    }
    return res;
  };
}

function addRateHeaders(
  res: NextResponse,
  perMin: { remaining: number; resetSeconds: number },
  perDay: { remaining: number; resetSeconds: number },
  perMinLimit: number,
  perDayLimit: number,
  apiKey: ApiKey | null,
): void {
  res.headers.set("x-islagrid-tier", apiKey?.tier ?? "anonymous");
  res.headers.set("x-ratelimit-limit-minute", String(perMinLimit));
  res.headers.set("x-ratelimit-remaining-minute", String(perMin.remaining));
  res.headers.set("x-ratelimit-reset-minute", String(perMin.resetSeconds));
  res.headers.set("x-ratelimit-limit-day", String(perDayLimit));
  res.headers.set("x-ratelimit-remaining-day", String(perDay.remaining));
  res.headers.set("x-ratelimit-reset-day", String(perDay.resetSeconds));
}
