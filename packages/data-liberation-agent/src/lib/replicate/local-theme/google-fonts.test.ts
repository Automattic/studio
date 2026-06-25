import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractGoogleFontCssUrls, selfHostGoogleFonts } from './google-fonts.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');

const CSS2_URL = 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;900&display=swap';
const GOOGLE_CSS = `
/* latin */
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/fraunces/v1/abc400.woff2) format('woff2');
}
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 900;
  src: url(https://fonts.gstatic.com/s/fraunces/v1/abc900.woff2) format('woff2');
}
`;

describe('extractGoogleFontCssUrls', () => {
  it('finds css2 urls in <link> tags and CSS @import', () => {
    const html = `<link rel="stylesheet" href="${CSS2_URL}">`;
    const css = `@import url('${CSS2_URL}'); body { color: red; }`;
    expect(extractGoogleFontCssUrls([html, css])).toEqual([CSS2_URL]); // deduped
  });

  it('returns empty for sources without google fonts', () => {
    expect(extractGoogleFontCssUrls(['<link href="styles.css">', 'body{}'])).toEqual([]);
  });
});

describe('selfHostGoogleFonts', () => {
  it('fetches css, downloads woff2 faces into themeDir, returns LocalFontFaces', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const themeDir = mkdtempSync(join(FIXTURE_TMP, 'fonts-'));
    const fetched: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url);
      fetched.push(u);
      if (u.startsWith('https://fonts.googleapis.com')) {
        return new Response(GOOGLE_CSS, { status: 200 });
      }
      return new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]), { status: 200 }); // "wOF2"
    }) as typeof fetch;
    try {
      const result = await selfHostGoogleFonts([CSS2_URL], { themeDir, fetchImpl });
      expect(result.errors).toEqual([]);
      expect(result.faces).toHaveLength(2);
      expect(result.faces[0].family).toBe('Fraunces');
      expect(result.faces.map((f) => f.weight).sort()).toEqual(['400', '900']);
      for (const face of result.faces) {
        expect(face.localPath.startsWith('assets/fonts/')).toBe(true);
        expect(existsSync(join(themeDir, face.localPath))).toBe(true);
        expect(readFileSync(join(themeDir, face.localPath)).subarray(0, 4).toString()).toBe('wOF2');
      }
    } finally {
      rmSync(themeDir, { recursive: true, force: true });
    }
  });

  it('collects per-face errors without throwing', async () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const themeDir = mkdtempSync(join(FIXTURE_TMP, 'fonts-err-'));
    const fetchImpl = (async (url: string | URL) => {
      if (String(url).startsWith('https://fonts.googleapis.com')) return new Response(GOOGLE_CSS, { status: 200 });
      return new Response('nope', { status: 404 });
    }) as typeof fetch;
    try {
      const result = await selfHostGoogleFonts([CSS2_URL], { themeDir, fetchImpl });
      expect(result.faces).toEqual([]);
      expect(result.errors.length).toBe(2);
    } finally {
      rmSync(themeDir, { recursive: true, force: true });
    }
  });

  it('collapses variable-font weight ranges to the first value (space-free filename)', async () => {
    // Variable-axis css2 responses declare `font-weight: 100 900` on one block.
    const VARIABLE_CSS = `
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/fraunces/v1/variable.woff2) format('woff2');
}
`;
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const themeDir = mkdtempSync(join(FIXTURE_TMP, 'fonts-var-'));
    const fetchImpl = (async (url: string | URL) => {
      if (String(url).startsWith('https://fonts.googleapis.com')) return new Response(VARIABLE_CSS, { status: 200 });
      return new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await selfHostGoogleFonts([CSS2_URL], { themeDir, fetchImpl });
      expect(result.errors).toEqual([]);
      expect(result.faces).toHaveLength(1);
      expect(result.faces[0].weight).toBe('100');
      // Filenames are now the gstatic URL basename (unique per subset file).
      expect(result.faces[0].localPath).toBe('assets/fonts/variable.woff2');
      expect(result.faces[0].localPath).not.toContain(' ');
      expect(existsSync(join(themeDir, result.faces[0].localPath))).toBe(true);
      // The localized css keeps the block verbatim with the URL rewritten
      // relative to assets/css/source.css.
      expect(result.localizedCss).toContain('font-weight: 100 900');
      expect(result.localizedCss).toContain('url(../fonts/variable.woff2)');
      expect(result.localizedCss).not.toContain('gstatic.com');
    } finally {
      rmSync(themeDir, { recursive: true, force: true });
    }
  });

  it('keeps every unicode-range subset as its own localized file (metrics parity)', async () => {
    // Real css2 responses emit one @font-face PER SUBSET (latin, latin-ext, ...)
    // with identical family/weight/style but distinct gstatic URLs. Collapsing
    // them to one file measurably changed glyph metrics (walrus probe:
    // Fraunces 337px vs 284px) — every subset must survive verbatim.
    const SUBSET_CSS = `
/* latin-ext */
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/fraunces/v1/latin-ext.woff2) format('woff2');
  unicode-range: U+0100-024F;
}
/* latin */
@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/fraunces/v1/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
`;
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const themeDir = mkdtempSync(join(FIXTURE_TMP, 'fonts-subset-'));
    const fontFetches: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith('https://fonts.googleapis.com')) return new Response(SUBSET_CSS, { status: 200 });
      fontFetches.push(u);
      return new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await selfHostGoogleFonts([CSS2_URL], { themeDir, fetchImpl });
      expect(result.errors).toEqual([]);
      expect(result.faces).toHaveLength(2);          // one per subset file
      expect(fontFetches).toHaveLength(2);           // each distinct URL downloaded
      expect(readdirSync(join(themeDir, 'assets/fonts')).sort()).toEqual(['latin-ext.woff2', 'latin.woff2']);
      // Verbatim localization: both blocks survive with unicode-range intact
      // and URLs rewritten relative to assets/css/source.css.
      expect(result.localizedCss).toContain('unicode-range: U+0100-024F');
      expect(result.localizedCss).toContain('unicode-range: U+0000-00FF');
      expect(result.localizedCss).toContain('url(../fonts/latin.woff2)');
      expect(result.localizedCss).toContain('url(../fonts/latin-ext.woff2)');
      expect(result.localizedCss).not.toContain('gstatic.com');
    } finally {
      rmSync(themeDir, { recursive: true, force: true });
    }
  });

  it('blocks private/internal face URLs (SSRF guard) without fetching them', async () => {
    const EVIL_CSS = `
@font-face {
  font-family: 'Evil';
  font-style: normal;
  font-weight: 400;
  src: url(http://169.254.169.254/x.woff2) format('woff2');
}
`;
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const themeDir = mkdtempSync(join(FIXTURE_TMP, 'fonts-ssrf-'));
    const fetchedUrls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      fetchedUrls.push(String(url));
      if (String(url).startsWith('https://fonts.googleapis.com')) return new Response(EVIL_CSS, { status: 200 });
      return new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await selfHostGoogleFonts([CSS2_URL], { themeDir, fetchImpl });
      expect(result.faces).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].url).toBe('http://169.254.169.254/x.woff2');
      expect(fetchedUrls).toEqual([CSS2_URL]); // the face URL was never fetched
    } finally {
      rmSync(themeDir, { recursive: true, force: true });
    }
  });
});
