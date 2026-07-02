/**
 * src/lib/preview/brand-color.ts
 * ================================
 * Generic helpers for picking a brand-dark color from a site palette and
 * computing WCAG-compliant contrast text color.
 *
 * Source-agnostic — no Wix or platform-specific logic here.
 */

export interface PaletteColor {
  hex: string;
  count: number;
}

// ── Relative luminance (WCAG 2.1) ───────────────────────────────────────────

/**
 * Convert a 0-255 channel value to its linear-light contribution.
 */
function linearize(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Compute relative luminance (0=black, 1=white) for a #rrggbb hex color.
 * Returns null for unparseable input.
 */
export function relativeLuminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const r = linearize(parseInt(m[1], 16));
  const g = linearize(parseInt(m[2], 16));
  const b = linearize(parseInt(m[3], 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Return true when the hex color is near-white (luminance > 0.85).
 */
function isNearWhite(hex: string): boolean {
  const lum = relativeLuminance(hex);
  return lum !== null && lum > 0.85;
}

/**
 * Return true when the color is near-gray (low saturation).
 * Threshold: max(r,g,b) - min(r,g,b) < 16/255 (~6%).
 */
function isNearGray(hex: string): boolean {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return true; // treat unparseable as gray
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return Math.max(r, g, b) - Math.min(r, g, b) < 16;
}

/**
 * Pick the site's brand-dark color from a palette array.
 *
 * Algorithm:
 *   1. Exclude near-white (luminance > 0.85) and near-gray (saturation < ~6%).
 *   2. From the remaining chromatic colors, pick the one with the highest count.
 *   3. Fallback: if no chromatic color qualifies, pick the darkest non-near-white
 *      color in the full palette (including grays/blacks).
 *   4. If the palette is empty or all entries are near-white, return null.
 *
 * @param colors - Palette entries, each `{ hex: "#rrggbb", count: number }`.
 *                 Need not be pre-sorted.
 * @returns A `#rrggbb` hex string, or null.
 */
export function pickBrandDark(colors: PaletteColor[]): string | null {
  if (colors.length === 0) return null;

  // Step 1: filter to chromatic (non-white, non-gray) candidates.
  const chromatic = colors.filter((c) => !isNearWhite(c.hex) && !isNearGray(c.hex));

  // Step 2: highest count among chromatic candidates.
  if (chromatic.length > 0) {
    return chromatic.reduce((best, c) => (c.count > best.count ? c : best)).hex;
  }

  // Step 3: fallback — darkest non-near-white color (grays / pure black are ok here).
  const nonWhite = colors.filter((c) => !isNearWhite(c.hex));
  if (nonWhite.length === 0) return null;

  // "Darkest" = lowest luminance.
  return nonWhite.reduce((best, c) => {
    const lumC = relativeLuminance(c.hex) ?? 1;
    const lumB = relativeLuminance(best.hex) ?? 1;
    return lumC < lumB ? c : best;
  }).hex;
}

// ── Contrast text color ──────────────────────────────────────────────────────

/**
 * Given a background hex color, return '#ffffff' (white) when the background
 * is dark (relative luminance < 0.5), or '#111111' (near-black) when light.
 *
 * This follows the simplified WCAG contrast algorithm: white on dark /
 * dark on light.  Returns '#111111' on unparseable input (safe fallback).
 */
export function contrastTextColor(bgHex: string): '#ffffff' | '#111111' {
  const lum = relativeLuminance(bgHex);
  if (lum === null) return '#111111';
  return lum < 0.5 ? '#ffffff' : '#111111';
}
