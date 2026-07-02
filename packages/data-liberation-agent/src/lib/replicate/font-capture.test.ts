import { describe, expect, it } from 'vitest';
import type { LocalFontFace } from '@automattic/blocks-engine/theme';
import { buildThemeFontFamilies, baseFamilyName } from './font-capture.js';

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
