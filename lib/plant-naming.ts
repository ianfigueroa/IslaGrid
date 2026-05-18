/**
 * Normalize a power-plant name for cross-source matching.
 *
 * Genera PR labels their gauges in Spanish with descriptors that vary by
 * page ("Central San Juan", "Planta San Juan", "San Juan TM"). Our curated
 * list at `lib/plants.ts` uses canonical English names ("San Juan Power
 * Plant"). This normalizer collapses both shapes onto the same key so we
 * can map gauge readings → curated nameplate metadata.
 *
 * Strategy: lowercase, strip parenthetical qualifiers, strip Spanish/English
 * power-plant suffixes that mean nothing for identification, collapse
 * whitespace.
 */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(power\s+plant|planta|central|cc|gt|thermal)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
