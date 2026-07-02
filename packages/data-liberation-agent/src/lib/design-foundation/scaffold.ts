//
// Scaffold — deterministic pre-synthesis of the design foundation.
// ================================================================
// Reads SP1's aggregated token files plus the screenshot manifest, applies
// pure rules that don't need judgment, and returns a PartialDesignFoundation
// with empty slots left as `null` for the design-foundations skill to fill.
//
// Inputs (all in outputDir):
//   palette.json       — from SP1's SiteAnalysisAggregator
//   typography.json    — from SP1
//   breakpoints.json   — from SP1
//   screenshots/manifest.json
//   html/*.html        — optional; used for gradient regex scan
//
// Deterministic rules:
//   text.default      = darkest palette entry with urls ≥ URL_FLOOR
//   surface.base      = lightest palette entry with urls ≥ URL_FLOOR
//   typography.base   = body fontSize from SP1 typography
//   breakpoints.*     = BREAKPOINT_TIERS nearest-neighbor mapping
//   gradient.*        = regex-scan same-origin HTML for linear-gradient()
//   inputsDigest      = sha256 of each input file
//   skillTodos        = dotted paths to slots the skill must fill
//
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateOutputDir } from '../screenshot/output-layout.js';
import type {
  PartialDesignFoundation,
  Role,
  Gradient,
} from './schema.js';

const URL_FLOOR_PCT = 0.25; // a color/type must appear on ≥25% of sampled URLs to be considered "high frequency"
const HTML_MAX_BYTES = 200 * 1024; // truncate HTML excerpts for gradient scan
const HTML_MAX_FILES = 5; // sample at most N HTML files
const GRADIENT_SCAN_TIMEOUT_MS = 500;

/**
 * Breakpoint tier boundaries. Single source of truth — consumed by scaffold
 * and exported for tests. Never duplicate these numbers in prose or tests.
 */
export const BREAKPOINT_TIERS: ReadonlyArray<readonly [number, 'sm' | 'md' | 'lg' | 'xl']> = [
  [480, 'sm'],
  [768, 'md'],
  [1024, 'lg'],
  [1280, 'xl'],
] as const;

export interface ScaffoldOpts {
  /** Site origin URL (e.g. "https://example.com"); required for schema `origin` field. */
  origin: string;
  /** Override URL_FLOOR_PCT for tests; not exposed publicly. */
  urlFloorPct?: number;
}

interface PaletteFile {
  version: 1;
  sampledUrls: number;
  colors: Array<{ hex: string; count: number; urls: number }>;
}

interface TypographyFile {
  version: 1;
  sampledUrls: number;
  bySelector: Record<
    string,
    Array<{ fontFamily: string; fontSize: string; fontWeight: string; lineHeight: string; urls: number }>
  >;
}

interface BreakpointsFile {
  version: 1;
  sampledUrls: number;
  minWidth: number[];
  maxWidth: number[];
}

interface ManifestFile {
  version: 1;
  entries: Record<string, unknown>;
}

interface CssVariablesFile {
  version: 1;
  sampledUrls: number;
  variables: Array<{ name: string; value: string; isColor: boolean; urls: number }>;
}

/**
 * Named `:root` design tokens map to color roles by name. Ordered by priority —
 * a token is matched to the FIRST role it fits, so a name carrying two keywords
 * (e.g. `--body-bg`) lands in one role only. A matched color-valued token
 * OVERRIDES the pixel-derived role; unmatched roles keep their pixel value.
 */
const CSS_VAR_ROLE_MATCHERS: ReadonlyArray<readonly [RegExp, 'accent' | 'surface' | 'text', string]> = [
  [/(?:^|[-_])(?:primary|brand|accent|cta)(?:[-_]|$)/i, 'accent', 'accent'],
  [/(?:^|[-_])(?:background|bg|surface|paper)(?:[-_]|$)/i, 'surface', 'default page background'],
  [/(?:^|[-_])(?:text|foreground|fg|ink|body)(?:[-_]|$)/i, 'text', 'body copy'],
] as const;

/**
 * Scaffold a design foundation from SP1 output.
 * Throws on missing / malformed SP1 files; traversal paths in outputDir.
 */
export function scaffoldDesignFoundation(
  outputDir: string,
  opts: ScaffoldOpts,
): PartialDesignFoundation {
  validateOutputDir(outputDir);

  const palettePath = join(outputDir, 'palette.json');
  const typographyPath = join(outputDir, 'typography.json');
  const breakpointsPath = join(outputDir, 'breakpoints.json');
  const manifestPath = join(outputDir, 'screenshots', 'manifest.json');

  for (const p of [palettePath, typographyPath, breakpointsPath, manifestPath]) {
    if (!existsSync(p)) {
      const rel = p.replace(outputDir + '/', '');
      throw new Error(
        `Design foundation scaffold requires ${rel}. Run SP1 first (data-liberation <url> --screenshots).`,
      );
    }
  }

  const paletteRaw = readFileSync(palettePath, 'utf8');
  const typographyRaw = readFileSync(typographyPath, 'utf8');
  const breakpointsRaw = readFileSync(breakpointsPath, 'utf8');
  const manifestRaw = readFileSync(manifestPath, 'utf8');

  let palette: PaletteFile;
  let typography: TypographyFile;
  let breakpoints: BreakpointsFile;
  let _manifest: ManifestFile;
  try {
    palette = JSON.parse(paletteRaw) as PaletteFile;
    typography = JSON.parse(typographyRaw) as TypographyFile;
    breakpoints = JSON.parse(breakpointsRaw) as BreakpointsFile;
    _manifest = JSON.parse(manifestRaw) as ManifestFile;
  } catch (e) {
    throw new Error(`SP1 file malformed JSON: ${(e as Error).message}`);
  }

  const floorPct = opts.urlFloorPct ?? URL_FLOOR_PCT;
  const urlFloor = Math.max(1, Math.ceil((palette.sampledUrls || 1) * floorPct));

  // --- text.default: darkest palette entry above floor -------------------
  const highFreq = palette.colors.filter((c) => c.urls >= urlFloor);
  const darkest = pickExtreme(highFreq, 'dark');
  const lightest = pickExtreme(highFreq, 'light');

  const surface: Record<string, Role | null> = {
    base: lightest ? roleFromColor(lightest, 'default page background', palette.sampledUrls) : null,
    raised: null,
    inverse: null,
  };
  const text: Record<string, Role | null> = {
    default: darkest ? roleFromColor(darkest, 'body copy', palette.sampledUrls) : null,
    muted: null,
    inverse: null,
    subtle: null,
  };
  const accent: Record<string, Role | null> = {
    primary: null,
    primaryAlt: null,
    warning: null,
    warm: null,
    highlight: null,
  };
  const border: Record<string, Role | null> = {
    default: null,
    subtle: null,
  };

  // --- :root design tokens override matched color roles ------------------
  // Named, authored tokens (e.g. --brand-primary) are higher-fidelity and more
  // editable than pixel-sampled dominant colors. Optional input — absent on
  // sites with no :root custom properties, leaving the pixel roles untouched.
  const cssVariablesRaw = readOptional(join(outputDir, 'css-variables.json'));
  applyCssVariableTokens(cssVariablesRaw, { surface, text, accent });

  // --- typography.scale.base ---------------------------------------------
  const bodyTuples = typography.bySelector['body'] ?? [];
  const bodyMost = bodyTuples.slice().sort((a, b) => b.urls - a.urls)[0];
  const typographyBase = bodyMost ? bodyMost.fontSize : '16px';
  const typographySteps = buildTypographyScale(typography);
  const typographyFamilies: Record<string, Role | null> = {
    display: null,
    body: bodyMost
      ? {
          value: bodyMost.fontFamily,
          role: 'body + UI',
          evidence: [`typography.body.fontFamily:${bodyMost.urls}urls`],
        }
      : null,
    mono: null,
  };

  // --- breakpoints -------------------------------------------------------
  const breakpointTiers = assignBreakpointTiers(breakpoints.minWidth);
  const breakpointEvidence = [
    `breakpoints.minWidth: [${breakpoints.minWidth.join(', ')}]`,
  ];

  // --- gradients from HTML -----------------------------------------------
  const gradient = scanGradientsFromHtml(outputDir);

  // --- inputsDigest ------------------------------------------------------
  const inputsDigest = {
    palette: sha256(paletteRaw),
    typography: sha256(typographyRaw),
    breakpoints: sha256(breakpointsRaw),
    manifest: sha256(manifestRaw),
    // Always present so an absent→present token file (or a token-value change)
    // shows up as drift and regenerates the foundation. Empty string when absent.
    cssVariables: sha256(cssVariablesRaw ?? ''),
  };

  // --- skillTodos --------------------------------------------------------
  const skillTodos: string[] = [];
  const addTodo = (path: string, slot: unknown) => {
    if (slot === null) skillTodos.push(path);
  };

  for (const [k, v] of Object.entries(surface)) addTodo(`color.surface.${k}`, v);
  for (const [k, v] of Object.entries(text)) addTodo(`color.text.${k}`, v);
  for (const [k, v] of Object.entries(accent)) addTodo(`color.accent.${k}`, v);
  for (const [k, v] of Object.entries(border)) addTodo(`color.border.${k}`, v);
  for (const [k, v] of Object.entries(typographyFamilies)) addTodo(`typography.families.${k}`, v);

  const result: PartialDesignFoundation = {
    version: 1,
    generatedAt: new Date().toISOString(),
    origin: opts.origin,
    inputsDigest,
    color: { surface, text, accent, border },
    gradient,
    typography: {
      families: typographyFamilies,
      scale: {
        base: typographyBase,
        steps: typographySteps,
        ratio: 1.25,
      },
      weights: [400, 500, 600, 700],
    },
    spacing: {
      base: '4px',
      scale: {
        '0': '0px',
        '0.5': '2px',
        '1': '4px',
        '1.5': '6px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '6': '24px',
        '8': '32px',
        '12': '48px',
        '16': '64px',
        '20': '80px',
      },
      sections: { padY: '80px', padX: '40px', contentMaxWidth: '1200px' },
    },
    breakpoints: { ...breakpointTiers, evidence: breakpointEvidence },
    radius: { sm: '4px', base: '8px', lg: '16px', evidence: [] },
    components: {},
    openQuestions: [],
    skillTodos,
  };

  return result;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * sha256 of a string, prefixed with `sha256:`. Exported so the streaming
 * foundation-drift module can reuse the exact digest convention without
 * duplicating it.
 */
export function sha256(content: string): string {
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}

/** Read a file's contents, or null when it doesn't exist / can't be read. */
function readOptional(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Override pixel-derived color roles with matched, color-valued `:root` tokens.
 * Tokens are ranked by `urls` desc (then name) so the most widely-used token
 * wins a role deterministically, regardless of file order. Mutates the role
 * buckets in place. A null/malformed input is a no-op (pixel roles stand).
 */
function applyCssVariableTokens(
  raw: string | null,
  buckets: { surface: Record<string, Role | null>; text: Record<string, Role | null>; accent: Record<string, Role | null> },
): void {
  if (!raw) return;
  let parsed: CssVariablesFile;
  try {
    parsed = JSON.parse(raw) as CssVariablesFile;
  } catch {
    return;
  }
  if (parsed.version !== 1 || !Array.isArray(parsed.variables)) return;

  const ranked = parsed.variables
    .filter((v) => v && v.isColor && typeof v.value === 'string' && v.value.length > 0)
    .slice()
    .sort((a, b) => (b.urls - a.urls) || a.name.localeCompare(b.name));

  const assigned = new Set<'accent' | 'surface' | 'text'>();

  // Authority gate. OVERRIDING a palette-derived role requires a real cross-page
  // frequency signal: a token must be observed across ≥2 sampled pages to be
  // trusted over the palette's lightness-extreme. When CSS was sampled from a
  // single page (e.g. a Wix site serving its stylesheets cross-origin → only the
  // one same-origin page is readable → sampledUrls:1, every token urls:1), a
  // low-confidence component token (e.g. --wst-button-color-text-secondary) must
  // NOT clobber the palette surface/text. FILLING a role the palette left null is
  // still allowed (better than nothing); only OVERRIDE of a confident pick is gated.
  const trustOverride = (parsed.sampledUrls ?? 0) >= 2;
  if (!trustOverride) {
    if (buckets.surface.base !== null) assigned.add('surface');
    if (buckets.text.default !== null) assigned.add('text');
  }

  for (const v of ranked) {
    for (const [pattern, target, role] of CSS_VAR_ROLE_MATCHERS) {
      if (!pattern.test(v.name)) continue;
      if (assigned.has(target)) break; // role already filled by a higher-urls token
      const entry: Role = { value: v.value, role, evidence: [`css-var ${v.name}: ${v.urls} urls`] };
      if (target === 'accent') buckets.accent.primary = entry;
      else if (target === 'surface') buckets.surface.base = entry;
      else buckets.text.default = entry;
      assigned.add(target);
      break; // one token fills at most one role
    }
  }
}

function pickExtreme(
  entries: Array<{ hex: string; count: number; urls: number }>,
  which: 'dark' | 'light',
): { hex: string; count: number; urls: number } | null {
  const scored = entries
    .map((e) => ({ e, l: hexLightness(e.hex) }))
    .filter(({ l }) => l !== null) as Array<{
      e: { hex: string; count: number; urls: number };
      l: number;
    }>;
  if (scored.length === 0) return null;
  if (which === 'dark') {
    scored.sort((a, b) => a.l - b.l || b.e.urls - a.e.urls);
    const top = scored[0];
    return top.l < 0.5 ? top.e : null;
  }
  scored.sort((a, b) => b.l - a.l || b.e.urls - a.e.urls);
  const top = scored[0];
  return top.l > 0.9 ? top.e : null;
}

function roleFromColor(
  c: { hex: string; count: number; urls: number },
  role: string,
  sampledUrls: number,
): Role {
  return {
    value: c.hex,
    role,
    evidence: [`palette[${c.hex}]: ${c.urls}/${sampledUrls} urls, ${c.count} occurrences`],
  };
}

/** Convert #rrggbb or rgb(...) to lightness 0..1. Returns null if unparseable. */
function hexLightness(hex: string): number | null {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) {
    const rgb = hex.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!rgb) return null;
    return rgbLightness(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  }
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return rgbLightness(r, g, b);
}

function rgbLightness(r: number, g: number, b: number): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}

function buildTypographyScale(t: TypographyFile): Record<string, string> {
  const sizes = new Set<number>();
  for (const entries of Object.values(t.bySelector)) {
    for (const e of entries) {
      const n = parseInt(e.fontSize, 10);
      if (!Number.isNaN(n)) sizes.add(n);
    }
  }
  const sorted = Array.from(sizes).sort((a, b) => a - b);
  const names = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'];
  const result: Record<string, string> = {};
  sorted.slice(0, names.length).forEach((size, i) => {
    result[names[i]] = `${size}px`;
  });
  if (!('base' in result)) result.base = '16px';
  return result;
}

function assignBreakpointTiers(minWidths: number[]): {
  sm?: string;
  md?: string;
  lg?: string;
  xl?: string;
} {
  const assigned: Record<string, string> = {};
  for (const w of minWidths) {
    const tier = nearestTier(w);
    // Take the first width that snaps to a given tier (smallest); ignore duplicates
    if (!assigned[tier]) assigned[tier] = `${w}px`;
  }
  return assigned;
}

function nearestTier(width: number): 'sm' | 'md' | 'lg' | 'xl' {
  let bestTier: 'sm' | 'md' | 'lg' | 'xl' = BREAKPOINT_TIERS[0][1];
  let bestDelta = Math.abs(width - BREAKPOINT_TIERS[0][0]);
  for (const [boundary, name] of BREAKPOINT_TIERS) {
    const delta = Math.abs(width - boundary);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestTier = name;
    }
  }
  return bestTier;
}

// Bounded regex — quantifier caps keep worst-case backtracking linear.
const GRADIENT_RE = /linear-gradient\(\s*[^()]{1,2000}\)/gi;

function scanGradientsFromHtml(outputDir: string): Record<string, Gradient> {
  const htmlDir = join(outputDir, 'html');
  if (!existsSync(htmlDir)) return {};

  const files = readdirSync(htmlDir)
    .filter((f) => f.endsWith('.html'))
    .slice(0, HTML_MAX_FILES);

  const gradientCounts = new Map<string, { count: number; files: Set<string> }>();

  for (const f of files) {
    const fp = join(htmlDir, f);
    try {
      const sz = statSync(fp).size;
      const raw = readFileSync(fp, 'utf8').slice(0, HTML_MAX_BYTES);
      void sz;
      const deadline = Date.now() + GRADIENT_SCAN_TIMEOUT_MS;
      let m: RegExpExecArray | null;
      GRADIENT_RE.lastIndex = 0;
      while ((m = GRADIENT_RE.exec(raw)) !== null) {
        if (Date.now() > deadline) {
          console.error(`[design-foundation] gradient scan timeout on ${f}`);
          break;
        }
        const css = normalizeGradientCss(m[0]);
        const entry = gradientCounts.get(css) ?? { count: 0, files: new Set() };
        entry.count += 1;
        entry.files.add(f);
        gradientCounts.set(css, entry);
      }
    } catch {
      // unreadable html — skip
    }
  }

  const ranked = Array.from(gradientCounts.entries())
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

  const result: Record<string, Gradient> = {};
  ranked.slice(0, 10).forEach(([css, info], i) => {
    const slug = gradientSlug(i, ranked.length);
    result[slug] = {
      css,
      role: 'TODO',
      evidence: [
        `${info.count} occurrences across ${info.files.size} file(s): ${Array.from(info.files).sort().join(', ')}`,
      ],
    };
  });
  return result;
}

function normalizeGradientCss(css: string): string {
  return css.replace(/\s+/g, ' ').trim();
}

function gradientSlug(index: number, total: number): string {
  void total;
  if (index === 0) return 'primary';
  if (index === 1) return 'secondary';
  if (index === 2) return 'tertiary';
  return `extra${index}`;
}
