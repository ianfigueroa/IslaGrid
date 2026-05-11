# IslaGrid AI — Design System (MASTER)

> **LOGIC:** When building a page, first check `design-system/islagrid-ai/pages/[page-name].md`.
> If that file exists, its rules **override** this Master. Otherwise, follow the rules below strictly.

**Project:** IslaGrid AI
**Last updated:** 2026-05-11
**Category:** Public grid-intelligence control room (map-first)

---

## Page pattern (overrides the auto-recommendation)

**Pattern:** Map-First Control Room. Full-viewport map with floating chrome overlays — no page scroll, no hero, no marketing structure. The map is the application.

```
+----------------------------------------------------------------+
| Top status bar  [logo] [grid status] [demand] [gen] [reserves] |
+--+----------------------------------------------------------+--+
|  |                                                          |  |
| L|                                                          | I|
| A|                                                          | N|
| Y|                                                          | T|
| E|                  Full-screen MapLibre map                | E|
| R|                                                          | L|
|  |                                                          |  |
| R|                                                          | P|
| A|                                                          | A|
| I|                                                          | N|
| L|                                                          | E|
|  |                                                          | L|
+--+----------------------------------------------------------+--+
| Bottom collapsible update timeline (handle visible by default) |
+----------------------------------------------------------------+
```

- **Top status bar:** 56 px tall, sticky, semi-transparent over the map (`bg-bg/85 backdrop-blur`).
- **Left layer rail:** 56 px wide (icon-only on mobile, 200 px expanded on hover/desktop). Pinned left.
- **Right intelligence panel:** slides in from the right (380 px desktop, full-width mobile) when a feature is selected. Hidden by default.
- **Bottom update timeline:** 44 px handle visible by default; expands to 240 px on click. Map remains primary.

The user never leaves this view in MVP. Routes like `/about`, `/privacy`, `/attribution` exist but are linked from a small footer popover inside the layer rail.

---

## Color palette

Electric-cyan grid telemetry, amber for warnings, red **only** for CRITICAL. No purple AI gradients anywhere.

| Role | Hex | Tailwind | Use |
|---|---|---|---|
| Background | `#020617` | `bg-slate-950` | App background, behind map |
| Surface | `#0B1220` | custom `bg-surface` | Status bar, panels |
| Surface elevated | `#111A2E` | custom `bg-surface-2` | Card / hover state |
| Border | `#1E2A3D` | custom `border-line` | Hairlines, dividers |
| Text primary | `#F8FAFC` | `text-slate-50` | Numbers, headings |
| Text secondary | `#94A3B8` | `text-slate-400` | Labels, helper text |
| Text muted | `#64748B` | `text-slate-500` | Source labels, timestamps |
| **Grid cyan (primary)** | `#22D3EE` | `text-cyan-400` | Demand, generation, reserves numbers; NORMAL status |
| **Warning amber** | `#F59E0B` | `text-amber-500` | WATCH / STRAINED status, stale-data chip |
| **Critical red** | `#EF4444` | `text-red-500` | CRITICAL status only — used sparingly |
| Solar teal | `#2DD4BF` | `text-teal-400` | Reserved for solar phases |
| Community lilac | `#A5B4FC` | `text-indigo-300` | Community-sourced data points (NOT purple gradients) |
| Focus ring | `#22D3EE` at 40% alpha | `ring-cyan-400/40` | Keyboard focus |

**Status color encoding (load-bearing rule):**

| Status | Background | Foreground | Icon |
|---|---|---|---|
| NORMAL | `bg-cyan-400/10` | `text-cyan-400` | filled circle |
| WATCH | `bg-amber-500/10` | `text-amber-500` | half-filled circle |
| STRAINED | `bg-amber-500/20` | `text-amber-500` | triangle |
| CRITICAL | `bg-red-500/15` | `text-red-500` | square (intentionally jarring) |
| STALE | `bg-slate-500/15` | `text-slate-400` | dashed circle |

---

## Typography

Two fonts, both loaded via `next/font/google`:

- **Fira Sans** — UI labels, body, panel content. Weights 400 / 500 / 600.
- **Fira Code** — all numeric telemetry (MW, %, timestamps, coordinates). Weights 400 / 500.

```ts
import { Fira_Sans, Fira_Code } from "next/font/google";

export const firaSans = Fira_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

export const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});
```

**Type scale:**

| Token | Size / Line | Use |
|---|---|---|
| `text-xs` | 12 / 16 | Source labels, freshness chips |
| `text-sm` | 14 / 20 | Body, panel content |
| `text-base` | 16 / 24 | Default — paragraphs, descriptions |
| `text-lg` | 18 / 28 | Card titles |
| `text-2xl` | 24 / 32 | Status-bar numbers (mono) |
| `text-4xl` | 36 / 40 | Detail-panel hero number (mono) |

**Rules:**
- Every number is `font-mono`. Every label is `font-sans`.
- Tabular figures everywhere a number can change: `font-feature-settings: 'tnum'`.
- Minimum body size on mobile: 16 px.
- Line length capped at 65 ch in any text-heavy panel.

---

## Spacing, radius, shadow

| Token | Value |
|---|---|
| `--space-1` … `--space-12` | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 px |
| `--radius-sm` | 6 px (chips) |
| `--radius-md` | 10 px (cards) |
| `--radius-lg` | 14 px (panels) |

Shadows are subtle. We are over a dark map; we use **inner glow + 1 px border**, not drop shadows.

```css
.surface {
  background: #0B1220;
  border: 1px solid #1E2A3D;
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.04) inset;
}
```

No multi-layer drop shadows. No bloom. No outer glow on default state.

---

## Component specs

### Status pill (top-bar grid state)

```tsx
<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-400/10 text-cyan-400 text-xs font-medium uppercase tracking-wider">
  <span className="size-2 rounded-full bg-cyan-400" />
  Normal
</div>
```

Pulse animation **only** on CRITICAL, only at 1 Hz, only if `prefers-reduced-motion: no-preference`.

### Telemetry card

```tsx
<div className="flex flex-col gap-1 px-4 py-3">
  <span className="text-xs uppercase tracking-wider text-slate-400">Current demand</span>
  <span className="font-mono text-2xl tabular-nums text-cyan-400">2,418<span className="text-slate-400 text-base ml-1">MW</span></span>
  <FreshnessChip asOf={ts} source="datos.pr.gov" />
</div>
```

### Freshness chip (load-bearing — every number gets one)

```tsx
<span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500">
  <span className="size-1.5 rounded-full bg-cyan-400/60" />
  Updated 4m ago · Official · datos.pr.gov
</span>
```

When stale (> SLO):
```tsx
<span className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-500">
  <span className="size-1.5 rounded-full bg-amber-500/60 [animation:pulse_2s_ease-in-out_infinite] motion-reduce:animate-none" />
  Stale · last seen 32m ago
</span>
```

### Intelligence panel

- Slides in from the right.
- `transform: translateX(100%) → 0`, 220 ms `ease-out`. Reverse on close.
- Esc key closes; click-outside on map closes; focus returns to triggering element.
- Has a sticky header (entity name + close button), scrollable body.
- Mobile: full-screen sheet, slides up from bottom instead of right.

### Layer rail

- Icon set: **Lucide** (no emojis, ever).
- Each item: 40 × 40 px tap target (a11y), label visible on hover/focus.
- Active layer: cyan left-edge bar (2 px) + cyan icon. Inactive: slate-400 icon.

---

## Animation rules (strict — anti-slop)

Allowed:
- Opacity fades on data refresh: `200 ms ease-out`.
- Slide-in for the intelligence panel: `220 ms ease-out`.
- Status-pill pulse **only on CRITICAL** at 1 Hz.
- Map zoom/pan: MapLibre defaults (already physics-based).
- Skeletons during initial load (no spinners).

Forbidden:
- ❌ Parallax of any kind.
- ❌ Scroll-jacking. The page does not scroll.
- ❌ Glow flooding (large `box-shadow` blurs > 8 px on hover).
- ❌ Scale-up hover on cards (causes layout shift; jitters next to live data).
- ❌ Confetti, particle effects, animated gradients.
- ❌ Bouncing icons, rotating logos, "AI shimmer."
- ❌ Animations on more than 2 elements per viewport at once.

All animations must respect `prefers-reduced-motion: reduce`. Globally:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## Map style

- Basemap: **CARTO dark-matter** raster tiles (`https://basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}.png`) with the CARTO + OSM attribution shown bottom-right.
- Saturation: drop to ~70% on the basemap so cyan/amber overlays pop.
- Default zoom: 9, centered on `[-66.5, 18.2]` (PR centroid).
- Municipality outline: `#1E2A3D` line, 0.5 px. On hover: `#22D3EE` at 50% alpha.
- Plant markers: circle, radius scaled by MW (sqrt scale, 4–14 px). Fill by fuel. Stroke: `#0B1220` 1 px so they read against the dark map.
- Power line layer: 0.5 px line, color by voltage class.
- Risk hexagons (future): cyan-amber-red interpolation, max 60% opacity so the basemap stays legible.

---

## Chart rules (when needed)

| Data | Chart | Library |
|---|---|---|
| Demand vs time (last 24 h) | Line chart, 1 px stroke, cyan, with subtle area fill at 8% opacity | Recharts |
| Reserve margin vs target | Bullet chart (horizontal bar + target marker) | custom SVG (small) |
| Outage reports last 6 h | Sparkline in the intelligence panel | Recharts |

No 3D charts. No pie charts (use waffle if a part-of-whole is needed). Tooltips use the same `bg-surface-2 border-line` panel style.

---

## Accessibility (non-negotiable)

- Color contrast: 4.5:1 minimum for body text, 3:1 for large text. Cyan-400 on slate-950 passes; amber-500 on slate-950 passes; red-500 on slate-950 passes (verified WCAG AA).
- Focus rings: visible on every interactive element. Cyan-400 at 40% alpha, 2 px, 2 px offset.
- Keyboard: layer rail navigable with arrow keys, panel closable with Esc, status bar tabbable.
- Skip link: hidden until focused, jumps to map main region.
- `aria-label` on every icon-only button.
- Map has an accessible name and a textual fallback ("Status: NORMAL. Current demand 2418 MW.") visible to screen readers.
- Never communicate state by color alone — always pair with icon shape (circle/triangle/square) and text.

---

## Anti-patterns (do NOT use)

- ❌ Purple/violet/indigo gradients (the "AI dashboard" look)
- ❌ Glassmorphism with > 16 px blur (kills GPU on mobile, looks like every SaaS)
- ❌ Drop shadows over the map (use border + inner glow)
- ❌ Marketing-page elements: hero, testimonials, social proof, "trusted by"
- ❌ Emojis anywhere in the UI
- ❌ Animated illustrations
- ❌ Toast notifications that animate from the corner with bounce
- ❌ Card scale-up hover
- ❌ Pulse/glow on idle elements (only CRITICAL status pulses)
- ❌ "Live" or "AI" badges that don't carry data
- ❌ Numbers without a `FreshnessChip`

---

## Pre-delivery checklist (every component)

- [ ] Every number is `font-mono` and has a `FreshnessChip`
- [ ] Every interactive element has visible focus + cursor pointer + 44 × 44 tap area
- [ ] No emojis as icons (Lucide only)
- [ ] `prefers-reduced-motion` respected
- [ ] Contrast ≥ 4.5:1 verified for body text
- [ ] State communicated by icon shape, not color alone
- [ ] No layout shift on hover
- [ ] Tested at 375, 768, 1024, 1440 px widths
- [ ] No horizontal scroll on mobile
- [ ] No animation on more than 2 elements per viewport
- [ ] Source labels visible on every public data point

---

## What this design is NOT

- Not a SaaS landing page
- Not a fintech dashboard
- Not a "neural net visualization"
- Not a Bloomberg terminal pastiche (we're public, not pro)
- Not a NASA mission-control cosplay (no oversized HUDs)

It is a calm, legible, evidence-first public utility — designed so a resident in San Juan during a brownout can read it on a 5-year-old phone with one bar of signal.
