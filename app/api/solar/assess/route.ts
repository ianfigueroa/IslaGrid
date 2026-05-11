import { NextResponse } from "next/server";
import { getServerSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { geocode } from "@/lib/geocode";
import { pvwatts } from "@/lib/pvwatts";
import {
  SOLAR_ASSUMPTIONS,
  assess,
  recommendSystemSize,
} from "@/lib/solar";
import { pickActiveRate, seedRate } from "@/lib/rates";
import { clientIp, hashIp } from "@/lib/client-ip";
import { checkRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bounds catch typos/abuse before they pollute the analytics table.
const MONTHLY_KWH_MIN = 10;
const MONTHLY_KWH_MAX = 10000;
const SOLAR_HOURLY_LIMIT_PER_IP = 30;

interface SubmitBody {
  address?: string;
  lat?: number;
  lon?: number;
  monthlyKwh?: number;
  systemKw?: number;
  withBattery?: boolean;
}

export async function POST(req: Request) {
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const monthlyKwh = Number(body.monthlyKwh);
  if (
    !Number.isFinite(monthlyKwh) ||
    monthlyKwh < MONTHLY_KWH_MIN ||
    monthlyKwh > MONTHLY_KWH_MAX
  ) {
    return NextResponse.json(
      {
        error: `monthlyKwh must be between ${MONTHLY_KWH_MIN} and ${MONTHLY_KWH_MAX} kWh.`,
      },
      { status: 400 },
    );
  }

  // Cheap IP rate limit (Redis-backed when configured). Stops a flood of
  // distinct addresses from ballooning solar_assessments + geocode_cache.
  const ipKey = `solar:${hashIp(clientIp(req), "REPORT_IP_SALT")}`;
  const rate = await checkRate(ipKey, SOLAR_HOURLY_LIMIT_PER_IP, 3600);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: "Hourly limit reached. Try again later.",
        retry_after_seconds: rate.resetSeconds,
      },
      { status: 429 },
    );
  }

  let lat = body.lat;
  let lon = body.lon;
  let displayName: string | undefined;

  if ((lat == null || lon == null) && body.address) {
    const hit = await geocode(body.address);
    if (!hit) {
      return NextResponse.json(
        { error: "Could not geocode that address inside Puerto Rico." },
        { status: 400 },
      );
    }
    lat = hit.lat;
    lon = hit.lon;
    displayName = hit.displayName;
  }

  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    lat < 17 ||
    lat > 19.5 ||
    lon < -68.5 ||
    lon > -64
  ) {
    return NextResponse.json(
      { error: "lat/lon outside Puerto Rico" },
      { status: 400 },
    );
  }

  const systemKw =
    typeof body.systemKw === "number" && body.systemKw > 0
      ? body.systemKw
      : recommendSystemSize(monthlyKwh);

  // Live PVWatts call — null when NREL_API_KEY is missing or the API errored.
  const pv = await pvwatts({ lat, lon, systemKw });
  if (!pv) {
    return NextResponse.json({
      lat,
      lon,
      displayName,
      systemKw,
      reason: "pvwatts_unavailable",
      message:
        "NREL PVWatts didn't return data. The most common cause is a missing NREL_API_KEY in this environment. No estimate is shown because we won't fabricate one.",
      // NB: we deliberately do NOT echo the NREL host or any infra details
      // back to clients.
      assumptions: SOLAR_ASSUMPTIONS,
    });
  }

  // Pull the current PREB rate so $ savings reflects real tariffs, not a guess.
  let effectivePerKwh = seedRate("residential").effectivePerKwh;
  if (isSupabaseConfigured()) {
    try {
      const supa = getServerSupabase();
      const { data } = await supa
        .from("preb_rates")
        .select("effective_date, rate_category, rate_per_kwh, source_url");
      const real = pickActiveRate(data ?? [], "residential", new Date());
      if (real) effectivePerKwh = real.effectivePerKwh;
    } catch {
      /* fall back to seed */
    }
  }

  const result = assess({
    monthlyKwh,
    effectiveRatePerKwh: effectivePerKwh,
    annualKwhFromPv: pv.acAnnualKwh,
    systemKw,
    withBattery: !!body.withBattery,
  });

  // Persist (best-effort) so the dataset of "who asked about solar" exists.
  if (isSupabaseConfigured()) {
    try {
      const supa = getServerSupabase();
      await supa.from("solar_assessments").insert({
        lat,
        lon,
        monthly_kwh_input: monthlyKwh,
        system_kw: systemKw,
        annual_kwh_est: result.annualKwh,
        monthly_savings_est: result.monthlySavings,
        payback_years: result.paybackYears,
        battery_kwh_rec: result.batteryKwhRecommended,
        score: result.score,
        financial_score: result.financialScore,
        resilience_score: result.resilienceScore,
        top_reasons: result.topReasons,
        assumptions: SOLAR_ASSUMPTIONS,
        // Source version is stored server-side only for replayability; not
        // surfaced to clients.
        source_version: "pvwatts:v8",
      });
    } catch {
      /* non-critical */
    }
  }

  return NextResponse.json({
    lat,
    lon,
    displayName,
    effectivePerKwh,
    assumptions: SOLAR_ASSUMPTIONS,
    pvwatts: {
      acAnnualKwh: pv.acAnnualKwh,
      acMonthlyKwh: pv.acMonthlyKwh,
      capacityFactor: pv.capacityFactor,
    },
    assessment: result,
  });
}
