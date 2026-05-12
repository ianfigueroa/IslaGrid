import type { Metadata } from "next";
import { NotificationsClient } from "./NotificationsClient";

export const metadata: Metadata = {
  title: "Notification preferences — IslaGrid",
  description:
    "Opt in to grid-event digests via SMS or email. Strict frequency caps to avoid alert fatigue.",
};

export default function NotificationsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Notification preferences
        </h1>
        <p className="mt-2 text-sm text-text-2">
          Choose how you want IslaGrid to reach you when the grid changes
          state or a storm becomes a threat. Frequency is capped at twice an
          hour; no marketing, ever.
        </p>
      </header>
      <NotificationsClient />
    </main>
  );
}
