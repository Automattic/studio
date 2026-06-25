//
// Deterministic font capture
// ===========================
// Parses `@font-face` rules (and bare font URLs) out of captured source
// markup/CSS so a replica theme can SELF-HOST the source site's real
// typefaces instead of rendering everything in a fallback.
//
// The flow is platform-agnostic:
//
//   1. `parseFontFaces(css)` — scan one or more CSS/HTML strings for
//      `@font-face { font-family: …; src: url(…) … }` blocks and return a
//      normalized list of `ParsedFontFace` descriptors (family, src URL,
//      weight, style).
//   2. A downloader (see `font-capture-download.ts` / the caller) fetches each
//      unique `src` URL into the theme's `assets/fonts/` directory.
//   3. `buildFontFaceCss(faces)` — emit `@font-face` rules pointing at the
//      LOCAL asset paths, suitable for appending to the theme `style.css`.
//   4. `buildThemeFontFamilies(faces, …)` — produce `theme.json`
//      `settings.typography.fontFamilies[]` entries (with `fontFace[]`) for the
//      captured families so the editor + front-end resolve the real family.
//
// Nothing here hardcodes "Larsseit" — the family names, weights, and URLs are
// all read from the source CSS. Larsseit happens to be what getsnooz.com loads
// from the Shopify CDN; another site's fonts flow through the same path.
//

/** One normalized `@font-face` rule extracted from source CSS. */
export interface ParsedFontFace {
  /** Declared font-family name, unquoted (e.g. "Larsseit"). */
  family: string;
  /** Absolute (or protocol-relative) URL of the first usable font file. */
  src: string;
  /** Lowercased file extension without the dot, e.g. "woff" / "woff2" / "ttf". */
  format: string;
  /** font-weight value as written (e.g. "400", "700", "normal", "bold"). */
  weight: string;
  /** font-style value as written (e.g. "normal", "italic"). */
  style: string;
}

/** A captured font with a resolved LOCAL asset path inside the theme. */
export interface LocalFontFace extends ParsedFontFace {
  /** Theme-relative path the font file was written to, e.g. "assets/fonts/Larsseit-Regular.woff". */
  localPath: string;
}

const FONT_EXTENSIONS = new Set(['woff2', 'woff', 'ttf', 'otf', 'eot', 'svg']);

/**
 * Generic CSS keyword families that should never be self-hosted — they're the
 * browser's built-in fallbacks. Also a small denylist of common host-served
 * marketing fonts (Klaviyo / Shopify popup widgets) that are NOT part of the
 * site's own type system and would pollute the captured set.
 */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'inherit',
  'initial',
]);

/** Substrings in a font URL that mark third-party widget fonts (not the site's own). */
const THIRD_PARTY_FONT_HOST_HINTS = ['klaviyo.com', 'gstatic.com', 'typekit.net', 'use.typekit'];

/**
 * Extract `@font-face` rules from one or more CSS/HTML strings.
 *
 * Returns a normalized, deduplicated list. Faces whose `src` points at a
 * third-party widget host (Klaviyo etc.) or whose family is a CSS generic are
 * dropped. The FIRST `url(...)` with a recognized font extension in each
 * `src:` declaration is used (preferring woff2 > woff when several are listed).
 */
export function parseFontFaces(...cssOrHtml: string[]): ParsedFontFace[] {
  const faces: ParsedFontFace[] = [];
  const seen = new Set<string>();

  for (const input of cssOrHtml) {
    if (!input) continue;
    const blockRe = /@font-face\s*\{([^}]*)\}/gi;
    let block: RegExpExecArray | null;
    while ((block = blockRe.exec(input)) !== null) {
      const body = block[1];

      const family = readDeclaration(body, 'font-family');
      if (!family) continue;
      const familyClean = family.replace(/^["']|["']$/g, '').trim();
      if (!familyClean || GENERIC_FAMILIES.has(familyClean.toLowerCase())) continue;

      const srcDecl = readDeclaration(body, 'src');
      if (!srcDecl) continue;
      const picked = pickBestFontUrl(srcDecl);
      if (!picked) continue;
      if (THIRD_PARTY_FONT_HOST_HINTS.some((h) => picked.url.toLowerCase().includes(h))) continue;

      const weight = normalizeWeight(readDeclaration(body, 'font-weight') ?? '400');
      const style = normalizeStyle(readDeclaration(body, 'font-style'));

      const key = `${familyClean.toLowerCase()}|${weight}|${style}|${picked.url}`;
      if (seen.has(key)) continue;
      seen.add(key);

      faces.push({ family: familyClean, src: picked.url, format: picked.format, weight, style });
    }
  }

  return faces;
}

/** Read a single CSS declaration value (`prop: value;`) out of a rule body. */
function readDeclaration(body: string, prop: string): string | null {
  const re = new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i');
  const m = re.exec(body);
  return m ? m[1].trim() : null;
}

/**
 * From a `src:` declaration value, return the best `url(...)` whose target has
 * a recognized font extension. Prefers woff2, then woff, then any other known
 * font extension in source order.
 */
function pickBestFontUrl(srcDecl: string): { url: string; format: string } | null {
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  const candidates: { url: string; format: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(srcDecl)) !== null) {
    const url = m[2].trim();
    const ext = fontExtension(url);
    if (ext) candidates.push({ url, format: ext });
  }
  if (candidates.length === 0) return null;
  const byPref = (c: { format: string }): number =>
    c.format === 'woff2' ? 0 : c.format === 'woff' ? 1 : 2;
  candidates.sort((a, b) => byPref(a) - byPref(b));
  return candidates[0];
}

/** Lowercased font extension (sans dot) for a URL, or null when not a font. */
function fontExtension(url: string): string | null {
  // Strip query string + fragment before reading the extension.
  const clean = url.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = clean.slice(dot + 1).toLowerCase();
  return FONT_EXTENSIONS.has(ext) ? ext : null;
}

/** Normalize a font-weight value: keyword → numeric, ranges → first number. */
function normalizeWeight(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (v === 'normal') return '400';
  if (v === 'bold') return '700';
  // Weight ranges ("400 700") — keep the first.
  const num = /\d{3}/.exec(v);
  return num ? num[0] : '400';
}

/**
 * Normalize a font-style value to `normal` / `italic` / `oblique`. Bogus values
 * — empty, missing, or the literal `undefined`/`inherit` that some page builders
 * (e.g. Replo) emit — collapse to `normal` so faces dedupe cleanly.
 */
function normalizeStyle(raw: string | null): string {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'italic') return 'italic';
  if (v.startsWith('oblique')) return 'oblique';
  return 'normal';
}

/**
 * Resolve a protocol-relative or relative font URL to an absolute https URL.
 * `//cdn.shopify.com/x.woff` → `https://cdn.shopify.com/x.woff`. Absolute and
 * relative-to-base URLs are passed through `URL` resolution.
 */
export function absolutizeFontUrl(src: string, baseUrl?: string): string {
  const trimmed = src.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (baseUrl) {
    try {
      return new URL(trimmed, baseUrl).toString();
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Derive a stable, filesystem-safe filename for a font URL. Uses the URL's last
 * path segment when it carries a font extension; otherwise synthesizes
 * `<family>-<weight>[-italic].<ext>`.
 */
export function fontFilename(face: ParsedFontFace): string {
  const clean = face.src.split('?')[0].split('#')[0];
  const seg = clean.slice(clean.lastIndexOf('/') + 1);
  if (seg && fontExtension(seg)) {
    return seg.replace(/[^A-Za-z0-9._-]/g, '_');
  }
  const familySlug = face.family.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const italic = face.style === 'italic' ? '-italic' : '';
  return `${familySlug}-${face.weight}${italic}.${face.format}`;
}

/**
 * Emit `@font-face` CSS rules pointing at the LOCAL theme asset paths.
 * Intended to be appended to the theme `style.css`.
 *
 * `assetBase` defaults to a relative `assets/fonts/...` URL resolved via
 * `get_stylesheet_directory_uri()` at runtime; since `style.css` lives at the
 * theme root, the relative URL is correct as-is.
 */
export function buildFontFaceCss(faces: LocalFontFace[]): string {
  if (faces.length === 0) return '';
  const rules = faces.map((f) => {
    const fmt = cssFormat(f.format);
    return `@font-face {
	font-family: '${f.family}';
	src: url('${f.localPath}')${fmt ? ` format('${fmt}')` : ''};
	font-weight: ${f.weight};
	font-style: ${f.style};
	font-display: swap;
}`;
  });
  return `\n/*\n * Self-hosted source fonts. Captured from the source site's @font-face\n * declarations and downloaded into assets/fonts/ so headings + body render in\n * the real typeface rather than a system fallback.\n */\n${rules.join('\n')}\n`;
}

/** Map a font extension to the CSS `format()` token. */
function cssFormat(ext: string): string {
  switch (ext) {
    case 'woff2': return 'woff2';
    case 'woff': return 'woff';
    case 'ttf': return 'truetype';
    case 'otf': return 'opentype';
    case 'eot': return 'embedded-opentype';
    case 'svg': return 'svg';
    default: return '';
  }
}

export interface ThemeFontFamily {
  fontFamily: string;
  name: string;
  slug: string;
  fontFace?: Array<{
    fontFamily: string;
    fontWeight: string;
    fontStyle: string;
    src: string[];
  }>;
}

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

/** Infer a font-weight from weight words in a family name (fallback to declared). */
function weightFromFamilyName(family: string, declared: string): string {
  const m = /(thin|extralight|ultralight|light|regular|book|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy)/i.exec(family);
  if (!m) return declared;
  const map: Record<string, string> = {
    thin: '100', extralight: '200', ultralight: '200', light: '300',
    regular: '400', book: '400', normal: '400', medium: '500',
    semibold: '600', demibold: '600', bold: '700', extrabold: '800',
    ultrabold: '800', black: '900', heavy: '900',
  };
  return map[m[1].toLowerCase()] ?? declared;
}

/**
 * Consolidate parsed/local font-faces by their BASE family name, deriving the
 * weight from the family-name suffix when the declared weight doesn't already
 * disambiguate. Drops byte-duplicate faces (same base family + weight + style),
 * preferring the cleaner source URL (no hash suffix) and woff2 > woff.
 */
export function consolidateFontFaces<T extends ParsedFontFace>(faces: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const f of faces) {
    const base = baseFamilyName(f.family);
    const weight = weightFromFamilyName(f.family, f.weight);
    const key = `${base.toLowerCase()}|${weight}|${f.style}`;
    const merged = { ...f, family: base, weight } as T;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, merged);
      continue;
    }
    // Prefer woff2, then the URL without a hash-style suffix (cleaner filename).
    const score = (x: ParsedFontFace): number =>
      (x.format === 'woff2' ? 0 : 2) + (/_[0-9a-f]{8,}\./i.test(x.src) ? 1 : 0);
    if (score(merged) < score(existing)) byKey.set(key, merged);
  }
  return [...byKey.values()];
}

/**
 * Strip a trailing weight/style descriptor and any numeric hash from a family
 * name so variant-suffixed observed names match the base captured family.
 * e.g. `futura-lt-w01-book` → `futura-lt-w01`, `avenir-lt-w01_35-light1475496`
 * → `avenir-lt-w01_35`, `helvetica-w01-roman` → `helvetica-w01`. Without this,
 * a computed/observed family carrying a `-book`/`-light`/hash suffix never
 * matches the captured `@font-face` family (which the capture pipeline derives
 * without the suffix), so the substitution path wrongly fires and the real
 * self-hosted source font is replaced by a generic (Inter). Wix-style.
 */
function normalizeFamilyBase(name: string): string {
  return name
    .toLowerCase()
    .replace(/^["']|["']$/g, '')
    .replace(/[0-9]{3,}/g, '') // drop builder hashes (e.g. ...light1475496)
    .replace(
      /[-_ ]+(thin|extra-?light|ultra-?light|light|book|regular|normal|roman|text|medium|semi-?bold|demi-?bold|demi|bold|extra-?bold|ultra-?bold|black|heavy|italic|oblique)\b/g,
      '',
    )
    .replace(/[-_ ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
}

/**
 * Pick the captured family that best matches a requested family stack from the
 * design foundation / typography.json (e.g. "Larsseit, sans-serif"). Matches on
 * the first family token, case-insensitively. Falls back to comparing the
 * weight/style/hash-stripped base names so an observed `futura-lt-w01-book`
 * still resolves to the captured `futura-lt-w01`. Returns the matching captured
 * family name (canonical casing) or null.
 */
export function matchCapturedFamily(
  requestedStack: string | null | undefined,
  faces: ParsedFontFace[],
): string | null {
  if (!requestedStack) return null;
  const first = requestedStack.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (!first) return null;
  for (const f of faces) {
    if (f.family.toLowerCase() === first) return f.family;
  }
  // Suffix-tolerant fallback: match on the normalized base name.
  const firstBase = normalizeFamilyBase(first);
  if (firstBase.length >= 4) {
    for (const f of faces) {
      if (normalizeFamilyBase(f.family) === firstBase) return f.family;
    }
  }
  return null;
}
