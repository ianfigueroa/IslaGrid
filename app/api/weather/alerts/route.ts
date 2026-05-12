import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

const NWS_ALERTS = "https://api.weather.gov/alerts/active?area=PR";
const TIMEOUT_MS = 8000;

interface NwsFeature {
  id: string;
  geometry: GeoJSON.Geometry | null;
  properties: {
    event: string;
    headline?: string;
    severity?: string;
    urgency?: string;
    certainty?: string;
    effective?: string;
    expires?: string;
    onset?: string;
    senderName?: string;
    areaDesc?: string;
  };
}

interface NwsResponse {
  features: NwsFeature[];
}

export async function GET() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(NWS_ALERTS, {
      headers: {
        Accept: "application/geo+json",
        "User-Agent": "islagrid-ai/0.1 (+iantdm11@gmail.com)",
      },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({
        type: "FeatureCollection",
        features: [],
        reason: "nws_error",
        status: res.status,
      });
    }
    const json = (await res.json()) as NwsResponse;
    const features = (json.features ?? [])
      .filter((f) => f.geometry !== null)
      .map((f) => ({
        type: "Feature" as const,
        id: f.id,
        geometry: f.geometry as GeoJSON.Geometry,
        properties: {
          event: f.properties.event,
          headline: f.properties.headline ?? null,
          severity: f.properties.severity ?? "Unknown",
          urgency: f.properties.urgency ?? "Unknown",
          certainty: f.properties.certainty ?? "Unknown",
          effective: f.properties.effective ?? null,
          expires: f.properties.expires ?? null,
          onset: f.properties.onset ?? null,
          area: f.properties.areaDesc ?? null,
        },
      }));
    return NextResponse.json(
      {
        type: "FeatureCollection",
        features,
        source: "api.weather.gov",
        fetched_at: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? "nws_timeout"
        : "nws_error";
    return NextResponse.json({
      type: "FeatureCollection",
      features: [],
      reason: msg,
    });
  } finally {
    clearTimeout(timer);
  }
}
