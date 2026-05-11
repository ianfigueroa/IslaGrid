import { Circle, CircleDot, Square, Triangle, MinusCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GridStatus } from "@/lib/supabase";

const COPY: Record<GridStatus, string> = {
  normal: "Normal",
  watch: "Watch",
  strained: "Strained",
  critical: "Critical",
  stale: "Stale",
  unknown: "Unknown",
};

const ICON: Record<GridStatus, typeof Circle> = {
  normal: CircleDot,
  watch: Circle,
  strained: Triangle,
  critical: Square,
  stale: MinusCircle,
  unknown: MinusCircle,
};

const TONE: Record<GridStatus, string> = {
  normal: "chip-status-normal",
  watch: "chip-status-watch",
  strained: "chip-status-strained",
  critical: "chip-status-critical pulse-critical",
  stale: "chip-status-stale",
  unknown: "chip-status-stale",
};

interface Props {
  status: GridStatus;
  className?: string;
  onClick?: () => void;
}

export function StatusPill({ status, className, onClick }: Props) {
  const Icon = ICON[status];
  const classes = cn(
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors",
    TONE[status],
    onClick && "cursor-pointer hover:brightness-125",
    className,
  );

  const body = (
    <>
      <Icon className="size-3" aria-hidden />
      {COPY[status]}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Grid status: ${COPY[status]}. Click for details.`}
        className={classes}
      >
        {body}
      </button>
    );
  }

  return (
    <span
      role="status"
      aria-label={`Grid status: ${COPY[status]}`}
      className={classes}
    >
      {body}
    </span>
  );
}
