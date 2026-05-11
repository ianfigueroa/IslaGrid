"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Sun, Trash2, Zap } from "lucide-react";
import {
  APPLIANCE_PRESETS,
  estimateBill,
  rankAppliances,
  applianceKwh,
  solarOffsetSavings,
  type Appliance,
} from "@/lib/bill";
import type { RateBreakdown, RateCategory } from "@/lib/rates";
import { SOURCES } from "@/lib/sources";

interface Props {
  initialRate: RateBreakdown;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const kwh = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fixed3 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

function defaultAppliances(): Appliance[] {
  return APPLIANCE_PRESETS.slice(0, 4).map((p) => ({ ...p, id: makeId() }));
}

export function BillCalculator({ initialRate }: Props) {
  const [rate, setRate] = useState<RateBreakdown>(initialRate);
  const [category, setCategory] = useState<RateCategory>("residential");
  const [usageMode, setUsageMode] = useState<"direct" | "appliances">("direct");
  const [usageKwh, setUsageKwh] = useState(800);
  const [appliances, setAppliances] = useState<Appliance[]>(defaultAppliances);
  const [solarOffset, setSolarOffset] = useState(0);

  // Refresh rate from the API once the page hydrates; falls back silently.
  useEffect(() => {
    let active = true;
    void fetch(`/api/rates/current?category=${category}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j?.rate) setRate(j.rate as RateBreakdown);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [category]);

  const applianceUsage = useMemo(
    () =>
      appliances.reduce(
        (sum, a) => sum + applianceKwh(a.watts, a.hoursPerDay),
        0,
      ),
    [appliances],
  );

  const totalUsage = usageMode === "direct" ? usageKwh : applianceUsage;
  const bill = useMemo(() => estimateBill(totalUsage, rate), [totalUsage, rate]);
  const rankings = useMemo(
    () => rankAppliances(appliances, rate.effectivePerKwh, bill.total),
    [appliances, rate.effectivePerKwh, bill.total],
  );
  const solar = useMemo(
    () => solarOffsetSavings(totalUsage, solarOffset, rate),
    [totalUsage, solarOffset, rate],
  );

  const sourceMeta = SOURCES.preb;

  return (
    <div className="min-h-dvh bg-bg text-text">
      <header className="surface sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-md">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to map
        </Link>
        <div className="ml-2 flex items-center gap-2 border-l border-line pl-4">
          <Zap className="size-4 text-brand" aria-hidden />
          <span className="font-mono text-sm">
            IslaGrid<span className="text-text-3">/PR</span>
          </span>
        </div>
        <span className="ml-auto hidden font-mono text-[11px] text-text-3 md:inline">
          Informational — not for operational decisions
        </span>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10 md:py-14">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Bill estimator
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-text-2">
            Estimate your monthly bill from kWh usage or a list of appliances.
            Numbers come from PREB-approved tariff line items effective{" "}
            <span className="font-mono">{rate.effectiveDate}</span>; this is a
            line-item estimate, not a final invoice.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* === Inputs === */}
          <section className="space-y-6">
            <Card title="Account">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Customer type">
                  <ToggleRow
                    options={[
                      { id: "residential", label: "Residential" },
                      { id: "commercial", label: "Commercial" },
                    ]}
                    value={category}
                    onChange={(v) => setCategory(v as RateCategory)}
                  />
                </Field>
                <Field label="Effective rate">
                  <div className="font-mono text-sm">
                    <span className="text-text">
                      {fixed3.format(rate.effectivePerKwh)} $/kWh
                    </span>
                    <span className="ml-2 text-text-3">
                      + {currency.format(rate.fixedMonthly)}/mo fixed
                    </span>
                  </div>
                  <span className="text-[11px] text-text-3">
                    Source: {sourceMeta.label} · PREB · {rate.effectiveDate}
                  </span>
                </Field>
              </div>
            </Card>

            <Card title="Usage">
              <ToggleRow
                options={[
                  { id: "direct", label: "I know my kWh" },
                  { id: "appliances", label: "Estimate from appliances" },
                ]}
                value={usageMode}
                onChange={(v) => setUsageMode(v as "direct" | "appliances")}
              />

              {usageMode === "direct" ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Monthly usage (kWh)">
                    <NumberInput
                      value={usageKwh}
                      min={0}
                      max={20000}
                      step={10}
                      onChange={setUsageKwh}
                    />
                  </Field>
                  <Field label="At a glance">
                    <div className="font-mono text-sm">
                      <span className="text-text">{kwh.format(usageKwh)} kWh</span>
                      <span className="ml-2 text-text-3">
                        ≈ {currency.format(estimateBill(usageKwh, rate).total)}/mo
                      </span>
                    </div>
                  </Field>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {appliances.map((a) => (
                    <ApplianceRow
                      key={a.id}
                      appliance={a}
                      onChange={(next) =>
                        setAppliances((prev) =>
                          prev.map((x) => (x.id === next.id ? next : x)),
                        )
                      }
                      onRemove={() =>
                        setAppliances((prev) => prev.filter((x) => x.id !== a.id))
                      }
                    />
                  ))}
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() =>
                        setAppliances((prev) => [
                          ...prev,
                          { id: makeId(), name: "Custom appliance", watts: 100, hoursPerDay: 1 },
                        ])
                      }
                      className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-xs text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Add appliance
                    </button>
                    <PresetMenu
                      onPick={(preset) =>
                        setAppliances((prev) => [...prev, { ...preset, id: makeId() }])
                      }
                    />
                    <span className="ml-auto font-mono text-xs text-text-3">
                      total: {kwh.format(applianceUsage)} kWh/mo
                    </span>
                  </div>
                </div>
              )}
            </Card>

            <Card
              title={
                <span className="inline-flex items-center gap-2">
                  <Sun className="size-4 text-brand" aria-hidden /> Solar scenario
                </span>
              }
            >
              <p className="text-xs text-text-3">
                Net metering credits solar production 1:1 at the residential rate.
                Move the slider to see the offset.
              </p>
              <div className="mt-3">
                <input
                  type="range"
                  min={0}
                  max={Math.max(100, Math.round(totalUsage * 1.2))}
                  step={10}
                  value={solarOffset}
                  onChange={(e) => setSolarOffset(parseInt(e.target.value, 10))}
                  className="w-full accent-brand"
                  aria-label="Monthly solar offset in kWh"
                />
                <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-text-3">
                  <span>0 kWh</span>
                  <span>{kwh.format(solarOffset)} kWh offset</span>
                  <span>{kwh.format(Math.max(100, Math.round(totalUsage * 1.2)))} kWh</span>
                </div>
              </div>
            </Card>
          </section>

          {/* === Summary === */}
          <aside className="space-y-5">
            <Card title="Estimated bill">
              <div className="text-4xl font-semibold tracking-tight font-mono">
                {currency.format(bill.total)}
              </div>
              <div className="mt-1 text-xs text-text-3">
                {kwh.format(totalUsage)} kWh ·{" "}
                <span className="font-mono">
                  {fixed3.format(bill.effectivePerKwh)} $/kWh effective
                </span>
              </div>
              <dl className="mt-4 space-y-1.5 text-sm">
                <LineItem label="Base energy" value={bill.baseEnergy} />
                <LineItem label="Fuel adjustment" value={bill.fuelAdj} />
                <LineItem label="Purchased power" value={bill.purchasedPwr} />
                <LineItem label="Customer charge" value={bill.fixed} />
                <div className="my-2 border-t border-line" />
                <LineItem label="Total" value={bill.total} bold />
              </dl>
              <p className="mt-3 text-[10px] uppercase tracking-wider text-text-3">
                Source: PREB tariff · effective {rate.effectiveDate}
              </p>
            </Card>

            {solarOffset > 0 ? (
              <Card title="Solar offset preview">
                <dl className="space-y-1.5 text-sm">
                  <LineItem label="Grid usage after solar" value={solar.newGridKwh} suffix=" kWh" />
                  <LineItem label="Estimated savings" value={solar.savings} highlight />
                  <LineItem label="Effective $/kWh after" value={solar.effectivePerKwhAfter} fixed={3} suffix=" $/kWh" />
                </dl>
                <p className="mt-3 text-[10px] uppercase tracking-wider text-text-3">
                  Estimated · assumes 1:1 net metering credit
                </p>
              </Card>
            ) : null}

            {usageMode === "appliances" && rankings.length > 0 ? (
              <Card title="Top contributors">
                <ul className="space-y-2 text-sm">
                  {rankings.slice(0, 5).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3">
                      <span className="truncate text-text-2">{r.name}</span>
                      <span className="font-mono text-xs">
                        <span className="text-text">{currency.format(r.costPerMonth)}</span>
                        <span className="ml-2 text-text-3">
                          {kwh.format(r.kwhPerMonth)} kWh
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </aside>
        </div>

        <div className="mt-12 text-[11px] text-text-3">
          Tariff source:{" "}
          <a
            href={rate.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-text-2 underline-offset-2 hover:underline"
          >
            energia.pr.gov · current rate
          </a>{" "}
          · Rate components refreshed when PREB issues a new quarterly order.
          This page never shows a final invoice — it shows what the PREB
          line-items produce for your inputs.
        </div>
      </main>
    </div>
  );
}

/* ───────────────────────── building blocks ───────────────────────── */

function Card({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-solid rounded-xl p-4 md:p-5">
      <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-text-3">
        {title}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-text-2">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const next = Number(e.target.value);
        onChange(Number.isFinite(next) ? next : 0);
      }}
      className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-sm text-text outline-none transition-colors hover:border-line-2 focus:border-brand"
      inputMode="decimal"
    />
  );
}

function ToggleRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={
              "rounded px-2.5 py-1.5 text-xs font-medium transition-colors " +
              (active
                ? "bg-surface-2 text-text"
                : "text-text-2 hover:text-text")
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function LineItem({
  label,
  value,
  highlight,
  bold,
  suffix = "",
  fixed,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  bold?: boolean;
  suffix?: string;
  fixed?: number;
}) {
  const formatted =
    suffix.trim() === "kWh"
      ? `${kwh.format(value)}${suffix}`
      : fixed !== undefined
        ? `${value.toFixed(fixed)}${suffix}`
        : currency.format(value);
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-text-2 ${bold ? "text-text font-medium" : ""}`}>
        {label}
      </span>
      <span
        className={`font-mono text-sm ${
          bold ? "text-text font-medium" : ""
        } ${highlight ? "text-ok" : ""}`}
      >
        {formatted}
      </span>
    </div>
  );
}

function ApplianceRow({
  appliance,
  onChange,
  onRemove,
}: {
  appliance: Appliance;
  onChange: (a: Appliance) => void;
  onRemove: () => void;
}) {
  const monthly = applianceKwh(appliance.watts, appliance.hoursPerDay);
  return (
    <div className="grid grid-cols-[1fr_88px_88px_auto] items-center gap-2">
      <input
        type="text"
        value={appliance.name}
        onChange={(e) => onChange({ ...appliance, name: e.target.value })}
        className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-text outline-none transition-colors hover:border-line-2 focus:border-brand"
        aria-label="Appliance name"
      />
      <div className="relative">
        <input
          type="number"
          value={appliance.watts}
          min={0}
          step={10}
          onChange={(e) =>
            onChange({ ...appliance, watts: Math.max(0, Number(e.target.value)) })
          }
          className="w-full rounded-md border border-line bg-surface px-2 py-1.5 pr-7 font-mono text-xs text-text outline-none transition-colors hover:border-line-2 focus:border-brand"
          aria-label="Watts"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-3">W</span>
      </div>
      <div className="relative">
        <input
          type="number"
          value={appliance.hoursPerDay}
          min={0}
          max={24}
          step={0.25}
          onChange={(e) =>
            onChange({
              ...appliance,
              hoursPerDay: Math.max(0, Math.min(24, Number(e.target.value))),
            })
          }
          className="w-full rounded-md border border-line bg-surface px-2 py-1.5 pr-7 font-mono text-xs text-text outline-none transition-colors hover:border-line-2 focus:border-brand"
          aria-label="Hours per day"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-3">h</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-text-3 tabular-nums">
          {kwh.format(monthly)} kWh
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${appliance.name}`}
          className="grid size-7 place-items-center rounded-md text-text-3 transition-colors hover:bg-surface-2 hover:text-crit"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function PresetMenu({
  onPick,
}: {
  onPick: (preset: Omit<Appliance, "id">) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-xs text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
      >
        + Common appliance
      </button>
      {open ? (
        <div
          className="surface-solid absolute left-0 top-full z-20 mt-1 w-60 rounded-md p-1 shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          {APPLIANCE_PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => {
                onPick(p);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
            >
              <span className="truncate">{p.name}</span>
              <span className="font-mono text-text-3">{p.watts}W</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
