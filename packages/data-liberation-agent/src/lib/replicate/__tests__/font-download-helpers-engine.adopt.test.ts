import { describe, expect, it } from 'vitest';
import {
  absolutizeFontUrl,
  fontFilename,
  type CapturedParsedFontFace,
} from '@automattic/blocks-engine/theme';

describe('font download helper engine adoption', () => {
  it('keeps DLA golden URL absolutization behavior', () => {
    expect(absolutizeFontUrl('fonts/Larsseit-Regular.woff', 'https://example.com/theme/css/site.css')).toBe(
      'https://example.com/theme/css/fonts/Larsseit-Regular.woff',
    );
    expect(absolutizeFontUrl('/assets/fonts/Larsseit-Bold.woff2', 'https://example.com/pages/home/')).toBe(
      'https://example.com/assets/fonts/Larsseit-Bold.woff2',
    );
    expect(absolutizeFontUrl('//cdn.example.com/inter.woff2?ver=1#hash', 'https://example.com')).toBe(
      'https://cdn.example.com/inter.woff2?ver=1#hash',
    );
    expect(absolutizeFontUrl('https://cdn.example.com/fonts/display-serif.ttf?abc=123')).toBe(
      'https://cdn.example.com/fonts/display-serif.ttf?abc=123',
    );
    expect(absolutizeFontUrl('../fonts/mono.otf', 'https://example.com/assets/css/main.css')).toBe(
      'https://example.com/assets/fonts/mono.otf',
    );
    expect(absolutizeFontUrl('relative/no-base.woff2')).toBe('relative/no-base.woff2');
  });

  it('keeps DLA golden filename derivation behavior', () => {
    const faces: CapturedParsedFontFace[] = [
      {
        family: 'Larsseit',
        src: 'https://cdn.shopify.com/fonts/Larsseit-Regular.woff?ver=1',
        format: 'woff',
        weight: '400',
        style: 'normal',
      },
      {
        family: 'Display Serif',
        src: 'https://cdn.example.com/fonts/display serif.ttf',
        format: 'ttf',
        weight: '900',
        style: 'italic',
      },
      {
        family: 'No Extension Face',
        src: 'https://cdn.example.com/font?id=abc',
        format: 'woff2',
        weight: '500',
        style: 'normal',
      },
      {
        family: 'Italic Family',
        src: 'font-without-extension',
        format: 'otf',
        weight: '300',
        style: 'italic',
      },
    ];

    expect(faces.map(fontFilename)).toEqual([
      'Larsseit-Regular.woff',
      'display_serif.ttf',
      'No-Extension-Face-500.woff2',
      'Italic-Family-300-italic.otf',
    ]);
  });
});
