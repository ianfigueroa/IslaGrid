"use client";

import { useState } from "react";
import type { SolarAssumptions, AssessmentResult } from "@/lib/solar";

interface Props {
  assumptions: SolarAssumptions;
}

interface ApiOk {
  lat: number;
  lon: number;
  displayName?: string;
  effectivePerKwh: number;
  assumptions: SolarAssumptions;
  pvwatts: {
    acAnnualKwh: number;
    acMonthlyKwh: number[];
    capacityFactor: number;
  };
  assessment: AssessmentResult;
}

interface ApiPending {
  reason: "pvwatts_unavailable";
  message: string;
  lat: number;
  lon: number;
  systemKw: number;
}

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; data: ApiOk }
  | { kind: "pending"; data: ApiPending }
  | { kind: "error"; message: string };

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function years(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)} yr`;
}

export function SolarAssessor({ assumptions }: Props) {
  const [address, setAddress] = useState("");
  const [monthlyKwh, setMonthlyKwh] = useState(800);
  const [withBattery, setWithBattery] = useState(true);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit() {
    if (!address.trim()) {
      setState({ kind: "error", message: "Enter an address or municipality." });
      return;
    }
    if (monthlyKwh <= 0) {
      setState({ kind: "error", message: "Monthly kWh must be greater than 0." });
      return;
    }
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/solar/assess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, monthlyKwh, withBattery }),
      });
      const body = (await res.json()) as
        | (ApiOk & { reason?: undefined })
        | ApiPending
        | { error: string };
      if (!res.ok) {
        const msg = "error" in body ? body.error : "Assessment failed.";
        setState({ kind: "error", message: msg });
        return;
      }
      if ("reason" in body && body.reason === "pvwatts_unavailable") {
        setState({ kind: "pending", data: body });
        return;
      }
      setState({ kind: "ok", data: body as ApiOk });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="surface rounded-xl p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-[11px] font-mono uppercase tracking-wider text-text-3">
              Address or municipality
            </span>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. Calle Loíza, San Juan"
              className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-text outline-none transition-colors focus:border-brand/60"
            />
          </label>
          <label className="block text-sm">
            <span className="text-[11px] font-mono uppercase tracking-wider text-text-3">
              Monthly usage (kWh)
            </span>
            <input
              type="number"
              min={50}
              step={10}
              value={monthlyKwh}
              onChange={(e) => setMonthlyKwh(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-text outline-none transition-colors focus:border-brand/60"
            />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-text-2">
          <input
            type="checkbox"
            checked={withBattery}
            onChange={(e) => setWithBattery(e.target.checked)}
            className="size-4 accent-brand"
          />
          Include a battery (resilience score)
        </label>

        <details className="mt-4 text-[11px] text-text-3">
          <summary className="cursor-pointer text-text-2">Assumptions used</summary>
          <ul className="mt-2 space-y-1 font-mono">
            <li>Install: ${assumptions.installCostPerWatt.toFixed(2)} / watt DC</li>
            <li>Battery: ${assumptions.batteryCostPerKwh} / kWh installed</li>
            <li>Tilt: {assumptions.defaultTiltDeg}°, Azimuth: {assumptions.defaultAzimuthDeg}° (south)</li>
            <li>Losses: {assumptions.defaultLossesPct}% (PVWatts default)</li>
            <li>Target offset: {Math.round(assumptions.defaultOffsetTarget * 100)}% of monthly usage</li>
            <li>Annual degradation: {(assumptions.degradationPerYear * 100).toFixed(2)}%</li>
          </ul>
        </details>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={state.kind === "sending"}
            className="cursor-pointer rounded-md bg-brand px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state.kind === "sending" ? "Running PVWatts…" : "Estimate"}
          </button>
          {state.kind === "error" ? (
            <span className="text-xs text-warn">{state.message}</span>
          ) : null}
        </div>
      </div>

      {state.kind === "pending" ? (
        <div className="surface rounded-xl p-5 text-sm text-text-2">
          <p className="text-text">Estimate not available right now.</p>
          <p className="mt-2 text-xs">{state.data.message}</p>
        </div>
      ) : null}

      {state.kind === "ok" ? <Result data={state.data} /> : null}
    </div>
  );
}

function Result({ data }: { data: ApiOk }) {
  const r = data.assessment;
  return (
    <div className="surface rounded-xl p-5">
      {data.displayName ? (
        <p className="text-[11px] font-mono uppercase tracking-wider text-text-3">
          {data.displayName}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h2 className="text-3xl font-semibold text-text tabular-nums">
          {r.score}
          <span className="ml-1 text-base font-normal text-text-3">/ 100</span>
        </h2>
        <span className="text-sm text-text-2">Solar worth-it score</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="System size" value={`${r.systemKw.toFixed(1)} kW`} />
        <Stat
          label="Annual production"
          value={`${Math.round(r.annualKwh).toLocaleString("en-US")} kWh`}
        />
        <Stat label="Monthly savings" value={usd(r.monthlySavings)} />
        <Stat label="Payback" value={years(r.paybackYears)} />
        <Stat label="Install cost" value={usd(r.installCost)} />
        <Stat
          label="Battery"
          value={
            r.batteryKwhRecommended > 0
              ? `${r.batteryKwhRecommended.toFixed(1)} kWh · ${usd(r.batteryCost)}`
              : "Not included"
          }
        />
        <Stat label="Financial score" value={`${r.financialScore} / 100`} />
        <Stat label="Resilience score" value={`${r.resilienceScore} / 100`} />
      </div>

      <div className="mt-5">
        <p className="text-[11px] font-mono uppercase tracking-wider text-text-3">
          Why this score
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-2">
          {r.topReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

      <p className="mt-5 text-[10px] text-text-3">
        Estimate · NREL PVWatts v8 · capacity factor{" "}
        {Math.round(data.pvwatts.capacityFactor * 100)}% · rate $
        {data.effectivePerKwh.toFixed(3)}/kWh
      </p>
      <p className="mt-2 text-[10px]">
        <a
          href="/battery"
          className="text-text-2 underline-offset-2 hover:text-text hover:underline"
        >
          Size a battery for these appliances →
        </a>
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <p className="text-[10px] uppercase tracking-wider text-text-3">{label}</p>
      <p className="mt-1 font-mono text-base text-text tabular-nums">{value}</p>
    </div>
  );
}
