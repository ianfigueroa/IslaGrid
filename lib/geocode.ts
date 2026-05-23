/**
 * Address → lat/lon for Puerto Rico, with Supabase-backed caching to respect
 * Nominatim's 1 req/s policy and keep response times sub-100ms on repeats.
 */

import crypto from "node:crypto";
import { getServerSupabase, isSupabaseConfigured } from "./supabase";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = process.env.GEOCODER_UA ?? "islagrid-ai/0.1 (+contact@islagrid.app)";

export interface Geocoded {
  lat: number;
  lon: number;
  displayName: string;
  source: "nominatim" | "cache";
}

function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function hashQuery(query: string): string {
  return crypto
    .createHash("sha256")
    .update(`geocode:${normalize(query)}`)
    .digest("hex")
    .slice(0, 48);
}

function withinPR(lat: number, lon: number): boolean {
  return lat >= 17 && lat <= 19.5 && lon >= -68.5 && lon <= -64;
}

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
}

const NOMINATIM_TIMEOUT_MS = 8000;
const NOMINATIM_MIN_GAP_MS = 1100; // Nominatim's published policy: <=1 req/s.

// Per-process throttle so repeated cache misses can't burst-call Nominatim.
// Each instance maintains its own clock — fine because the IP-rate-limit at
// the route layer (30/h per requester) caps the upper bound anyway. A
// distributed throttle would need Redis; not worth it for the volume.
let lastNominatimAt = 0;
async function respectNominatimRate(): Promise<void> {
  const now = Date.now();
  const wait = lastNominatimAt + NOMINATIM_MIN_GAP_MS - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastNominatimAt = Date.now();
}

async function callNominatim(query: string): Promise<Geocoded | null> {
  await respectNominatimRate();
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", `${query}, Puerto Rico`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "pr");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NOMINATIM_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en,es" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as NominatimHit[];
    const first = rows[0];
    if (!first) return null;
    const lat = parseFloat(first.lat);
    const lon = parseFloat(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (!withinPR(lat, lon)) return null;
    return { lat, lon, displayName: first.display_name, source: "nominatim" };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return null;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function geocode(query: string): Promise<Geocoded | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Cache lookup. Per the 2026-05 PII migration (0027) we no longer store
  // the raw `query` or upstream `display_name` — those columns were a
  // re-identification surface when joined with solar_assessments. On a cache
  // hit we fall back to the user's input as the display string.
  if (isSupabaseConfigured()) {
    const supa = getServerSupabase();
    const { data } = await supa
      .from("geocode_cache")
      .select("lat, lon, source")
      .eq("query_hash", hashQuery(trimmed))
      .maybeSingle();
    if (data && typeof data.lat === "number" && typeof data.lon === "number") {
      return {
        lat: data.lat,
        lon: data.lon,
        displayName: trimmed,
        source: "cache",
      };
    }
  }

  const hit = await callNominatim(trimmed);
  if (!hit) return null;

  if (isSupabaseConfigured()) {
    const supa = getServerSupabase();
    await supa
      .from("geocode_cache")
      .upsert(
        {
          query_hash: hashQuery(trimmed),
          lat: hit.lat,
          lon: hit.lon,
          source: hit.source,
        },
        { onConflict: "query_hash" },
      );
  }
  return hit;
}
