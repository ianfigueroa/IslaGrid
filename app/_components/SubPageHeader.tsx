"use client";

import Link from "next/link";
import type { Route } from "next";
import { motion } from "framer-motion";
import { ArrowLeft, Zap } from "lucide-react";

interface Props {
  /** Page title in the header (e.g. "Bill estimator"). */
  title?: string;
  /** Optional tagline rendered next to the brand on wide screens. */
  hint?: string;
}

/**
 * Shared header for all non-map pages. Provides a prominent back-to-map
 * link, the brand mark, and the page title. Used by /bill, /solar,
 * /battery, /disaster, /attribution, /docs/api.
 */
export function SubPageHeader({ title, hint }: Props) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
          <Link
            href={"/" as Route}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-surface px-3.5 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            <ArrowLeft className="size-4" aria-hidden />
            <span>Back to map</span>
          </Link>
        </motion.div>

        <Link
          href={"/" as Route}
          className="ml-1 flex items-center gap-2 rounded-full px-2 py-1 transition-colors hover:bg-surface-2"
          aria-label="IslaGrid home"
        >
          <span className="grid size-7 place-items-center rounded-full bg-brand text-white">
            <Zap className="size-3.5" aria-hidden />
          </span>
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span className="text-[13px] font-semibold tracking-tight">
              IslaGrid
            </span>
            <span className="text-[9px] uppercase tracking-[0.18em] text-text-3">
              Puerto Rico
            </span>
          </span>
        </Link>

        {title ? (
          <>
            <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
            <h1 className="hidden text-[14px] font-semibold text-text sm:block">
              {title}
            </h1>
          </>
        ) : null}

        {hint ? (
          <span className="ml-auto hidden text-[11px] text-text-3 md:inline">
            {hint}
          </span>
        ) : null}
      </div>
    </header>
  );
}
