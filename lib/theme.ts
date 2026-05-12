"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "islagrid-theme";
const STORAGE_AUTO_KEY = "islagrid-theme-auto";
const EVENT = "islagrid:theme";

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" ? "light" : "dark";
}

/**
 * Decide an automatic theme from local time + active hurricane signal.
 * - Night hours (22:00–06:00 PR-local): dark
 * - Active hurricane advisory ANY time of day: dark (reduces glare during
 *   long-watch sessions; matches the "crisis dashboard" UX literature).
 * - Otherwise: respect the system's prefers-color-scheme.
 */
export function suggestAutoTheme(opts: { hurricaneActive: boolean }): Theme {
  if (opts.hurricaneActive) return "dark";
  if (typeof window === "undefined") return "dark";
  // Puerto Rico is UTC-4 year-round (no DST). The user's clock may not be
  // in PR — we use their local time as a reasonable proxy since the goal is
  // "is it dark wherever they are reading this".
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 6) return "dark";
  const prefersDark =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

export function isAutoTheme(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(STORAGE_AUTO_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAutoTheme(auto: boolean): void {
  try {
    localStorage.setItem(STORAGE_AUTO_KEY, auto ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function useTheme() {
  // Start with "dark" on the server to match the SSR baseline; resync on mount.
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    setThemeState(readTheme());
    const handler = (e: Event) => {
      const next = (e as CustomEvent<Theme>).detail;
      setThemeState(next === "light" ? "light" : "dark");
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode etc. */
    }
    setThemeState(next);
    window.dispatchEvent(new CustomEvent<Theme>(EVENT, { detail: next }));
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}
