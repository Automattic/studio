//
// Best-effort Google Fonts self-hosting for the owned-source path.
//
// The local site may reference fonts via:
//   <link href="https://fonts.googleapis.com/css2?...">
//   @import url('https://fonts.googleapis.com/css2?...')
//
// We fetch that CSS with a woff2-capable UA, parse its @font-face blocks
// (LOCAL PARSER — we cannot reuse parseFontFaces from font-capture.ts because it
// includes 'gstatic.com' in THIRD_PARTY_FONT_HOST_HINTS and therefore drops every
// face whose src URL points at fonts.gstatic.com, which is exactly where Google
// Fonts serves its woff2 files. The local parser mirrors parseFontFaces's regex
// pattern and field set but omits that filter.), download each woff2 into the
// theme's assets/fonts/, and return LocalFontFace[] for buildThemeScaffold's
// capturedFonts. Every failure is collected, never thrown — fonts are a fidelity
// enhancement, not a pipeline gate.
//
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalFontFace } from '../font-capture.js';
import { assertPublicHttpUrl } from '../../media-fetch/index.js';

// Matches all https://fonts.googleapis.com/css or css2 query-string URLs found in
// href attributes, @import rules, or bare text. Handles HTML-encoded & (&amp;).
const GOOGLE_CSS_RE = /https:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s)]+/g;

// Chrome UA so Google serves woff2 (not woff/ttf fallbacks).
const WOFF2_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const FONT_EXTENSIONS = new Set(['woff2', 'woff', 'ttf', 'otf', 'eot']);

/** Find unique Google-Fonts css/css2 URLs across html/css source strings (deduped). */
export function extractGoogleFontCssUrls(sources: string[]): string[] {
  const found = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(GOOGLE_CSS_RE)) {
      found.add(m[0].replace(/&amp;/g, '&'));
    }
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Local @font-face parser (mirrors parseFontFaces logic; no gstatic filter)
// ---------------------------------------------------------------------------

interface ParsedGoogleFace {
  family: string;
  src: string;
  format: string;
  weight: string;
  style: string;
}

function readDecl(body: string, prop: string): string | null {
  const re = new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i');
  const m = re.exec(body);
  return m ? m[1].trim() : null;
}

function fontExtension(url: string): string | null {
  const clean = url.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = clean.slice(dot + 1).toLowerCase();
  return FONT_EXTENSIONS.has(ext) ? ext : null;
}

function pickBestUrl(srcDecl: string): { url: string; format: string } | null {
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  const candidates: { url: string; format: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(srcDecl)) !== null) {
    const url = m[2].trim();
    const ext = fontExtension(url);
    if (ext) candidates.push({ url, format: ext });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const pref = (c: { format: string }) => (c.format === 'woff2' ? 0 : c.format === 'woff' ? 1 : 2);
    return pref(a) - pref(b);
  });
  return candidates[0];
}

// Variable-axis css2 responses declare weight RANGES ("100 900"); the \d{3}
// match deliberately collapses them to the FIRST value. Discrete-weight
// requests (the common css2 form) emit one block per weight, so the collapse
// is rare in practice — and it keeps spaces out of faceFileName. Do not
// "fix" this to preserve the range: a space would land in the filename.
function normalizeWeight(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (v === 'normal') return '400';
  if (v === 'bold') return '700';
  const num = /\d{3}/.exec(v);
  return num ? num[0] : '400';
}

function normalizeStyle(raw: string | null): string {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'italic') return 'italic';
  if (v.startsWith('oblique')) return 'oblique';
  return 'normal';
}

/** Parse @font-face blocks from Google Fonts CSS. No gstatic.com filter. */
function parseGoogleFontFaces(css: string): ParsedGoogleFace[] {
  const faces: ParsedGoogleFace[] = [];
  const seen = new Set<string>();
  const blockRe = /@font-face\s*\{([^}]*)\}/gi;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(css)) !== null) {
    const body = block[1];
    const family = readDecl(body, 'font-family');
    if (!family) continue;
    const familyClean = family.replace(/^["']|["']$/g, '').trim();
    if (!familyClean) continue;
    const srcDecl = readDecl(body, 'src');
    if (!srcDecl) continue;
    const picked = pickBestUrl(srcDecl);
    if (!picked) continue;
    const weight = normalizeWeight(readDecl(body, 'font-weight') ?? '400');
    const style = normalizeStyle(readDecl(body, 'font-style'));
    const key = `${familyClean.toLowerCase()}|${weight}|${style}|${picked.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push({ family: familyClean, src: picked.url, format: picked.format, weight, style });
  }
  return faces;
}

// ---------------------------------------------------------------------------
// Filename + download
// ---------------------------------------------------------------------------

/** Filename = sanitized URL basename. gstatic paths end in a unique hash per
 * subset file, so every unicode-range subset keeps its own file — replacing
 * the old family-weight naming that collapsed subsets onto one file and
 * measurably changed glyph metrics (walrus parity probe: Fraunces 337px vs
 * 284px for the same string). */
function faceFileName(face: { family: string; weight: string; style: string; format: string; src: string }): string {
  const base = face.src.split('?')[0].split('#')[0].split('/').pop() ?? '';
  const sanitized = base.replace(/[^A-Za-z0-9._-]+/g, '');
  if (sanitized && /\.[a-z0-9]+$/i.test(sanitized)) return sanitized;
  const stem = face.family.replace(/[^A-Za-z0-9]+/g, '');
  const italic = face.style === 'italic' ? '-italic' : '';
  const ext = face.format === 'woff' ? 'woff' : 'woff2';
  return `${stem}-${face.weight}${italic}.${ext}`;
}

export interface SelfHostGoogleFontsOpts {
  /** Absolute theme dir; fonts land in <themeDir>/assets/fonts/. */
  themeDir: string;
  fontsSubdir?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SelfHostGoogleFontsResult {
  faces: LocalFontFace[];
  /** The fetched Google CSS, verbatim (all subset @font-face blocks with their
   * unicode-range descriptors intact), with each downloaded face URL rewritten
   * to its theme-relative local path. Splicing THIS into the carried stylesheet
   * reproduces the source's exact font set — metrics-identical rendering. */
  localizedCss: string;
  errors: Array<{ url: string; error: string }>;
}

/**
 * Fetch Google Fonts CSS URLs, download each woff2 into the theme, return
 * LocalFontFace[] for buildThemeScaffold's capturedFonts. Fully best-effort:
 * any failure records an error and continues.
 */
export async function selfHostGoogleFonts(
  cssUrls: string[],
  opts: SelfHostGoogleFontsOpts,
): Promise<SelfHostGoogleFontsResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const fontsSubdir = opts.fontsSubdir ?? 'assets/fonts';
  const destDir = join(opts.themeDir, fontsSubdir);
  const faces: LocalFontFace[] = [];
  const errors: SelfHostGoogleFontsResult['errors'] = [];
  const localizedParts: string[] = [];
  // Dedup by source URL across css files — same subset referenced twice
  // downloads (and localizes) once. Subsets themselves are all KEPT: each
  // unicode-range file has distinct metrics-relevant content.
  const downloaded = new Map<string, string>(); // src url → localPath

  for (const cssUrl of cssUrls) {
    let css: string;
    try {
      const res = await fetchFn(cssUrl, {
        headers: { 'User-Agent': WOFF2_UA },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      css = await res.text();
    } catch (err) {
      errors.push({ url: cssUrl, error: `css fetch failed: ${(err as Error).message}` });
      continue;
    }

    let localized = css;
    for (const parsed of parseGoogleFontFaces(css)) {
      try {
        let localPath = downloaded.get(parsed.src);
        if (!localPath) {
          // The face src comes from a THIRD-PARTY response body (the fetched
          // CSS), not from the trusted local site — guard it before fetching.
          // Throws SsrfBlockedError on private/internal hosts → errors[].
          assertPublicHttpUrl(parsed.src);
          const fileName = faceFileName(parsed);
          localPath = `${fontsSubdir}/${fileName}`;
          const destFile = join(destDir, fileName);
          if (!existsSync(destFile)) {
            const res = await fetchFn(parsed.src, {
              headers: { 'User-Agent': WOFF2_UA },
              signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            mkdirSync(destDir, { recursive: true });
            writeFileSync(destFile, Buffer.from(await res.arrayBuffer()));
          }
          downloaded.set(parsed.src, localPath);
          faces.push({ ...parsed, localPath });
        }
        // Rewrite this face's URL in the verbatim css (all occurrences).
        // The localized css is consumed from assets/css/source.css, so the
        // url must be relative to THAT file's directory (../fonts/<file>),
        // while LocalFontFace.localPath stays theme-root-relative for the
        // scaffold's style.css emission.
        const cssRelative = localPath.replace(/^assets\//, '../');
        localized = localized.split(parsed.src).join(cssRelative);
      } catch (err) {
        errors.push({ url: parsed.src, error: (err as Error).message });
      }
    }
    localizedParts.push(localized);
  }

  return { faces, localizedCss: localizedParts.join('\n\n'), errors };
}
