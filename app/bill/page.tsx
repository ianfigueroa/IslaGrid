import type { Metadata } from "next";
import { BillCalculator } from "./BillCalculator";
import { fallbackRate } from "@/lib/rates";

export const metadata: Metadata = {
  title: "Bill estimator — IslaGrid",
  description:
    "Estimate your Puerto Rico electricity bill from kWh usage or a list of appliances. Uses PREB-approved tariff line items.",
};

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export default function BillPage() {
  // Server-render with the seeded fallback so the page is meaningful with no
  // network. The client component refreshes from /api/rates/current on mount.
  const initialRate = fallbackRate("residential");
  return <BillCalculator initialRate={initialRate} />;
}
