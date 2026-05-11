"use client";

import { useEffect } from "react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootError({ error, reset }: Props) {
  useEffect(() => {
    // Surface to whatever telemetry we wire up later. For now, console.
    // eslint-disable-next-line no-console
    console.error("[IslaGrid root error]", error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 py-16 text-text">
      <div className="surface w-full max-w-md rounded-xl p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-warn">
          Something broke
        </p>
        <h1 className="mt-2 text-xl font-semibold">
          IslaGrid hit an unexpected error.
        </h1>
        <p className="mt-3 text-sm text-text-2">
          The crash has been logged. You can try again — if it keeps failing,
          the underlying data source (LUMA, datos.pr.gov, or Supabase) may be
          unavailable. Live ingestion always retries on its own schedule.
        </p>
        {error?.digest ? (
          <p className="mt-3 font-mono text-[10px] text-text-3">
            digest: {error.digest}
          </p>
        ) : null}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="cursor-pointer rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm transition-colors hover:bg-surface-3"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-md border border-line px-3 py-1.5 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            Go home
          </a>
        </div>
      </div>
    </main>
  );
}
