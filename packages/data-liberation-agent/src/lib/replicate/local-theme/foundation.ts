// src/lib/replicate/local-theme/foundation.ts
//
// Deterministic design foundation for the owned-source path: pure mapping
// from the screenshot pipeline's aggregates (palette/typography/breakpoints
// JSON) to the LOOSE DesignFoundation shape buildThemeScaffold consumes
// (theme-scaffold.ts:157-194). Mirrors scaffoldDesignFoundation's picks
// (design-foundation/scaffold.ts) but fills every slot deterministically —
// no agent curation, no strict zod pipeline. Same aggregates → same
// foundation (CP1 determinism).
//
export interface PaletteAgg {
  version: 1;
  sampledUrls: number;
  colors: Array<{ hex: string; count: number; urls: number }>;
}
export interface TypographyAgg {
  version: 1;
  sampledUrls: number;
  bySelector: Record<string, Array<{ fontFamily: string; fontSize: string; fontWeight: string; lineHeight: string; urls: number }>>;
}
export interface BreakpointsAgg {
  version: 1;
  sampledUrls: number;
  minWidth: number[];
  maxWidth: number[];
}

export interface LocalFoundationResult {
  foundation: Record<string, unknown> & {
    color?: {
      surface?: { base?: { value?: string }; inverse?: { value?: string } };
      text?: { default?: { value?: string }; inverse?: { value?: string } };
      accent?: { primary?: { value?: string } };
    };
    typography?: { families?: { body?: { value?: string }; display?: { value?: string } } };
    breakpoints?: { md?: string; lg?: string; xl?: string };
    components?: { button?: { background?: string; text?: string; radius?: string } };
  };
  footerBgToken: string;
  footerTextToken: string;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

const URL_FLOOR_PCT = 0.5;

export interface CssColorCount {
  hex: string;
  count: number;
}

/** Count hex color literals (#rgb/#rrggbb, normalized to 6-digit lowercase) in CSS text, ordered desc by occurrences. */
export function extractCssColors(cssSources: string[]): CssColorCount[] {
  const counts = new Map<string, number>();
  // 6-digit alternative first so #aabbcc isn't half-eaten as the 3-digit form;
  // the trailing \b rejects 4/8-digit (alpha) hexes and longer idents. Raw
  // matches — comments are NOT stripped: deterministic, and a stray commented
  // literal only inflates a candidate count, never invents a color.
  const re = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
  for (const src of cssSources) {
    for (const m of src.matchAll(re)) {
      const raw = m[1].toLowerCase();
      const hex = raw.length === 3 ? `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}` : `#${raw}`;
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  // Stable sort: count desc; ties keep first-seen order (Map preserves insertion).
  return [...counts.entries()].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count);
}

export function buildLocalFoundation(
  aggs: {
    palette: PaletteAgg;
    typography: TypographyAgg;
    breakpoints: BreakpointsAgg;
  },
  opts?: { cssColors?: CssColorCount[] },
): LocalFoundationResult {
  const { palette, typography, breakpoints } = aggs;
  const floor = Math.max(1, Math.ceil((palette.sampledUrls || 1) * URL_FLOOR_PCT));
  const usable = palette.colors
    .map((c) => ({ ...c, hsl: hexToHsl(c.hex) }))
    .filter((c) => c.urls >= floor && c.hsl !== null) as Array<{ hex: string; count: number; urls: number; hsl: { h: number; s: number; l: number } }>;

  const byLightness = [...usable].sort((a, b) => a.hsl.l - b.hsl.l);
  const darkest = byLightness[0]?.hex ?? '#111111';
  const lightest = byLightness[byLightness.length - 1]?.hex ?? '#ffffff';

  // The dominant (highest-count) color approximates the page background. The
  // palette aggregator counts ELEMENT background-colors — text colors are
  // never sampled — and the body/page background is the most-counted element
  // bg. When it is dark, the site is dark-themed: surface gets the dark pole
  // and text the light pole (otherwise the theme silently inverts dark sites,
  // bg→text). A median over the top colors is deliberately NOT used: light
  // card/section backgrounds can jointly out-count the page background by
  // element count and pull the median light (e.g. the dark fixture in
  // foundation.test.ts). Empty `usable` → dominant undefined → light default
  // (0.5 ≥ 0.4).
  const byCount = [...usable].sort((a, b) => b.count - a.count);
  const isDark = (byCount[0]?.hsl.l ?? 0.5) < 0.4;
  const surfaceColor = isDark ? darkest : lightest;
  const textColor = isDark ? lightest : darkest;

  // Accent gate: saturated, mid-lightness, not one of the chosen poles.
  const accentGate = (c: { hex: string; hsl: { h: number; s: number; l: number } }): boolean =>
    c.hsl.s >= 0.35 &&
    c.hsl.l >= 0.25 &&
    c.hsl.l <= 0.7 &&
    c.hex.toLowerCase() !== darkest.toLowerCase() &&
    c.hex.toLowerCase() !== lightest.toLowerCase();

  // CSS-literal candidates supplement the ACCENT pick only: the screenshot
  // aggregator samples CONTAINER backgrounds (body/header/main/footer/section/
  // div), so an accent living purely on small elements (a.button) never
  // reaches palette.json — but on the owned-source path the designer's palette
  // is literal in styles.css. Literals bypass the urls floor (authored, not
  // sampled noise) yet rank AFTER every aggregate candidate: a sampled color
  // was actually rendered, a literal might be dead code. Surface/text poles,
  // breakpoints, and families stay aggregate-only — containers capture those.
  const cssCandidates = (opts?.cssColors ?? [])
    .map((c) => ({ hex: c.hex, count: c.count, hsl: hexToHsl(c.hex) }))
    .filter((c): c is { hex: string; count: number; hsl: { h: number; s: number; l: number } } => c.hsl !== null);

  // Fallback `?? textColor` keeps the accent CONTRASTING the surface on both
  // orientations: light sites textColor === darkest (same pick as before);
  // dark monochrome sites would otherwise get accent === page bg — and the
  // button (bg=accent, text=surface pole) would render invisible.
  const accent =
    [
      ...usable.filter(accentGate).sort((a, b) => b.count - a.count),
      ...cssCandidates.filter(accentGate).sort((a, b) => b.count - a.count),
    ][0]?.hex ?? textColor;

  const topFamily = (selector: string): string | undefined =>
    typography.bySelector[selector]?.slice().sort((a, b) => b.urls - a.urls)[0]?.fontFamily;
  const bodyFamily = topFamily('body') ?? 'system-ui, sans-serif';
  const displayFamily = topFamily('h1') ?? topFamily('h2') ?? bodyFamily;

  const widths = [...new Set([...breakpoints.minWidth, ...breakpoints.maxWidth])].sort((a, b) => a - b);
  const pick = (max: number, dflt: number): string => `${widths.filter((w) => w <= max).pop() ?? dflt}px`;
  const md = pick(768, 768);
  const lg = pick(1024, 1024);
  const xl = `${widths.filter((w) => w > 1024).pop() ?? 1280}px`;

  return {
    foundation: {
      color: {
        // surface.inverse is the footer band — it CONTRASTS the page, so it
        // takes the text pole; text.inverse takes the surface pole.
        surface: { base: { value: surfaceColor }, inverse: { value: textColor } },
        text: { default: { value: textColor }, inverse: { value: surfaceColor } },
        accent: { primary: { value: accent } },
      },
      typography: { families: { body: { value: bodyFamily }, display: { value: displayFamily } } },
      breakpoints: { md, lg, xl },
      components: { button: { background: accent, text: surfaceColor, radius: '999px' } },
    },
    footerBgToken: 'surface-inverse',
    footerTextToken: 'text-inverse',
  };
}
