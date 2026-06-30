import { describe, expect, it } from 'vitest';
import {
  buildFontFaceCss,
  consolidateFontFaces,
  matchCapturedFamily,
  parseCapturedFontFaces,
  type CapturedParsedFontFace,
  type LocalFontFace,
} from '@automattic/blocks-engine/theme';

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

describe('font capture engine adoption', () => {
  it('uses engine parseCapturedFontFaces for DLA capture semantics', () => {
    const faces = parseCapturedFontFaces(GETSNOOZ_CSS);

    expect(faces).toEqual([
      {
        family: 'Larsseit',
        src: 'https://cdn.shopify.com/s/files/1/1378/8621/files/Larsseit-Regular.woff',
        format: 'woff',
        weight: '400',
        style: 'normal',
      },
      {
        family: 'Larsseit Bold',
        src: 'https://cdn.shopify.com/s/files/1/1378/8621/files/Larsseit-Bold.woff',
        format: 'woff',
        weight: '700',
        style: 'normal',
      },
    ]);
  });

  it('normalizes parsed faces and deduplicates identical rules', () => {
    const css = `
      @font-face {
        font-family: "Acme";
        src: url(/fonts/acme.woff) format("woff"), url(/fonts/acme.woff2) format("woff2");
        font-weight: bold;
        font-style: italic;
      }
      @font-face {
        font-family: "Acme";
        src: url(/fonts/acme.woff) format("woff"), url(/fonts/acme.woff2) format("woff2");
        font-weight: 700;
        font-style: italic;
      }
      @font-face {
        font-family: "Broken";
        src: url(/fonts/broken.txt);
      }
    `;

    expect(parseCapturedFontFaces(css)).toEqual([
      {
        family: 'Acme',
        src: '/fonts/acme.woff2',
        format: 'woff2',
        weight: '700',
        style: 'italic',
      },
    ]);
  });

  it('uses engine consolidateFontFaces for alias collapse and clean URL preference', () => {
    const faces: CapturedParsedFontFace[] = [
      { family: 'Larsseit', src: 'https://cdn.shopify.com/Larsseit-Regular.woff', format: 'woff', weight: '400', style: 'normal' },
      { family: 'Larsseit Bold', src: 'https://cdn.shopify.com/Larsseit-Bold.woff', format: 'woff', weight: '700', style: 'normal' },
      { family: 'Larsseit-Bold', src: 'https://cdn.shopify.com/Larsseit-Bold_abc12345.woff', format: 'woff', weight: '400', style: 'normal' },
      { family: 'Larsseit-Bold', src: 'https://cdn.shopify.com/Larsseit-Bold.woff2', format: 'woff2', weight: '400', style: 'normal' },
    ];

    expect(consolidateFontFaces(faces)).toEqual([
      { family: 'Larsseit', src: 'https://cdn.shopify.com/Larsseit-Regular.woff', format: 'woff', weight: '400', style: 'normal' },
      { family: 'Larsseit', src: 'https://cdn.shopify.com/Larsseit-Bold.woff2', format: 'woff2', weight: '700', style: 'normal' },
    ]);
  });

  it('uses engine matchCapturedFamily for exact, suffix-tolerant, and miss cases', () => {
    const faces: CapturedParsedFontFace[] = [
      { family: 'Larsseit', src: 'l.woff', format: 'woff', weight: '400', style: 'normal' },
      { family: 'futura-lt-w01', src: 'f.woff2', format: 'woff2', weight: '400', style: 'normal' },
      { family: 'avenir-lt-w01_35-light1475496', src: 'a.woff2', format: 'woff2', weight: '300', style: 'normal' },
    ];

    expect(matchCapturedFamily('Larsseit, sans-serif', faces)).toBe('Larsseit');
    expect(matchCapturedFamily('futura-lt-w01-book, sans-serif', faces)).toBe('futura-lt-w01');
    expect(matchCapturedFamily('avenir-lt-w01_35-light1475496, sans-serif', faces)).toBe('avenir-lt-w01_35-light1475496');
    expect(matchCapturedFamily('Poppins, sans-serif', faces)).toBeNull();
    expect(matchCapturedFamily(null, faces)).toBeNull();
  });

  it('uses engine buildFontFaceCss for local asset font-face CSS', () => {
    const faces: LocalFontFace[] = [
      {
        family: 'Larsseit',
        src: 'https://cdn.shopify.com/Larsseit-Regular.woff',
        format: 'woff',
        weight: '400',
        style: 'normal',
        localPath: 'assets/fonts/Larsseit-Regular.woff',
      },
    ];

    expect(buildFontFaceCss(faces)).toBe(`
/*
 * Self-hosted source fonts. Captured from the source site's @font-face
 * declarations and downloaded into assets/fonts/ so headings + body render in
 * the real typeface rather than a system fallback.
 */
@font-face {
\tfont-family: 'Larsseit';
\tsrc: url('assets/fonts/Larsseit-Regular.woff') format('woff');
\tfont-weight: 400;
\tfont-style: normal;
\tfont-display: swap;
}
`);
  });
});
