import Link from "next/link";
import type { Scorecard } from "@/lib/scorecards";

const BAND_LABEL: Record<string, string> = {
  low: "Low",
  elevated: "Elevated",
  high: "High",
  severe: "Severe",
  unknown: "Unknown",
};

const BAND_TONE: Record<string, string> = {
  low: "text-ok",
  elevated: "text-warn",
  high: "text-orange-500",
  severe: "text-crit",
  unknown: "text-text-3",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  data: Scorecard;
}

export function MunicipalityScorecard({ data }: Props) {
  const { basics, risk, prediction6h, plannedWork, recentOutages, history30d } = data;
  return (
    <div className="space-y-6">
      <header className="surface rounded-xl p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-3">
          Municipality scorecard · Puerto Rico
        </p>
        <h1 className="mt-2 text-3xl font-semibold">{basics.name}</h1>
        <p className="mt-1 text-sm text-text-3">
          FIPS {basics.fips ?? basics.id}
          {basics.population
            ? ` · population ${basics.population.toLocaleString("en-US")}`
            : null}
        </p>
        {data.reason === "supabase_unconfigured" ? (
          <p className="mt-4 rounded-md border border-line bg-surface-2 p-3 text-xs text-text-2">
            Live data isn&rsquo;t configured in this environment. Scorecard
            fields will populate once Supabase ingestion is connected.
          </p>
        ) : null}
      </header>

      {data.vulnerability ? (
        <section className="surface rounded-xl p-5">
          <header className="flex items-baseline justify-between">
            <p className="text-[11px] font-mono uppercase tracking-wider text-text-3">
              Infrastructure vulnerability
            </p>
            <span className="text-[10px] text-text-3">
              confidence {data.vulnerability.confidence}
            </span>
          </header>
          <p className="mt-2 font-mono text-3xl text-text">
            {Math.round(data.vulnerability.total_score)}
            <span className="ml-1 text-base text-text-3">/100</span>
          </p>
          {data.vulnerability.reasons.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-2">
              {data.vulnerability.reasons.slice(0, 4).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-[10px] text-text-3">
            Sources: {data.vulnerability.sources.join(", ") || "—"}
          </p>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <Card title="Current risk band">
          {risk ? (
            <>
              <p className={`font-mono text-3xl ${BAND_TONE[risk.band]}`}>
                {Math.round(risk.score)}
                <span className="ml-1 text-base text-text-3">/100</span>
              </p>
              <p className={`text-sm ${BAND_TONE[risk.band]}`}>
                {BAND_LABEL[risk.band]}
              </p>
              <p className="mt-2 text-[10px] text-text-3">as of {fmtTime(risk.ts)}</p>
            </>
          ) : (
            <p className="text-sm text-text-3">Risk not scored yet</p>
          )}
        </Card>
        <Card title="Outage probability · 6h">
          {prediction6h ? (
            <>
              <p className="font-mono text-3xl text-text">
                {Math.round(prediction6h.probability * 100)}
                <span className="ml-1 text-base text-text-3">%</span>
              </p>
              <p className="text-sm text-text-2">
                Confidence: {prediction6h.confidence_band}
              </p>
              <p className="mt-2 text-[10px] text-text-3">
                model {prediction6h.model_version}
              </p>
            </>
          ) : (
            <p className="text-sm text-text-3">No prediction yet</p>
          )}
        </Card>
        <Card title="Planned work · active">
          <p className="font-mono text-3xl text-text">{plannedWork.length}</p>
          <p className="text-sm text-text-2">items in window</p>
        </Card>
      </section>

      {risk && risk.reasons.length > 0 ? (
        <section className="surface rounded-xl p-5">
          <h2 className="text-sm font-mono uppercase tracking-wider text-text-3">
            Why this risk band
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-2">
            {risk.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {plannedWork.length > 0 ? (
        <section className="surface rounded-xl p-5">
          <h2 className="text-sm font-mono uppercase tracking-wider text-text-3">
            Planned work
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {plannedWork.map((pw) => (
              <li key={pw.id} className="py-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-text">{pw.work_type ?? "Planned work"}</span>
                  <span className="font-mono text-[10px] text-text-3">
                    {fmtTime(pw.start_ts)} → {fmtTime(pw.end_ts)}
                  </span>
                </div>
                <p className="text-xs text-text-2">{pw.area ?? "Area not provided"}</p>
                {pw.possible_interruption ? (
                  <p className="text-[10px] text-warn">Possible service interruption</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recentOutages.length > 0 ? (
        <section className="surface rounded-xl p-5">
          <h2 className="text-sm font-mono uppercase tracking-wider text-text-3">
            Recent outage events
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {recentOutages.map((o) => (
              <li key={o.id} className="py-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-text capitalize">{o.kind}</span>
                  <span className="font-mono text-[10px] text-text-3">
                    {fmtTime(o.started_at)}
                    {o.ended_at ? ` → ${fmtTime(o.ended_at)}` : " · ongoing"}
                  </span>
                </div>
                {o.snippet ? (
                  <p className="text-xs text-text-2">{o.snippet}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {history30d.length > 0 ? (
        <section className="surface rounded-xl p-5">
          <h2 className="text-sm font-mono uppercase tracking-wider text-text-3">
            Risk over the last 30 days
          </h2>
          <Sparkline points={history30d} />
          <p className="mt-2 text-[10px] text-text-3">
            {history30d.length} samples · island-wide median shown for context
          </p>
        </section>
      ) : null}

      <footer className="surface rounded-xl p-5 text-xs text-text-3">
        <p>
          Every number on this page traces back to a real ingested row in
          Supabase or to a labeled heuristic estimate. See{" "}
          <Link href="/attribution" className="underline-offset-2 hover:underline hover:text-text-2">
            sources &amp; attribution
          </Link>{" "}
          for the per-source freshness policy.
        </p>
      </footer>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="surface rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-wider text-text-3">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Sparkline({ points }: { points: { ts: string; score: number }[] }) {
  if (points.length === 0) return null;
  const width = 600;
  const height = 80;
  const padding = 4;
  const max = 100;
  const step = (width - padding * 2) / Math.max(1, points.length - 1);
  const path = points
    .map((p, i) => {
      const x = padding + i * step;
      const y = padding + (1 - p.score / max) * (height - padding * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="30-day risk score history"
      className="mt-3 h-20 w-full"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-brand" />
    </svg>
  );
}
