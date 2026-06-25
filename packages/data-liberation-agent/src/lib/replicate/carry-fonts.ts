/**
 * Self-host carried Wix fonts (carry-and-scope path).
 * ===================================================
 * Wix carries its ENTIRE default font library into the scoped CSS — hundreds of
 * `@font-face` rules (Madefor/Helvetica/… in every weight + charset subset), almost
 * all UNUSED by the actual pages, served from two CDNs (`static.wixstatic.com/ufonts`
 * and protocol-relative `//static.parastorage.com/fonts`). A handful of ufonts faces
 * also leak into the media pipeline and come back as localhost `/wp-content/uploads`
 * URLs.
 *
 * This:
 *   1. STRIPS every `@font-face` whose family is never applied (used = the family name
 *      appears anywhere fonts are applied — literal `font-family:` decls OR Wix's
 *      `--font_N` shorthand tokens, both of which live in the non-@font-face CSS). This
 *      removes the bulk of the boilerplate AND its CDN refs.
 *   2. DOWNLOADS the kept (used) fonts into the theme's `assets/fonts/` — `safeFetch`
 *      for remote (incl. `//` → https:), a local copy for a leaked localhost-uploads URL
 *      (loopback can't be fetched) — and rewrites their `url()` to `../fonts/<file>`.
 *
 * Result: zero CDN font URLs, no unused-font bloat. Best-effort per font.
 */
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { safeFetch } from '../media-fetch/index.js';

const FONT_EXT = /\.(woff2|woff|ttf|otf|eot)(?:[?#]|$)/i;
// @font-face has no nested braces, so [^{}]* safely bounds one block (multi-line ok).
const FONT_FACE_BLOCK = /@font-face\s*\{[^{}]*\}/gi;
const URL_IN_DECL = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi;
const FAMILY_DECL = /font-family\s*:\s*(['"]?)([^;'"}]+)\1/i;

/** Extract the font src URLs from an @font-face block body (remote or font-ext, never data:). */
function fontUrlsInBlock(block: string): string[] {
  const urls: string[] = [];
  const re = new RegExp(URL_IN_DECL.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const v = m[2].trim();
    if (v.startsWith('data:')) continue;
    if (/^(https?:)?\/\//i.test(v) || FONT_EXT.test(v)) urls.push(v);
  }
  return urls;
}

export interface StripResult {
  /** CSS with unused @font-face blocks removed. */
  css: string;
  /** Distinct src URLs from the KEPT (used) @font-face blocks. */
  keptUrls: string[];
  /** Number of @font-face blocks removed. */
  stripped: number;
}

/**
 * Pure: remove every @font-face whose family is not mentioned in `usageText` (the CSS
 * with @font-face blocks elided, where fonts are actually applied — literal `font-family`
 * + Wix `--font_N` tokens). Returns the cleaned CSS and the kept faces' src URLs.
 */
export function stripUnusedFontFaces(css: string, usageText: string): StripResult {
  const usage = usageText.toLowerCase();
  const keptUrls = new Set<string>();
  let stripped = 0;
  const out = css.replace(FONT_FACE_BLOCK, (block) => {
    const fam = FAMILY_DECL.exec(block);
    const family = fam ? fam[2].trim() : null;
    const used = family != null && family.length > 0 && usage.includes(family.toLowerCase());
    if (used) {
      for (const u of fontUrlsInBlock(block)) keptUrls.add(u);
      return block;
    }
    stripped++;
    return '';
  });
  return { css: out, keptUrls: [...keptUrls], stripped };
}

/**
 * Remove dev-only CSS sourceMappingURL comments (often CDN URLs) — inert for rendering,
 * and the sourcemap won't exist in the carry, so dropping them is lossless.
 */
export function stripCssSourceMaps(css: string): string {
  return css.replace(/\/\*#?\s*sourceMappingURL=[^*]*\*\//gi, '');
}

/** Stable, collision-free local filename from a font URL (full path, sanitized). */
function fontFilenameFromUrl(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url.startsWith('//') ? `https:${url}` : url).pathname;
  } catch {
    pathname = url;
  }
  return pathname.replace(/^\/+/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'font';
}

/** If `url` is a site-local `/wp-content/uploads/...` ref, resolve it to the host file under wpRoot. */
function localUploadsPath(url: string, wpRoot?: string): string | null {
  if (!wpRoot) return null;
  const m = /\/wp-content\/uploads\/(.+)$/.exec(url);
  if (!m) return null;
  return join(wpRoot, 'wp-content', 'uploads', m[1]);
}

export interface LocalizeFontsResult {
  files: Array<{ path: string; content: string }>;
  downloaded: number;
  failed: Array<{ url: string; error: string }>;
  fontFacesStripped: number;
}

export async function localizeCarryFonts(
  themeRoot: string,
  files: Array<{ path: string; content: string }>,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; wpRoot?: string; usageExtra?: string[] } = {},
): Promise<LocalizeFontsResult> {
  const cssFiles = files.filter((f) => f.path.endsWith('.css'));
  if (cssFiles.length === 0) return { files, downloaded: 0, failed: [], fontFacesStripped: 0 };

  // Usage text: all CSS with @font-face elided (so a face's own family descriptor isn't
  // counted as usage), plus any caller-supplied extra surfaces (e.g. island inline styles).
  const usageText =
    cssFiles.map((f) => f.content.replace(FONT_FACE_BLOCK, ' ')).join('\n') +
    (opts.usageExtra ? '\n' + opts.usageExtra.join('\n') : '');

  // Strip unused faces per file; collect the used faces' URLs.
  const strippedByPath = new Map<string, string>();
  const keptUrls = new Set<string>();
  let fontFacesStripped = 0;
  for (const f of cssFiles) {
    const r = stripUnusedFontFaces(f.content, usageText);
    strippedByPath.set(f.path, stripCssSourceMaps(r.css));
    r.keptUrls.forEach((u) => keptUrls.add(u));
    fontFacesStripped += r.stripped;
  }

  const applyStripped = (): Array<{ path: string; content: string }> =>
    files.map((f) => (strippedByPath.has(f.path) ? { ...f, content: strippedByPath.get(f.path)! } : f));

  if (keptUrls.size === 0) {
    return { files: applyStripped(), downloaded: 0, failed: [], fontFacesStripped };
  }

  // Download/copy each kept font into assets/fonts/.
  const fontsDir = join(themeRoot, 'assets', 'fonts');
  const urlToFile = new Map<string, string>();
  const failed: Array<{ url: string; error: string }> = [];
  let downloaded = 0;
  for (const url of keptUrls) {
    const filename = fontFilenameFromUrl(url);
    const dest = join(fontsDir, filename);
    try {
      if (existsSync(dest)) { urlToFile.set(url, filename); continue; }
      mkdirSync(fontsDir, { recursive: true });
      const local = localUploadsPath(url, opts.wpRoot);
      if (local) {
        if (!existsSync(local)) throw new Error(`local uploads file missing: ${local}`);
        copyFileSync(local, dest);
      } else {
        const fetchUrl = url.startsWith('//') ? `https:${url}` : url;
        const res = await safeFetch(fetchUrl, { timeoutMs: opts.timeoutMs ?? 30000, fetchImpl: opts.fetchImpl });
        if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
        if (!res.body || res.body.length === 0) throw new Error('empty response body');
        writeFileSync(dest, res.body);
      }
      urlToFile.set(url, filename);
      downloaded++;
    } catch (err) {
      failed.push({ url, error: (err as Error).message });
    }
  }

  // Rewrite the (already stripped) CSS: kept font url()s → ../fonts/<file>.
  const outFiles = files.map((f) => {
    if (!strippedByPath.has(f.path)) return f;
    let content = strippedByPath.get(f.path)!;
    const relPrefix = relative(dirname(f.path), join('assets', 'fonts')).split(/[\\/]/).join('/');
    for (const [url, filename] of urlToFile) content = content.split(url).join(`${relPrefix}/${filename}`);
    return { ...f, content };
  });

  return { files: outFiles, downloaded, failed, fontFacesStripped };
}
