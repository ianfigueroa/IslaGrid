/**
 * Client-IP extraction with normalization so the same caller can't bypass
 * rate limits by varying X-Forwarded-For capitalization, bracket notation,
 * or trailing port.
 */

import crypto from "node:crypto";
import { isIP } from "node:net";

const DEFAULT_SALT = "islagrid-ip-salt-v1";

export function normalizeIp(raw: string): string {
  let candidate = raw.trim();
  if (candidate.startsWith("[")) {
    const end = candidate.indexOf("]");
    if (end > 0) candidate = candidate.slice(1, end);
  }
  if (candidate.split(":").length === 2 && isIP(candidate.split(":")[0])) {
    candidate = candidate.split(":")[0];
  }
  if (!isIP(candidate)) return "unknown";
  return candidate.toLowerCase();
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0];
    const normalized = normalizeIp(first);
    if (normalized !== "unknown") return normalized;
  }
  const real = req.headers.get("x-real-ip");
  if (real) {
    const normalized = normalizeIp(real);
    if (normalized !== "unknown") return normalized;
  }
  return "unknown";
}

export function hashIp(ip: string, saltEnvVar = "REPORT_IP_SALT"): string {
  const salt = process.env[saltEnvVar] ?? DEFAULT_SALT;
  return crypto
    .createHash("sha256")
    .update(`${salt}:${ip}`)
    .digest("hex")
    .slice(0, 32);
}
