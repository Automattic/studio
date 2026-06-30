//
// liberate_theme_scaffold
// =======================
// Reads <outputDir>/design-foundation.json and emits a complete-and-
// activatable WordPress block theme bundle as in-memory ReplicaFile[].
// Pure deterministic mapping — no agent involvement, no vision, no
// reasoning. Used by:
//
//   1. The streaming watch loop after foundation-rev succeeds, to
//      install the bootstrap theme without waiting on an agent call.
//   2. The standalone `replicate` skill, which can call this for the
//      theme.json + style.css + functions.php skeleton and then layer
//      per-archetype templates + patterns on top.
//
// See src/lib/replicate/theme-scaffold.ts for the mapping logic.
//

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import type { Handler } from '../handler-types.js';
import { parseCapturedFontFaces, consolidateFontFaces, matchCapturedFamily } from '@automattic/blocks-engine/theme';
import { buildThemeScaffold } from '../../lib/replicate/theme-scaffold.js';
import { lintThemeJson } from '../../lib/replicate/theme-json-lint.js';
import { extractThemeChromeFromHtml } from '../../lib/replicate/source-chrome.js';
import { downloadFonts } from '../../lib/replicate/font-capture-download.js';
import { findFreeReplacement, fallbackReplacement, firstFamilyToken } from '../../lib/replicate/font-substitution.js';
import { downloadReplacementFont } from '../../lib/replicate/font-substitution-download.js';
import { safeFetch } from '../../lib/media-fetch/index.js';
import { sampleFooterColor, sampleImageColor, nearestToken, brightness, type PaletteToken } from '../../lib/replicate/footer-color.js';

interface ScaffoldArgs {
  outputDir?: string;
  themeSlug?: string;
  themeName?: string;
  siteTitle?: string;
  themeDescription?: string;
  /** Source homepage URL — used to absolutize captured header logo/nav hrefs. */
  sourceUrl?: string;
  /** Theme output dir for downloaded fonts. Defaults to <outputDir>/theme. */
  themeDir?: string;
  /**
   * Block-reconstructed pages. Each `{ slug, patternSlug, isHome? }` binds a page's
   * source-faithful WP slug to the theme pattern holding its reconstructed section
   * blocks. The scaffold emits `templates/page-<slug>.html` per entry (and
   * `front-page.html` for the homepage), so content pages render their reconstructed
   * pattern instead of falling through `page.html` to raw carried `wp:post-content`.
   */
  reconstructedPages?: Array<{ slug: string; patternSlug: string; isHome?: boolean }>;
  /**
   * When true, write the emitted text theme files to `themeDir` (defaults to
   * `<outputDir>/theme`) alongside the font/logo assets the handler already
   * downloads there — materializing a complete on-disk theme. Left in-memory by
   * default so the "builders return strings, the orchestrator persists" contract
   * holds for callers that install `themeFiles[]` straight into a live site.
   */
  persist?: boolean;
}

/**
 * Write theme text files to disk under `themeDir`, creating parent dirs. Returns
 * the written relative paths. Pure aside from the filesystem — the binary font/
 * logo assets are downloaded separately by the handler.
 */
export function persistThemeFiles(
  themeDir: string,
  files: Array<{ relativePath: string; content: string }>,
): string[] {
  const written: string[] = [];
  for (const f of files) {
    const dest = join(themeDir, f.relativePath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.content);
    written.push(f.relativePath);
  }
  return written;
}

interface TypographyObserved {
  lineHeights: Record<string, string>;
  headingFamily?: string;
  bodyFamily?: string;
}

/** Read per-heading line-heights + observed heading/body families from typography.json. */
function readObservedTypography(typographyPath: string): TypographyObserved {
  const out: TypographyObserved = { lineHeights: {} };
  try {
    if (!existsSync(typographyPath)) return out;
    const raw = JSON.parse(readFileSync(typographyPath, 'utf8')) as {
      bySelector?: Record<string, Array<{ lineHeight?: string; fontFamily?: string }>>;
    };
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      const lh = raw.bySelector?.[tag]?.[0]?.lineHeight;
      if (typeof lh === 'string') out.lineHeights[tag] = lh;
    }
    out.headingFamily =
      raw.bySelector?.h1?.[0]?.fontFamily ??
      raw.bySelector?.h2?.[0]?.fontFamily ??
      raw.bySelector?.h3?.[0]?.fontFamily;
    out.bodyFamily = raw.bySelector?.body?.[0]?.fontFamily;
    return out;
  } catch {
    return out;
  }
}

/**
 * Read redirect-map.json into a `{ sourcePath: localPermalink }` record for nav
 * href rewriting. Returns undefined when the file is missing/corrupt so the
 * scaffold falls back to passing nav hrefs through unchanged.
 */
function readRedirectMap(path: string): Record<string, string> | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Array<{ from?: string; to?: string }>;
    if (!Array.isArray(raw)) return undefined;
    const map: Record<string, string> = {};
    for (const entry of raw) {
      if (typeof entry?.from === 'string' && typeof entry?.to === 'string') {
        map[entry.from] = entry.to;
      }
    }
    return Object.keys(map).length > 0 ? map : undefined;
  } catch {
    return undefined;
  }
}

/** Filesystem-safe basename for a logo URL (last path segment, ext preserved). */
function logoFilename(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.slice(u.pathname.lastIndexOf('/') + 1) || 'logo';
    const safe = seg.replace(/[^A-Za-z0-9._-]/g, '_');
    return /\.[a-z0-9]{2,4}$/i.test(safe) ? safe : `${safe}.png`;
  } catch {
    return 'logo.png';
  }
}

/**
 * Download the captured header logo from the source CDN into the theme's
 * `assets/` directory so the header references it locally instead of hot-linking
 * the source CDN. Returns the theme-relative path (e.g. "assets/SNOOZ-Logo.png")
 * or undefined when there's no logo / the download fails (header then falls back
 * to the captured CDN URL).
 */
async function downloadLogo(logoUrl: string | undefined, themeDir: string): Promise<string | undefined> {
  if (!logoUrl) return undefined;
  const filename = logoFilename(logoUrl);
  const relPath = `assets/${filename}`;
  const destPath = join(themeDir, relPath);
  if (existsSync(destPath)) return relPath;
  try {
    // SSRF-safe: the logo URL is parsed from arbitrary source HTML, so validate
    // it (and any redirect) against internal hosts and cap the body size.
    const res = await safeFetch(logoUrl, { timeoutMs: 30000 });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    const buf = res.body;
    if (buf.length === 0) throw new Error('empty response body');
    mkdirSync(join(themeDir, 'assets'), { recursive: true });
    writeFileSync(destPath, buf);
    return relPath;
  } catch {
    return undefined;
  }
}

export const themeScaffoldHandler: Handler = async (args, ctx) => {
  const a = args as ScaffoldArgs;
  if (!a.outputDir) {
    return ctx.errorResult('liberate_theme_scaffold requires `outputDir`.');
  }
  if (!a.themeSlug) {
    return ctx.errorResult('liberate_theme_scaffold requires `themeSlug` (kebab-case, conventionally <siteSlug>-replica).');
  }

  const foundationPath = resolve(join(a.outputDir, 'design-foundation.json'));
  if (!existsSync(foundationPath)) {
    return ctx.errorResult(
      `design-foundation.json not found at ${foundationPath}. Run /data-liberation:design-foundations first.`,
    );
  }

  let foundation: unknown;
  try {
    foundation = JSON.parse(readFileSync(foundationPath, 'utf8'));
  } catch (err) {
    return ctx.errorResult(`Failed to parse design-foundation.json: ${(err as Error).message}`);
  }
  if (!foundation || typeof foundation !== 'object') {
    return ctx.errorResult('design-foundation.json did not parse to an object.');
  }

  // ── Source chrome (real header logo + primary nav) ──────────────────────────
  // The generic page-list header is a poor replica. When the captured homepage
  // HTML is available, extract the real logo + top-level nav so the scaffold
  // emits explicit navigation-links instead of an auto page-list.
  const sourceUrl = a.sourceUrl ?? 'https://example.com/';
  const htmlPath = resolve(join(a.outputDir, 'html', 'homepage.html'));
  let sourceChrome: ReturnType<typeof extractThemeChromeFromHtml> | undefined;
  let html = '';
  if (existsSync(htmlPath)) {
    try {
      html = readFileSync(htmlPath, 'utf8');
      sourceChrome = extractThemeChromeFromHtml(html, sourceUrl);
    } catch {
      sourceChrome = undefined;
    }
  }

  // ── Self-hosted fonts (capture @font-face → download → assets/fonts/) ────────
  const themeDir = resolve(a.themeDir ?? join(a.outputDir, 'theme'));
  let capturedFonts: Awaited<ReturnType<typeof downloadFonts>>['faces'] = [];
  const fontErrors: Array<{ family: string; error: string }> = [];
  if (html) {
    // Consolidate per-weight family aliases (e.g. Replo's duplicate Larsseit
    // declarations) BEFORE download so we fetch one file per real weight.
    const parsed = consolidateFontFaces(parseCapturedFontFaces(html));
    if (parsed.length > 0) {
      const result = await downloadFonts(parsed, { themeDir, baseUrl: sourceUrl });
      capturedFonts = result.faces;
      for (const e of result.errors) fontErrors.push({ family: e.face.family, error: e.error });
    }
  }

  const observed = readObservedTypography(resolve(join(a.outputDir, 'typography.json')));

  // ── Commercial / uncapturable → free font substitution ──────────────────────
  // When the observed BODY (or display) family has no self-hostable @font-face
  // among the captured fonts — e.g. getsnooz's body `quasimoda` is Adobe Typekit
  // (CSS-only on use.typekit.net, no reachable woff) — the replica would render
  // body copy in a bare `sans-serif` fallback. Map the unhostable family to the
  // closest FREE web font, self-host its woff2 into assets/fonts/, and bind the
  // body family to it. Headings (Larsseit) are usually captured, so the display
  // substitute only fires when the heading font is also unhostable.
  const fontSubstitutions: Array<{ from: string; to: string; rationale: string }> = [];

  async function substituteIfUnhostable(observedStack: string | undefined): Promise<string | undefined> {
    const first = firstFamilyToken(observedStack);
    if (!first) return undefined;
    // Already self-hostable from the captured set? Keep it.
    if (matchCapturedFamily(observedStack, capturedFonts)) return undefined;
    const replacement = findFreeReplacement(observedStack) ?? fallbackReplacement(observedStack);
    const result = await downloadReplacementFont(replacement, { themeDir });
    if (result.faces.length === 0) {
      for (const e of result.errors) fontErrors.push({ family: replacement.family, error: e.error });
      return undefined;
    }
    capturedFonts = [...capturedFonts, ...result.faces];
    fontSubstitutions.push({ from: first, to: replacement.family, rationale: replacement.rationale });
    return replacement.family;
  }

  const bodySubstituteFamily = await substituteIfUnhostable(observed.bodyFamily);
  const displaySubstituteFamily = await substituteIfUnhostable(observed.headingFamily);

  // ── Localize the header logo (download CDN logo → theme assets/) ─────────────
  const localLogoPath = await downloadLogo(sourceChrome?.header?.logoUrl, themeDir);

  // Header tone from the LOGO color. The solid (interior-page) header must show
  // the logo: a light/white logo (designed for a dark/brand header — common when
  // the source homepage uses a transparent overlay header) needs a dark header,
  // or the wordmark vanishes on a white bar. Sample the localized logo and force
  // a dark header tone when its ink is light; a dark logo keeps the light header.
  if (localLogoPath && /\.png$/i.test(localLogoPath)) {
    const logoColor = sampleImageColor(resolve(themeDir, localLogoPath));
    if (logoColor && brightness(logoColor) > 180 && sourceChrome?.header) {
      sourceChrome = { ...sourceChrome, header: { ...sourceChrome.header, tone: 'dark' } };
    }
  }

  // ── Source-path → local-permalink map (redirect-map.json) ────────────────────
  // Produced during extraction (src/adapters/shared.ts runExtractionLoop emits
  // `{ from: "/pages/about-us", to: "/about-us/" }`). Used to rewrite captured
  // nav hrefs to the local pages so the menu resolves instead of 404ing on the
  // raw source path.
  const navHrefMap = readRedirectMap(resolve(join(a.outputDir, 'redirect-map.json')));

  // Footer band color: sample the rendered footer from the desktop homepage
  // screenshot (page builders paint footers via background-images, so computed-
  // style extraction + the AI role-label can be wrong — swiftlumber's footer is
  // taupe, not the brand green the foundation guessed) and map it to the nearest
  // palette token. Falls back to the buildFooterPart default when no screenshot.
  let footerBgToken: string | undefined;
  let footerTextToken: string | undefined;
  {
    const shot = resolve(join(a.outputDir, 'screenshots', 'desktop', 'homepage.png'));
    const fc = (foundation as { color?: { surface?: Record<string, { value?: string }> } }).color?.surface ?? {};
    const tokens: PaletteToken[] = [];
    for (const [key, slug] of [['base', 'surface-base'], ['raised', 'surface-raised'], ['inverse', 'surface-inverse']] as const) {
      const hex = fc[key]?.value;
      if (hex && /^#?[0-9a-f]{3,6}$/i.test(hex)) tokens.push({ slug, hex });
    }
    const sampled = existsSync(shot) ? sampleFooterColor(shot) : null;
    if (sampled && tokens.length > 0) {
      const tok = nearestToken(sampled, tokens);
      if (tok) {
        footerBgToken = tok;
        footerTextToken = brightness(sampled) < 140 ? 'text-inverse' : 'text-default';
      }
    }
  }

  // Surface dropped (unmapped) same-site nav/footer links so a missing menu item
  // is visible in the result instead of silently vanishing during remap.
  const scaffoldStats: { droppedNavLinks?: number } = {};
  const themeFiles = buildThemeScaffold({
    foundation: foundation as Parameters<typeof buildThemeScaffold>[0]['foundation'],
    themeSlug: a.themeSlug,
    themeName: a.themeName,
    siteTitle: a.siteTitle,
    themeDescription: a.themeDescription,
    sourceChrome,
    capturedFonts,
    localLogoPath,
    headingLineHeights: observed.lineHeights,
    headingFamily: observed.headingFamily,
    bodyFamily: observed.bodyFamily,
    bodySubstituteFamily,
    displaySubstituteFamily,
    navHrefMap,
    stats: scaffoldStats,
    reconstructedPages: Array.isArray(a.reconstructedPages) ? a.reconstructedPages : undefined,
    footerBgToken,
    footerTextToken,
  });

  // Lint the generated theme.json before it ships — a malformed theme.json
  // (bad schema/version, missing settings) silently breaks the whole block
  // theme. Free fidelity protection; surfaced as warnings on the result.
  let themeJsonLint: string[] = [];
  const themeJsonFile = themeFiles.find((f) => f.relativePath === 'theme.json');
  if (themeJsonFile) {
    try {
      const parsed = JSON.parse(themeJsonFile.content) as Record<string, unknown>;
      const lint = lintThemeJson(parsed);
      if (!lint.ok) themeJsonLint = lint.errors;
    } catch (err) {
      themeJsonLint = [`theme.json did not parse: ${(err as Error).message}`];
    }
  }

  // Optionally materialize the text files to disk (fonts/logo are already
  // written above). Off by default — callers that install themeFiles[] straight
  // into a live site don't need an on-disk copy; the standalone disk-preview path
  // (and reconstruct-pages, which also writes here) does.
  const persistedPaths = a.persist ? persistThemeFiles(themeDir, themeFiles) : [];

  return ctx.textResult({
    ok: true,
    themeSlug: a.themeSlug,
    themeFiles,
    themeJsonLint,
    persisted: a.persist ? { themeDir, count: persistedPaths.length } : undefined,
    fileCount: themeFiles.length,
    relativePaths: themeFiles.map((f) => f.relativePath),
    sourceChromeUsed: Boolean(sourceChrome?.header?.links?.length || sourceChrome?.header?.logoUrl),
    capturedFonts: capturedFonts.map((f) => ({ family: f.family, weight: f.weight, localPath: f.localPath })),
    fontSubstitutions,
    localLogoPath,
    fontErrors,
    droppedNavLinks: scaffoldStats.droppedNavLinks ?? 0,
  });
};
