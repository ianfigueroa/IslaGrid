"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  BatteryCharging,
  Calculator,
  LifeBuoy,
  Map as MapIcon,
  Menu,
  Sun,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "./ThemeToggle";

interface NavLink {
  href: Route;
  label: string;
  Icon: typeof MapIcon;
  hint?: string;
}

const LINKS: NavLink[] = [
  { href: "/" as Route, label: "Map", Icon: MapIcon, hint: "Live grid + weather" },
  { href: "/bill" as Route, label: "Bill", Icon: Calculator, hint: "What's my bill?" },
  { href: "/solar" as Route, label: "Solar", Icon: Sun, hint: "Worth-it estimate" },
  { href: "/battery" as Route, label: "Battery", Icon: BatteryCharging, hint: "Backup sizing" },
  { href: "/disaster" as Route, label: "Disaster", Icon: LifeBuoy, hint: "Storm mode" },
];

export function TopNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="pointer-events-auto absolute inset-x-0 top-0 z-30">
      <div className="mx-3 mt-3 flex items-center gap-2 rounded-2xl glass-strong px-3 py-2">
        {/* Brand */}
        <Link
          href={"/" as Route}
          className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-surface-2"
          aria-label="IslaGrid AI home"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand">
            <Zap className="size-4" aria-hidden />
          </span>
          <span className="hidden sm:flex flex-col leading-tight">
            <span className="text-[15px] font-semibold tracking-tight text-text">
              IslaGrid
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-text-3">
              Puerto Rico
            </span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="ml-3 hidden lg:flex items-center gap-1" aria-label="Primary">
          {LINKS.map(({ href, label, Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-text-2 hover:bg-surface-2 hover:text-text",
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Mobile menu trigger */}
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="ml-auto grid size-9 lg:hidden place-items-center rounded-lg border border-line bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>

        <div className="ml-auto hidden lg:flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div
          id="mobile-nav"
          className="mx-3 mt-2 rounded-2xl glass-strong p-2 slide-in-left lg:hidden"
        >
          <nav className="flex flex-col gap-1" aria-label="Primary (mobile)">
            {LINKS.map(({ href, label, Icon, hint }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                    active
                      ? "bg-brand-soft text-brand"
                      : "text-text hover:bg-surface-2",
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden />
                  <span className="flex flex-col leading-tight">
                    <span className="text-sm font-medium">{label}</span>
                    {hint ? (
                      <span className="text-[11px] text-text-3">{hint}</span>
                    ) : null}
                  </span>
                </Link>
              );
            })}
            <div className="mt-1 flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2">
              <span className="text-xs text-text-2">Theme</span>
              <ThemeToggle />
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
