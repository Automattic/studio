import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCarryDesignTokens } from './carry-design-tokens.js';

describe('loadCarryDesignTokens', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dla-tokens-'));
    // Fictional captured aggregates ([[feedback_no_source_data_in_tests]]).
    writeFileSync(
      join(dir, 'palette.json'),
      JSON.stringify({ colors: [{ hex: '#ffffff', count: 9 }, { hex: '#123456', count: 4 }, { hex: 'aabbcc', count: 1 }, { hex: '#abcde', count: 1 }] }),
    );
    writeFileSync(
      join(dir, 'typography.json'),
      JSON.stringify({
        bySelector: {
          h1: [{ fontFamily: 'BrandSans, sans-serif' }],
          body: [{ fontFamily: 'BrandSerif, serif' }],
          h2: [{ fontFamily: 'BrandSans, sans-serif' }], // dup family → one token
        },
      }),
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('maps palette colors to c1..cN tokens, normalizing bare hex', () => {
    const t = loadCarryDesignTokens(dir);
    expect(t.paletteTokens).toEqual([
      { slug: 'c1', hex: '#ffffff' },
      { slug: 'c2', hex: '#123456' },
      { slug: 'c3', hex: '#aabbcc' },
    ]);
    expect(t.themeJsonPalette[0]).toEqual({ slug: 'c1', name: 'Replica 1', color: '#ffffff' });
  });

  it('dedupes font families by first token and slugs them', () => {
    const t = loadCarryDesignTokens(dir);
    expect(t.fontFamilies).toEqual([
      { slug: 'brandsans', family: 'BrandSans, sans-serif' },
      { slug: 'brandserif', family: 'BrandSerif, serif' },
    ]);
    expect(t.themeJsonFontFamilies[0]).toEqual({ slug: 'brandsans', name: 'BrandSans', fontFamily: 'BrandSans, sans-serif' });
  });

  it('caps palette tokens at maxColors', () => {
    expect(loadCarryDesignTokens(dir, 2).paletteTokens.map((p) => p.slug)).toEqual(['c1', 'c2']);
  });

  it('returns empty arrays when the aggregates are absent', () => {
    const empty = loadCarryDesignTokens(join(tmpdir(), 'dla-nope-does-not-exist'));
    expect(empty.paletteTokens).toEqual([]);
    expect(empty.fontFamilies).toEqual([]);
  });
});
