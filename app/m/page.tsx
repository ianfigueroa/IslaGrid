import type { Metadata } from "next";
import { listMunicipalities } from "@/lib/scorecards";

export const metadata: Metadata = {
  title: "Municipalities — IslaGrid",
  description:
    "Per-municipality grid scorecards for all 78 Puerto Rico municipalities.",
};

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export default async function MunicipalitiesIndex() {
  const munis = await listMunicipalities();
  return (
    <main className="min-h-dvh bg-bg px-4 py-10 text-text sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-3">
          Municipality scorecards
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          All {munis.length} Puerto Rico municipalities
        </h1>
        <p className="mt-3 text-sm text-text-2">
          Each scorecard surfaces real ingested data for that municipality —
          current risk band, 6h outage probability, planned work, recent outage
          events, and a 30-day risk-score sparkline.
        </p>
        <ul className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {munis.map((m) => (
            <li key={m.id}>
              <a
                href={`/m/${m.id}`}
                className="surface flex items-center justify-between gap-3 rounded-md p-3 transition-colors hover:bg-surface-2"
              >
                <span className="font-medium">{m.name}</span>
                <span className="font-mono text-[10px] text-text-3">{m.id}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
