//
// DLA-local theme font family helpers
// ===================================
// The deterministic capture helpers now live in @automattic/blocks-engine/theme.
// This module keeps only the DLA-local theme.json family builder plus
// baseFamilyName, which is not exposed by the engine public barrel.
//

import type { LocalFontFace, ThemeFontFamily } from '@automattic/blocks-engine/theme';

/**
 * Group captured local font-faces by family into `theme.json`
 * `settings.typography.fontFamilies[]` entries with `fontFace[]`.
 *
 * `fallback` is appended to each `fontFamily` stack (e.g. ", sans-serif").
 * `assetUriExpr` is the runtime prefix for the local font path — for theme.json
 * the convention is `file:./assets/fonts/...` which WordPress resolves to the
 * theme directory.
 */
/** Common serif typeface-name fragments — used to pick a `serif` vs `sans-serif`
 *  generic fallback for a captured family so a serif heading degrades to a serif,
 *  not a sans, when its exact weight isn't loaded. Site-agnostic name heuristic. */
const SERIF_NAME_HINTS =
  /baskerville|garamond|georgia|\btimes\b|playfair|merriweather|\blora\b|didot|bodoni|caslon|minion|freight|tiempos|canela|recoleta|crimson|cormorant|spectral|frank ruhl|\bserif\b|\broman\b|\bslab\b|rockwell|glypha|\bdjr\b|noto serif|pt serif|dm serif|source serif|plex serif/i;
function genericFallbackForFamily(family: string): string {
  return SERIF_NAME_HINTS.test(family) ? 'serif' : 'sans-serif';
}

export function buildThemeFontFamilies(
  faces: LocalFontFace[],
  opts: { fallback?: string } = {},
): ThemeFontFamily[] {
  const byFamily = new Map<string, LocalFontFace[]>();
  for (const f of faces) {
    const arr = byFamily.get(f.family) ?? [];
    arr.push(f);
    byFamily.set(f.family, arr);
  }

  const out: ThemeFontFamily[] = [];
  for (const [family, group] of byFamily) {
    // Generic fallback must match the typeface CLASS, or a serif heading whose
    // exact weight isn't loaded falls back to a sans (the "serif headline renders
    // as bold Arial" bug). Detect serif by name and emit `serif`, else `sans-serif`.
    // An explicit opts.fallback still wins (callers that know the class).
    const fallback = opts.fallback ?? genericFallbackForFamily(family);
    out.push({
      fontFamily: `${family}, ${fallback}`,
      name: family,
      slug: slugifyFamily(family),
      fontFace: group.map((f) => ({
        fontFamily: family,
        fontWeight: f.weight,
        fontStyle: f.style,
        // theme.json font-face src is resolved relative to the theme root.
        src: [`file:./${f.localPath.replace(/^\/+/, '')}`],
      })),
    });
  }
  return out;
}

function slugifyFamily(family: string): string {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Strip weight/style words from a font-family name to get its BASE family.
 *
 * Foundries (and Shopify) frequently declare each weight as its own
 * `@font-face` family name — "Larsseit", "Larsseit Bold", "Larsseit-Bold" all
 * refer to one typeface. Consolidating them into a single family with multiple
 * weighted faces is what a real theme wants (so `font-weight:700` resolves to
 * the bold woff instead of a synthetic bold of the regular).
 */
export function baseFamilyName(family: string): string {
  return family
    .replace(/[-_\s]+(thin|extralight|ultralight|light|regular|book|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique)$/i, '')
    .replace(/[-_\s]+(thin|extralight|ultralight|light|regular|book|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique)\b/gi, '')
    .replace(/[-_\s]+$/g, '')
    .trim() || family;
}
