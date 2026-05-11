"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function MapError({ error, reset }: Props) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[IslaGrid map error]", error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 py-16 text-text">
      <div className="surface w-full max-w-md rounded-xl p-6">
        <div className="flex items-center gap-2 text-warn">
          <TriangleAlert className="size-4" aria-hidden />
          <p className="font-mono text-[11px] uppercase tracking-[0.18em]">
            Map could not load
          </p>
        </div>
        <h1 className="mt-2 text-xl font-semibold">The grid map crashed.</h1>
        <p className="mt-3 text-sm text-text-2">
          MapLibre or one of the data fetches threw an error during render.
          You can try reloading the map — the rest of the site (bill estimator,
          attribution, etc.) is unaffected.
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
            Reload map
          </button>
          <a
            href="/bill"
            className="rounded-md border border-line px-3 py-1.5 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            Open bill estimator
          </a>
        </div>
      </div>
    </main>
  );
}
