import type { Metadata } from "next";
import { DisasterClient } from "./DisasterClient";

export const metadata: Metadata = {
  title: "Disaster mode — IslaGrid",
  description:
    "Low-bandwidth Puerto Rico grid status for outages and storms. Works offline once loaded.",
  // Tell the browser to allow homescreen install.
  manifest: "/disaster/manifest.json",
};

export const dynamic = "force-dynamic";

export default function DisasterPage() {
  return (
    <main className="min-h-dvh bg-bg text-text">
      <DisasterClient />
    </main>
  );
}
