"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BatteryCharging,
  Calculator,
  Info,
  LifeBuoy,
  Map as MapIcon,
  MapPin,
  Menu,
  Moon,
  Satellite,
  Sun,
  X,
  Zap,
} from "lucide-react";
import type { Basemap } from "./GridMap";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "./ThemeToggle";

interface NavItem {
  href: Route;
  label: string;
  Icon: typeof MapIcon;
  hint: string;
  variant?: "default" | "emergency";
}

const NAV: NavItem[] = [
  { href: "/" as Route,         label: "Map",            Icon: MapIcon,         hint: "Live grid + weather" },
  { href: "/m" as Route,        label: "Municipalities", Icon: MapPin,          hint: "Reliability scorecard for all 78" },
  { href: "/bill" as Route,     label: "Bill",           Icon: Calculator,      hint: "Estimate your kWh bill" },
  { href: "/solar" as Route,    label: "Solar",          Icon: Sun,             hint: "Is solar worth it?" },
  { href: "/battery" as Route,  label: "Battery",        Icon: BatteryCharging, hint: "Backup sizing" },
  { href: "/disaster" as Route, label: "Disaster",       Icon: LifeBuoy,        hint: "Storm mode",         variant: "emergency" },
];

/**
 * Floating brand chip in the top-left. Click → slides out a left-side
 * navigation drawer with the calculator tools. Designed to disappear into
 * the map when not needed; pop with intent when needed.
 */
interface BrandPillProps {
  onMap?: boolean;
  basemap?: Basemap;
  onBasemapChange?: (next: Basemap) => void;
}

export function BrandPill({ onMap = true, basemap, onBasemapChange }: BrandPillProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          "pointer-events-auto absolute z-30 flex items-center gap-2",
          onMap ? "left-4 top-12" : "left-4 top-12",
        )}
      >
        <motion.button
          type="button"
          onClick={() => setOpen(true)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          aria-label="Open menu"
          aria-expanded={open}
          className="flex h-11 items-center gap-2.5 rounded-full glass-strong pl-2.5 pr-4 text-text transition-shadow hover:shadow-[var(--shadow-card-lg)]"
        >
          <span className="grid size-7 place-items-center rounded-full bg-brand text-white">
            <Zap className="size-3.5" aria-hidden />
          </span>
          <span className="flex flex-col items-start leading-tight">
            <span className="text-[13px] font-semibold tracking-tight">IslaGrid</span>
            <span className="text-[9px] uppercase tracking-[0.18em] text-text-3">
              Puerto Rico
            </span>
          </span>
          <Menu className="ml-1 size-4 text-text-2" aria-hidden />
        </motion.button>
      </div>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <motion.aside
              key="drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Main menu"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 36, mass: 0.9 }}
              className="pointer-events-auto fixed inset-y-0 left-0 z-50 flex w-[min(20rem,90vw)] flex-col glass-strong"
            >
              <div className="flex items-center gap-3 border-b border-line px-5 py-4">
                <span className="grid size-9 place-items-center rounded-full bg-brand text-white">
                  <Zap className="size-4" aria-hidden />
                </span>
                <div className="flex flex-col leading-tight">
                  <span className="text-base font-semibold tracking-tight">IslaGrid</span>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-text-3">
                    Puerto Rico grid intelligence
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="ml-auto grid size-9 place-items-center rounded-full text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <motion.nav
                aria-label="Primary"
                className="flex-1 overflow-y-auto p-3"
                initial="hidden"
                animate="visible"
                variants={{
                  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
                }}
              >
                {NAV.map(({ href, label, Icon, hint, variant }) => (
                  <motion.div
                    key={href}
                    variants={{
                      hidden: { opacity: 0, x: -8 },
                      visible: { opacity: 1, x: 0 },
                    }}
                  >
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "group flex items-center gap-3 rounded-xl px-3 py-3 transition-colors",
                        variant === "emergency"
                          ? "text-warn hover:bg-warn-soft"
                          : "text-text hover:bg-surface-2",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-10 shrink-0 place-items-center rounded-xl",
                          variant === "emergency"
                            ? "bg-warn-soft text-warn"
                            : "bg-surface-2 text-text-2 group-hover:bg-brand-soft group-hover:text-brand",
                        )}
                      >
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="text-[15px] font-medium">{label}</span>
                        <span className="text-[11px] text-text-3">{hint}</span>
                      </span>
                    </Link>
                  </motion.div>
                ))}

                <div className="my-3 h-px bg-line" />

                <Link
                  href={"/attribution" as Route}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
                >
                  <Info className="size-4" aria-hidden />
                  <span className="text-[13px]">Sources &amp; attribution</span>
                </Link>
              </motion.nav>

              {onBasemapChange ? (
                <div className="border-t border-line px-5 py-3">
                  <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-text-3">
                    Basemap
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      { key: "light", label: "Light", Icon: Sun },
                      { key: "dark", label: "Dark", Icon: Moon },
                      { key: "satellite", label: "Satellite", Icon: Satellite },
                    ] as const).map(({ key, label, Icon }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onBasemapChange(key)}
                        aria-pressed={basemap === key}
                        className={cn(
                          "flex h-10 flex-col items-center justify-center gap-0.5 rounded-lg border text-[11px] font-medium transition-colors",
                          basemap === key
                            ? "border-brand bg-brand-soft text-brand"
                            : "border-line bg-surface text-text-2 hover:bg-surface-2 hover:text-text",
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
                <span className="text-[11px] text-text-3">Theme</span>
                <ThemeToggle />
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
