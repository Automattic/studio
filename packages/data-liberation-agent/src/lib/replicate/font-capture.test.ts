import { describe, expect, it } from 'vitest';
import {
  parseFontFaces,
  absolutizeFontUrl,
  fontFilename,
  buildFontFaceCss,
  buildThemeFontFamilies,
  matchCapturedFamily,
  baseFamilyName,
  consolidateFontFaces,
  type LocalFontFace,
  type ParsedFontFace,
} from './font-capture.js';

// Mirrors the real getsnooz.com @font-face declarations (Shopify CDN).
const GETSNOOZ_CSS = `
@font-face {
  font-family: 'Larsseit';
  src: url(https://cdn.shopify.com/s/files/1/1378/8621/files/Larsseit-Regular.woff);
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Larsseit Bold';
  src: url(https://cdn.shopify.com/s/files/1/1378/8621/files/Larsseit-Bold.woff);
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Kanit-Klaviyo-Hosted';
  src: url(https://static.klaviyo.com/onsite/hosted-fonts/Kanit/latin/kanit_latin_regular_700.woff2);
  font-weight: 700;
  font-style: normal;
}
`;

describe('parseFontFaces', () => {
  it('extracts source @font-face rules with family, src, weight, style', () => {
    const faces = parseFontFaces(GETSNOOZ_CSS);
    const families = faces.map((f) => f.family);
    expect(families).toContain('Larsseit');
    expect(families).toContain('Larsseit Bold');

    const regular = faces.find((f) => f.family === 'Larsseit');
    expect(regular).toMatchObject({
      family: 'Larsseit',
      src: 'https://cdn.shopify.com/s/files/1/1378/8621/files/Larsseit-Regular.woff',
      format: 'woff',
      weight: '400',
      style: 'normal',
    });
  });

  it('drops third-party widget fonts (Klaviyo) and CSS generics', () => {
    const faces = parseFontFaces(GETSNOOZ_CSS);
    expect(faces.find((f) => /klaviyo/i.test(f.src))).toBeUndefined();
    expect(faces.find((f) => f.family.toLowerCase() === 'sans-serif')).toBeUndefined();
  });

  it('normalizes keyword weights and prefers woff2 when multiple urls listed', () => {
    const css = `@font-face {
      font-family: "Acme";
      src: url(/fonts/acme.woff) format("woff"), url(/fonts/acme.woff2) format("woff2");
      font-weight: bold;
      font-style: italic;
    }`;
    const [face] = parseFontFaces(css);
    expect(face.format).toBe('woff2');
    expect(face.src).toBe('/fonts/acme.woff2');
    expect(face.weight).toBe('700');
    expect(face.style).toBe('italic');
  });

  it('deduplicates identical faces across multiple inputs', () => {
    const faces = parseFontFaces(GETSNOOZ_CSS, GETSNOOZ_CSS);
    expect(faces.filter((f) => f.family === 'Larsseit')).toHaveLength(1);
  });

  it('returns empty for input without @font-face', () => {
    expect(parseFontFaces('body { color: red; }')).toEqual([]);
    expect(parseFontFaces('')).toEqual([]);
  });

  it('normalizes bogus font-weight/font-style "undefined" (Replo) to sane values', () => {
    // Replo injects @font-face rules with literal `font-weight: undefined`.
    const css = `@font-face {
      font-family: "Larsseit-Bold";
      src: url("https://cdn.shopify.com/x/Larsseit-Bold_abc12345.woff") format("woff");
      font-weight: undefined;
      font-style: undefined;
    }`;
    const [face] = parseFontFaces(css);
    expect(face.weight).toBe('400'); // unparseable → default
    expect(face.style).toBe('normal'); // "undefined" → normal
  });

  it('collapses Replo hash-alias Larsseit faces into 2 deduped weights', () => {
    const css = `
      @font-face { font-family: 'Larsseit'; src: url(https://cdn.shopify.com/Larsseit-Regular.woff); font-weight: 400; font-style: normal; }
      @font-face { font-family: 'Larsseit Bold'; src: url(https://cdn.shopify.com/Larsseit-Bold.woff); font-weight: 700; font-style: normal; }
      @font-face { font-family: "Larsseit-Bold"; src: url("https://cdn.shopify.com/Larsseit-Bold_abc12345.woff"); font-weight: undefined; font-style: undefined; }
      @font-face { font-family: "Larsseit-Regular"; src: url("https://cdn.shopify.com/Larsseit-Regular_def67890.woff"); font-weight: undefined; font-style: undefined; }
    `;
    const consolidated = consolidateFontFaces(parseFontFaces(css));
    expect(consolidated).toHaveLength(2);
    expect(new Set(consolidated.map((f) => f.weight))).toEqual(new Set(['400', '700']));
    expect(consolidated.every((f) => f.family === 'Larsseit' && f.style === 'normal')).toBe(true);
    // Prefers the clean (no-hash) URL.
    expect(consolidated.find((f) => f.weight === '700')!.src).toBe('https://cdn.shopify.com/Larsseit-Bold.woff');
  });
});

describe('absolutizeFontUrl', () => {
  it('expands protocol-relative urls to https', () => {
    expect(absolutizeFontUrl('//cdn.shopify.com/x.woff')).toBe('https://cdn.shopify.com/x.woff');
  });
  it('passes through absolute urls', () => {
    expect(absolutizeFontUrl('https://cdn.shopify.com/x.woff')).toBe('https://cdn.shopify.com/x.woff');
  });
  it('resolves relative urls against a base', () => {
    expect(absolutizeFontUrl('/fonts/a.woff', 'https://site.com/')).toBe('https://site.com/fonts/a.woff');
  });
});

describe('fontFilename', () => {
  it('uses the url segment when it carries a font extension', () => {
    expect(
      fontFilename({ family: 'Larsseit', src: 'https://cdn.shopify.com/s/files/1/Larsseit-Regular.woff', format: 'woff', weight: '400', style: 'normal' }),
    ).toBe('Larsseit-Regular.woff');
  });
  it('synthesizes a name when the url has no usable segment', () => {
    expect(
      fontFilename({ family: 'Larsseit Bold', src: 'https://cdn/x?id=1', format: 'woff', weight: '700', style: 'italic' }),
    ).toBe('Larsseit-Bold-700-italic.woff');
  });
});

describe('buildFontFaceCss', () => {
  it('emits @font-face rules pointing at local asset paths with format()', () => {
    const faces: LocalFontFace[] = [
      { family: 'Larsseit', src: 'x', format: 'woff', weight: '400', style: 'normal', localPath: 'assets/fonts/Larsseit-Regular.woff' },
    ];
    const css = buildFontFaceCss(faces);
    expect(css).toContain("font-family: 'Larsseit'");
    expect(css).toContain("src: url('assets/fonts/Larsseit-Regular.woff') format('woff')");
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-display: swap');
  });
  it('returns empty string for no faces', () => {
    expect(buildFontFaceCss([])).toBe('');
  });
});

describe('buildThemeFontFamilies', () => {
  it('groups faces by family with fontFace entries and a fallback stack', () => {
    const faces: LocalFontFace[] = [
      { family: 'Larsseit', src: 'x', format: 'woff', weight: '400', style: 'normal', localPath: 'assets/fonts/Larsseit-Regular.woff' },
      { family: 'Larsseit', src: 'y', format: 'woff', weight: '700', style: 'normal', localPath: 'assets/fonts/Larsseit-Bold.woff' },
    ];
    const fams = buildThemeFontFamilies(faces, { fallback: 'sans-serif' });
    expect(fams).toHaveLength(1);
    expect(fams[0]).toMatchObject({ fontFamily: 'Larsseit, sans-serif', name: 'Larsseit', slug: 'larsseit' });
    expect(fams[0].fontFace).toHaveLength(2);
    expect(fams[0].fontFace?.[0].src[0]).toBe('file:./assets/fonts/Larsseit-Regular.woff');
  });

  it('picks a serif vs sans generic fallback by family name (so a serif heading degrades to serif, not Arial)', () => {
    const faces: LocalFontFace[] = [
      { family: 'Libre Baskerville', src: 'x', format: 'woff2', weight: '400', style: 'normal', localPath: 'assets/fonts/lb.woff2' },
      { family: 'Inter', src: 'y', format: 'woff2', weight: '400', style: 'normal', localPath: 'assets/fonts/inter.woff2' },
    ];
    const fams = buildThemeFontFamilies(faces); // no explicit fallback → auto-detect
    const lb = fams.find((f) => f.name === 'Libre Baskerville')!;
    const inter = fams.find((f) => f.name === 'Inter')!;
    expect(lb.fontFamily).toBe('Libre Baskerville, serif');
    expect(inter.fontFamily).toBe('Inter, sans-serif');
  });
});

describe('baseFamilyName', () => {
  it('strips weight/style suffixes to a base family', () => {
    expect(baseFamilyName('Larsseit Bold')).toBe('Larsseit');
    expect(baseFamilyName('Larsseit-Bold')).toBe('Larsseit');
    expect(baseFamilyName('Larsseit')).toBe('Larsseit');
    expect(baseFamilyName('Inter Medium Italic')).toBe('Inter');
  });
});

describe('consolidateFontFaces', () => {
  it('collapses per-weight family aliases into one base family with weighted faces', () => {
    const faces: ParsedFontFace[] = [
      { family: 'Larsseit', src: 'a.woff', format: 'woff', weight: '400', style: 'normal' },
      { family: 'Larsseit Bold', src: 'b.woff', format: 'woff', weight: '700', style: 'normal' },
      { family: 'Larsseit-Bold', src: 'b2.woff', format: 'woff', weight: '700', style: 'normal' },
    ];
    const out = consolidateFontFaces(faces);
    expect(out.map((f) => f.family)).toEqual(['Larsseit', 'Larsseit']);
    expect(new Set(out.map((f) => f.weight))).toEqual(new Set(['400', '700']));
    expect(new Set(out.map((f) => f.family))).toEqual(new Set(['Larsseit']));
  });

  it('derives weight from a family-name suffix when declared weight is generic', () => {
    const faces: ParsedFontFace[] = [
      { family: 'Larsseit-Bold', src: 'b.woff', format: 'woff', weight: '400', style: 'normal' },
    ];
    const [out] = consolidateFontFaces(faces);
    expect(out.family).toBe('Larsseit');
    expect(out.weight).toBe('700');
  });
});

describe('matchCapturedFamily', () => {
  const faces = parseFontFaces(GETSNOOZ_CSS);
  it('matches the first token of a requested stack case-insensitively', () => {
    expect(matchCapturedFamily('Larsseit, sans-serif', faces)).toBe('Larsseit');
    expect(matchCapturedFamily('larsseit', faces)).toBe('Larsseit');
  });
  it('returns null when no captured family matches', () => {
    expect(matchCapturedFamily('Poppins, sans-serif', faces)).toBeNull();
    expect(matchCapturedFamily(null, faces)).toBeNull();
  });
  it('matches a variant-suffixed observed family to the base captured family', () => {
    // The capture pipeline derives a suffix-free family ("futura-lt-w01") while
    // the source's computed style carries a weight/style suffix or builder hash
    // ("futura-lt-w01-book", "avenir-lt-w01_35-light1475496"). These must match
    // so the real self-hosted font is used instead of substituting a generic.
    const variant: ParsedFontFace[] = [
      { family: 'futura-lt-w01', src: 'f.woff2', format: 'woff2', weight: '400', style: 'normal' },
      { family: 'avenir-lt-w01_35-light1475496', src: 'a.woff2', format: 'woff2', weight: '300', style: 'normal' },
    ];
    expect(matchCapturedFamily('futura-lt-w01-book, sans-serif', variant)).toBe('futura-lt-w01');
    expect(matchCapturedFamily('avenir-lt-w01_35-light1475496, sans-serif', variant)).toBe('avenir-lt-w01_35-light1475496');
    // A genuinely different family still does not match.
    expect(matchCapturedFamily('helvetica-w02-bold', variant)).toBeNull();
  });
});
