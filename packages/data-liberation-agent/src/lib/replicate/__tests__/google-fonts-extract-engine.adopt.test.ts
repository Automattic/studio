import { describe, expect, it } from 'vitest';
import { extractGoogleFontCssUrls } from '@automattic/blocks-engine/theme';

describe('google fonts extractor engine adoption', () => {
  it('uses the engine helper for mixed Google css/css2 sources', () => {
    const css2Url = 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;900&display=swap';
    const cssUrl = 'https://fonts.googleapis.com/css?family=Roboto:400,700&display=swap';
    const ampUrl = 'https://fonts.googleapis.com/css2?family=Work+Sans:wght@300;600&amp;display=swap';

    expect(
      extractGoogleFontCssUrls([
        `<link rel="stylesheet" href="${css2Url}">`,
        `@import url('${css2Url}'); body { color: red; }`,
        `@import url(${cssUrl});`,
        `<link href="${ampUrl}">`,
      ]),
    ).toEqual([
      css2Url,
      cssUrl,
      'https://fonts.googleapis.com/css2?family=Work+Sans:wght@300;600&display=swap',
    ]);
  });

  it('preserves query-string variants and insertion order while deduping', () => {
    const inter = 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&subset=latin&display=swap';
    const libre = 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;1,700&display=swap';
    const openSans = 'https://fonts.googleapis.com/css?family=Open+Sans:ital,wght@0,400;1,700&text=HelloWorld';

    expect(
      extractGoogleFontCssUrls([
        `preload ${inter}`,
        `@import "${openSans}";`,
        `<link href="${libre.replace(/&/g, '&amp;')}">`,
        `again ${inter}`,
      ]),
    ).toEqual([inter, openSans, libre]);
  });

  it('returns empty for sources without Google Fonts URLs', () => {
    expect(extractGoogleFontCssUrls(['<link href="styles.css">', 'body { font-family: system-ui; }'])).toEqual([]);
  });
});
