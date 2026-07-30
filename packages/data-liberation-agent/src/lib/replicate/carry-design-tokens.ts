//
// Carry-path design tokens
// ========================
// The carry theme is built around verbatim CSS islands, so its theme.json carries
// no color/font tokens. But product-marketing reconstruction (and any core-block
// reconstruction in the carry path) maps captured section colors/fonts to theme
// TOKEN SLUGS — which only resolve if theme.json defines them. This module is the
// single source for those tokens: it reads the captured design aggregates
// (`palette.json`, `typography.json`) and produces BOTH the reconstructor token
// arrays (for `reconstructPagePattern`) AND the theme.json palette/fontFamilies
// entries — with the SAME slugs, so the markup's token references always resolve.
//
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PaletteToken } from './footer-color.js';
import type { FontFamilyToken } from '@automattic/blocks-engine/theme';

export interface CarryDesignTokens {
  /** {slug, hex} for reconstructPagePattern color mapping. */
  paletteTokens: PaletteToken[];
  /** {slug, family} for reconstructPagePattern font mapping. */
  fontFamilies: FontFamilyToken[];
  /** theme.json `settings.color.palette` entries (same slugs as paletteTokens). */
  themeJsonPalette: Array<{ slug: string; name: string; color: string }>;
  /** theme.json `settings.typography.fontFamilies` entries (same slugs as fontFamilies). */
  themeJsonFontFamilies: Array<{ slug: string; name: string; fontFamily: string }>;
}

function readJsonSafe(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** First family token, lowercased + kebab-cased, for a stable slug ("Larsseit, sans-serif" → "larsseit"). */
function familySlug(fontFamily: string): string {
  const first = (fontFamily.split(',')[0] || '').trim().replace(/["']/g, '');
  return first.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font';
}

/** Human label for a family ("Larsseit, sans-serif" → "Larsseit"). */
function familyName(fontFamily: string): string {
  return (fontFamily.split(',')[0] || '').trim().replace(/["']/g, '') || fontFamily;
}

/**
 * Load the carry design tokens for a run. Reads `<outputDir>/palette.json` (colors
 * ranked by usage) and `<outputDir>/typography.json` (font-family per selector).
 * Both absent → empty arrays (the reconstruction then uses theme defaults).
 *
 * @param maxColors cap on palette tokens (top-ranked colors); default 8.
 */
export function loadCarryDesignTokens(outputDir: string, maxColors = 8): CarryDesignTokens {
  const palette = readJsonSafe(join(outputDir, 'palette.json'));
  const colors: Array<{ hex?: string }> = Array.isArray(palette?.colors) ? palette.colors : [];
  const paletteTokens: PaletteToken[] = [];
  const themeJsonPalette: Array<{ slug: string; name: string; color: string }> = [];
  for (const c of colors) {
    // Only valid CSS hex lengths (3/4/6/8) — `{3,8}` would admit junk 5/7-char strings
    // that become a dead theme.json color token.
    if (!c?.hex || !/^#?(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c.hex)) continue;
    const slug = `c${paletteTokens.length + 1}`;
    const hex = c.hex.startsWith('#') ? c.hex : `#${c.hex}`;
    paletteTokens.push({ slug, hex });
    themeJsonPalette.push({ slug, name: `Replica ${paletteTokens.length}`, color: hex });
    if (paletteTokens.length >= maxColors) break;
  }

  const typo = readJsonSafe(join(outputDir, 'typography.json'));
  const bySelector: Record<string, Array<{ fontFamily?: string }>> = typo?.bySelector ?? {};
  const seen = new Set<string>();
  const fontFamilies: FontFamilyToken[] = [];
  const themeJsonFontFamilies: Array<{ slug: string; name: string; fontFamily: string }> = [];
  for (const entries of Object.values(bySelector)) {
    for (const e of entries ?? []) {
      const ff = (e?.fontFamily || '').trim();
      if (!ff) continue;
      const slug = familySlug(ff);
      if (seen.has(slug)) continue;
      seen.add(slug);
      fontFamilies.push({ slug, family: ff });
      themeJsonFontFamilies.push({ slug, name: familyName(ff), fontFamily: ff });
    }
  }

  return { paletteTokens, fontFamilies, themeJsonPalette, themeJsonFontFamilies };
}
