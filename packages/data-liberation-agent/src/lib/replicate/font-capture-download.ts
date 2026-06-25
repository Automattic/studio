//
// Font capture — downloader
// =========================
// Fetches the font files referenced by parsed `@font-face` rules into a
// theme's `assets/fonts/` directory and returns `LocalFontFace[]` (the parsed
// descriptor + the theme-relative local path it was written to).
//
// Kept separate from `font-capture.ts` (pure parsing/emit) so the parsing logic
// stays trivially unit-testable without network or filesystem.
//

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { absolutizeFontUrl, fontFilename, type ParsedFontFace, type LocalFontFace } from './font-capture.js';
import { safeFetch } from '../media-fetch/index.js';

export interface DownloadFontsOpts {
  /** Absolute path to the theme root (e.g. output/<site>/theme). */
  themeDir: string;
  /** Theme-relative directory for fonts. Defaults to "assets/fonts". */
  fontsSubdir?: string;
  /** Optional base URL to resolve relative font src against. */
  baseUrl?: string;
  /** Per-request timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Injected fetch (for tests). Routed through the SSRF-safe wrapper. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface DownloadFontsResult {
  /** Successfully downloaded faces with their theme-relative local paths. */
  faces: LocalFontFace[];
  /** Faces that failed to download, with the error message. */
  errors: Array<{ face: ParsedFontFace; error: string }>;
}

/**
 * Download each parsed font-face's `src` into `<themeDir>/<fontsSubdir>/`.
 * Byte-identical URLs are fetched once. Returns the local faces (for emitting
 * @font-face CSS / theme.json) plus any failures.
 */
export async function downloadFonts(
  parsed: ParsedFontFace[],
  opts: DownloadFontsOpts,
): Promise<DownloadFontsResult> {
  const fontsSubdir = opts.fontsSubdir ?? 'assets/fonts';
  const timeoutMs = opts.timeoutMs ?? 30000;
  const destDir = join(opts.themeDir, fontsSubdir);

  const faces: LocalFontFace[] = [];
  const errors: DownloadFontsResult['errors'] = [];
  // Map absolute URL → theme-relative local path, so duplicate URLs reuse one file.
  const fetched = new Map<string, string>();

  for (const face of parsed) {
    const absolute = absolutizeFontUrl(face.src, opts.baseUrl);
    const filename = fontFilename(face);
    const relPath = `${fontsSubdir}/${filename}`;

    if (fetched.has(absolute)) {
      faces.push({ ...face, localPath: fetched.get(absolute)! });
      continue;
    }

    const destPath = join(destDir, filename);
    // Skip re-download when the file already exists from a prior run.
    if (existsSync(destPath)) {
      fetched.set(absolute, relPath);
      faces.push({ ...face, localPath: relPath });
      continue;
    }

    try {
      // SSRF-safe: validates the URL (a font `src` parsed from arbitrary source
      // CSS), re-checks every redirect, and caps the body size.
      const res = await safeFetch(absolute, { timeoutMs, fetchImpl: opts.fetchImpl });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      const buf = res.body;
      if (buf.length === 0) throw new Error('empty response body');
      mkdirSync(destDir, { recursive: true });
      writeFileSync(destPath, buf);
      fetched.set(absolute, relPath);
      faces.push({ ...face, localPath: relPath });
    } catch (err) {
      errors.push({ face, error: (err as Error).message });
    }
  }

  return { faces, errors };
}
