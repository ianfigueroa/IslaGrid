import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

// PR + USVI bounding box, magnitude >= 2.5, last 7 days. USGS provides this
// canonical feed; we filter spatially to keep the payload small.
const USGS = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const TIMEOUT_MS = 8000;

interface UsgsFeature {
  id: string;
  geometry: GeoJSON.Geometry;
  properties: {
    mag: number;
    place: string;
    time: number;
    url: string;
    title: string;
  };
}

interface UsgsResponse {
  features: UsgsFeature[];
}

export async function GET() {
  const url = new URL(USGS);
  url.searchParams.set("format", "geojson");
  url.searchParams.set("starttime", new Date(Date.now() - 7 * 86400 * 1000).toISOString());
  url.searchParams.set("minmagnitude", "2.5");
  url.searchParams.set("minlatitude", "17.0");
  url.searchParams.set("maxlatitude", "19.5");
  url.searchParams.set("minlongitude", "-68.5");
  url.searchParams.set("maxlongitude", "-64.0");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "islagrid-ai/0.1",
      },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({
        type: "FeatureCollection",
        features: [],
        reason: "usgs_error",
        status: res.status,
      });
    }
    const json = (await res.json()) as UsgsResponse;
    return NextResponse.json(
      {
        type: "FeatureCollection",
        features: json.features ?? [],
        source: "usgs",
        fetched_at: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=120, s-maxage=300, stale-while-revalidate=900",
        },
      },
    );
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? "usgs_timeout"
        : "usgs_error";
    return NextResponse.json({
      type: "FeatureCollection",
      features: [],
      reason: msg,
    });
  } finally {
    clearTimeout(timer);
  }
}
