// src/lib/replicate/footer-color.ts
//
// Deterministic footer (and any band) color sampling from a captured screenshot.
//
// WHY THIS EXISTS
// Page builders (Wix, Squarespace, …) paint section/footer backgrounds with
// background-IMAGES or layered/positioned divs, so computed `background-color`
// reads transparent — the palette/site-analysis pass (which samples computed
// colors only, never pixels) misses the footer's TRUE color. The design
// foundation then guesses a role label (e.g. "footer = the dark brand green")
// that can be wrong, and the footer renders the wrong color. Reading the actual
// RENDERED pixels of the footer band from the homepage screenshot is the only
// reliable source. We then map that color to the nearest theme palette token
// (the gate forbids inline hex — token slugs only).

import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

export interface PaletteToken {
  slug: string;
  hex: string;
}

/** Parse a CSS color to [r,g,b] — accepts #rgb / #rrggbb and rgb()/rgba(). null otherwise. */
export function parseHex(color: string): [number, number, number] | null {
  const s = color.trim();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/**
 * Dominant opaque color of a horizontal band of a decoded PNG, sampled between
 * `fromFracY` and `toFracY` of the image height. Colors are quantized (5-bit per
 * channel) so anti-aliasing/noise collapses onto the band's true fill. Returns
 * #rrggbb or null when the band is empty/transparent.
 */
export function dominantBandColor(
  png: { width: number; height: number; data: Buffer },
  fromFracY: number,
  toFracY: number,
): string | null {
  const y0 = Math.max(0, Math.floor(png.height * fromFracY));
  const y1 = Math.min(png.height, Math.ceil(png.height * toFracY));
  const counts = new Map<string, number>();
  for (let y = y0; y < y1; y += 2) {
    for (let x = 0; x < png.width; x += 4) {
      const i = (png.width * y + x) * 4;
      if (png.data[i + 3] < 200) continue; // skip transparent
      const r = png.data[i] & 0xf8;
      const g = png.data[i + 1] & 0xf8;
      const b = png.data[i + 2] & 0xf8;
      const key = `${r},${g},${b}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  if (!best) return null;
  const [r, g, b] = best.split(',').map(Number);
  return toHex(r, g, b);
}

/** Sample the footer band's dominant color from a full-page screenshot PNG. */
export function sampleFooterColor(pngPath: string, band: { from: number; to: number } = { from: 0.9, to: 0.995 }): string | null {
  let png: { width: number; height: number; data: Buffer };
  try {
    png = PNG.sync.read(readFileSync(pngPath));
  } catch {
    return null;
  }
  return dominantBandColor(png, band.from, band.to);
}

/** Dominant OPAQUE color of an entire image (e.g. a logo's ink color, ignoring
 *  its transparent field). Used to decide header tone: a light/white logo needs
 *  a dark header to be visible. Returns #rrggbb or null. */
export function sampleImageColor(pngPath: string): string | null {
  let png: { width: number; height: number; data: Buffer };
  try {
    png = PNG.sync.read(readFileSync(pngPath));
  } catch {
    return null;
  }
  return dominantBandColor(png, 0, 1);
}

/** Nearest palette token to a color by squared RGB distance, or null. */
export function nearestToken(hex: string, tokens: PaletteToken[]): string | null {
  const c = parseHex(hex);
  if (!c) return null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const t of tokens) {
    const tc = parseHex(t.hex);
    if (!tc) continue;
    const d = (c[0] - tc[0]) ** 2 + (c[1] - tc[1]) ** 2 + (c[2] - tc[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t.slug;
    }
  }
  return best;
}

/** Perceived brightness (0-255) — drives light-vs-inverse text on the band. */
export function brightness(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 255;
  return Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
}
