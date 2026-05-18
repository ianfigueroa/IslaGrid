"use client";

import { cn } from "@/lib/cn";

export type RangeKey = "30d" | "90d" | "365d";

const OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "365d", label: "Last 12 months" },
];

interface Props {
  value: RangeKey;
  onChange: (next: RangeKey) => void;
}

export function RangePicker({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Reporting window"
      className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface p-1"
    >
      {OPTIONS.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              "h-9 rounded-lg px-3.5 text-[12.5px] font-medium transition-colors",
              active
                ? "bg-brand text-white shadow-[0_4px_16px_-4px_var(--color-brand)]"
                : "text-text-2 hover:bg-surface-2 hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
