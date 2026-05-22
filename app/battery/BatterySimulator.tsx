"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CHEMISTRIES,
  chemistryById,
  estimateCost,
  sizeBattery,
  type ApplianceLoad,
  type BatteryChemistry,
} from "@/lib/battery";
import { formatCurrencyCompact, formatWatts } from "@/lib/format";

interface Props {
  appliances: ApplianceLoad[];
}

export function BatterySimulator({ appliances }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["fridge", "lights", "router", "fan", "phone"]),
  );
  const [targetHours, setTargetHours] = useState(24);
  const [solarKw, setSolarKw] = useState(0);
  const [chemistryId, setChemistryId] = useState<BatteryChemistry["id"]>("lfp");

  // Allow microgrid hand-off from /solar — `?from=solar&kw=4.5` pre-fills the
  // solar field so users don't re-enter what they just told the Solar Lens.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromKw = Number(params.get("kw") || "");
    if (params.get("from") === "solar" && Number.isFinite(fromKw) && fromKw > 0) {
      setSolarKw(fromKw);
    }
  }, []);

  const chemistry = chemistryById(chemistryId);
  const result = useMemo(() => {
    const chosen = appliances.filter((a) => selected.has(a.id));
    return sizeBattery({
      selected: chosen,
      targetHours,
      solarKwInstalled: solarKw,
      chemistry: chemistryId,
    });
  }, [appliances, selected, targetHours, solarKw, chemistryId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="surface rounded-xl p-5">
        <p className="text-[11px] font-mono uppercase tracking-wider text-text-3">
          What stays on?
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {appliances.map((a) => {
            const checked = selected.has(a.id);
            return (
              <label
                key={a.id}
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                  checked
                    ? "border-brand/60 bg-brand-soft text-text"
                    : "border-line bg-surface text-text-2 hover:bg-surface-2 hover:text-text"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(a.id)}
                  className="mt-0.5 size-4 accent-brand"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {a.label}
                    {a.critical ? (
                      <span className="ml-2 rounded-md border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-warn">
                        Critical
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[10px] text-text-3">
                    {a.watts} W · {Math.round(a.dutyCycle * 100)}% duty
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-[11px] font-mono uppercase tracking-wider text-text-3">
              Outage duration target
            </span>
            <input
              type="range"
              min={4}
              max={72}
              step={1}
              value={targetHours}
              onChange={(e) => setTargetHours(Number(e.target.value))}
              className="mt-2 w-full accent-brand"
            />
            <span className="mt-1 block font-mono text-sm text-text">
              {targetHours} hours
            </span>
          </label>
          <label className="block text-sm">
            <span className="text-[11px] font-mono uppercase tracking-wider text-text-3">
              Existing solar (kW DC, optional)
            </span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={solarKw}
              onChange={(e) => setSolarKw(Number(e.target.value))}
              className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-text outline-none transition-colors focus:border-brand/60"
            />
          </label>
        </div>

        <div className="mt-5">
          <p className="text-[11px] font-mono uppercase tracking-wider text-text-3">
            Battery chemistry
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {CHEMISTRIES.map((c) => {
              const active = c.id === chemistryId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChemistryId(c.id)}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? "border-brand/60 bg-brand-soft text-text"
                      : "border-line bg-surface text-text-2 hover:bg-surface-2 hover:text-text"
                  }`}
                  title={c.tradeoff}
                >
                  <div className="font-medium">{c.label}</div>
                  <div className="text-[10px] text-text-3">
                    {Math.round(c.dod * 100)}% DOD · ${c.costPerKwh}/kWh · {c.cycleLife.toLocaleString()} cycles
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[10px] text-text-3">{chemistry.tradeoff}</p>
        </div>
      </div>

      <div className="surface rounded-xl p-5">
        <h2 className="text-base font-semibold">Recommended setup</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Battery size"
            value={`${result.batteryKwhRecommended} kWh`}
          />
          <Stat
            label="Realistic backup"
            value={`${result.realisticHours} hours`}
          />
          <Stat
            label="Storm reserve"
            value={`${result.stormReserveKwh} kWh`}
          />
          <Stat
            label="Average draw"
            value={formatWatts(result.averageWatts)}
          />
          <Stat
            label="Inverter (min)"
            value={formatWatts(result.recommendedInverterWatts)}
          />
          <Stat
            label="Peak surge"
            value={formatWatts(result.peakSurgeWatts)}
          />
          <Stat
            label="Estimated cost"
            value={formatCurrencyCompact(
              estimateCost(result.batteryKwhRecommended, chemistryId),
            )}
          />
          <Stat
            label="Solar recharge"
            value={
              result.solarRechargeKwhPerDay > 0
                ? `${result.solarRechargeKwhPerDay.toFixed(1)} kWh/day`
                : "—"
            }
          />
        </div>
        {result.notes.length > 0 ? (
          <div className="mt-5 space-y-1">
            <p className="text-[11px] font-mono uppercase tracking-wider text-text-3">
              Notes
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-text-2">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mt-5 text-[10px] text-text-3">
          Estimated · {Math.round(chemistry.dod * 100)}% usable DOD ({chemistry.label}) · 5.5 sun-hours/day for PR ·
          inverter sized 10% above peak motor surge.
        </p>
      </div>
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
