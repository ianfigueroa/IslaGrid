import type { Metadata } from "next";
import { BatterySimulator } from "./BatterySimulator";
import { APPLIANCE_LOADS } from "@/lib/battery";
import { SubPageHeader } from "@/app/_components/SubPageHeader";

export const metadata: Metadata = {
  title: "Battery backup simulator — IslaGrid",
  description:
    "Pick what you'd keep running during a Puerto Rico outage and see the battery size, backup duration, and cost it would take.",
};

export const dynamic = "force-dynamic";

export default function BatteryPage() {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <SubPageHeader title="Battery sizing" />
      <main className="px-4 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-3xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-3">
          Battery backup · Sizing
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          What battery do you need to ride out an outage?
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-text-2">
          Pick the appliances you want to keep running and how long the outage
          might last. We size the pack with a 20% storm reserve and 90% usable
          DOD (typical for LFP chemistry).
        </p>

        <div className="mt-8">
          <BatterySimulator appliances={APPLIANCE_LOADS} />
        </div>

        <section className="surface mt-10 rounded-xl p-5 text-sm text-text-2">
          <h2 className="text-base font-semibold text-text">
            Assumptions &amp; honesty notes
          </h2>
          <ul className="mt-3 space-y-2">
            <li>
              Appliance wattages and duty cycles are <span className="text-text">typical residential averages</span>{" "}
              — your specific model can vary 20%+. Treat the result as an
              estimate and use a Kill-A-Watt meter for the loads that dominate.
            </li>
            <li>
              Battery $/kWh is a <span className="text-text">2026 PR-market midpoint</span> for installed LFP packs. New
              federal or local incentives, or labor variability, can move this
              by ±$300/kWh. Get installer quotes for real numbers.
            </li>
            <li>
              We assume 5.5 sun-hours/day — PR&rsquo;s annual average from the
              NREL PSM3 dataset. Wet-season weeks get materially less.
            </li>
            <li>
              This sizer does <span className="text-text">not</span> account for surge currents on motor starts
              (compressors, well pumps). For real installs you want 2–3×
              continuous wattage headroom on the inverter.
            </li>
          </ul>
        </section>
        </div>
      </main>
    </div>
  );
}
