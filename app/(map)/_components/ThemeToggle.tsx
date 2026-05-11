"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Render a stable placeholder until mounted to avoid hydration mismatch
  // (server can't know the client's localStorage theme).
  const isDark = mounted ? theme === "dark" : true;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Theme toggle"}
      title={mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : undefined}
      suppressHydrationWarning
      className="grid size-8 cursor-pointer place-items-center rounded-md border border-line bg-surface text-text-2 transition-colors hover:border-line-2 hover:bg-surface-2 hover:text-text"
    >
      {isDark ? (
        <Sun className="size-4" aria-hidden suppressHydrationWarning />
      ) : (
        <Moon className="size-4" aria-hidden suppressHydrationWarning />
      )}
    </button>
  );
}
