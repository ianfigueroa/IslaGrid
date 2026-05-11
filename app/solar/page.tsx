import type { Metadata } from "next";
import { SolarAssessor } from "./SolarAssessor";
import { SOLAR_ASSUMPTIONS } from "@/lib/solar";

export const metadata: Metadata = {
  title: "Solar Lens — IslaGrid",
  description:
    "Is solar worth it at your address in Puerto Rico? Source-labeled estimate from NREL PVWatts v8 + PREB-approved electricity rates.",
};

export const dynamic = "force-dynamic";

export default function SolarPage() {
  return (
    <main className="min-h-dvh bg-bg px-4 py-10 text-text sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-3">
          Solar Lens · Estimate
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Is solar worth it at your address?
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-text-2">
          We hit NREL PVWatts v8 with your location, use the current
          PREB-approved residential rate for $ savings, and surface every
          assumption so you can sanity-check the math.
        </p>

        <div className="mt-8">
          <SolarAssessor assumptions={SOLAR_ASSUMPTIONS} />
        </div>

        <section className="surface mt-10 rounded-xl p-5 text-sm text-text-2">
          <h2 className="text-base font-semibold text-text">
            Sources &amp; honesty notes
          </h2>
          <ul className="mt-3 space-y-2">
            <li>
              Production estimate: <span className="text-text">NREL PVWatts v8</span>{" "}
              (typical meteorological year). Estimate only.
            </li>
            <li>
              $ savings:{" "}
              <span className="text-text">PREB-approved residential rate</span>{" "}
              from <code>/api/rates/current</code>. Updates as PREB issues new
              orders.
            </li>
            <li>
              Install $/W and battery $/kWh are PR-market averages, listed in
              the assumptions box above the form. We don&rsquo;t track quotes
              from specific installers.
            </li>
            <li>
              We never store an exact address. Lat/lon are kept only for the
              site-specific PVWatts response and the anonymized assessment row.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
