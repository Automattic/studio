import { describe, it, expect } from 'vitest';
import { pickBrandDark, contrastTextColor, relativeLuminance } from './brand-color.js';

// Sample palette from the spec (Wix site)
const SAMPLE_PALETTE = [
  { hex: '#ffffff', count: 57 },
  { hex: '#175236', count: 6 },
  { hex: '#757575', count: 5 },
  { hex: '#000000', count: 3 },
];

describe('pickBrandDark', () => {
  it('picks #175236 (dark green) from the sample palette', () => {
    // #ffffff is near-white → excluded
    // #757575 is near-gray (low saturation) → excluded
    // #000000 is near-gray (no saturation) → excluded
    // #175236 is chromatic → wins (count=6)
    expect(pickBrandDark(SAMPLE_PALETTE)).toBe('#175236');
  });

  it('returns null for an empty palette', () => {
    expect(pickBrandDark([])).toBeNull();
  });

  it('returns null when all colors are near-white', () => {
    expect(pickBrandDark([
      { hex: '#ffffff', count: 10 },
      { hex: '#fafafa', count: 5 },
      { hex: '#f5f5f5', count: 3 },
    ])).toBeNull();
  });

  it('excludes near-white colors (luminance > 0.85)', () => {
    // Pure white has luminance 1.0
    const result = pickBrandDark([
      { hex: '#ffffff', count: 100 },
      { hex: '#003366', count: 1 },
    ]);
    expect(result).toBe('#003366');
  });

  it('excludes near-gray colors (low saturation)', () => {
    // #808080 is a pure gray — max-min = 0
    // #888888 is also pure gray
    const result = pickBrandDark([
      { hex: '#808080', count: 10 },
      { hex: '#888888', count: 8 },
      { hex: '#1a5276', count: 2 },
    ]);
    expect(result).toBe('#1a5276');
  });

  it('falls back to darkest non-near-white when no chromatic color qualifies', () => {
    // All gray/black palette; should pick #000000 (darkest)
    const result = pickBrandDark([
      { hex: '#cccccc', count: 10 },
      { hex: '#888888', count: 6 },
      { hex: '#000000', count: 3 },
    ]);
    expect(result).toBe('#000000');
  });

  it('picks the chromatic color with the highest count, not the first', () => {
    const result = pickBrandDark([
      { hex: '#ffffff', count: 100 },
      { hex: '#003366', count: 2 },
      { hex: '#8b1c1c', count: 5 },  // chromatic, higher count
    ]);
    expect(result).toBe('#8b1c1c');
  });

  it('handles a single-color palette that is chromatic', () => {
    expect(pickBrandDark([{ hex: '#175236', count: 1 }])).toBe('#175236');
  });

  it('handles hex without leading # prefix gracefully', () => {
    // Our helper functions should still parse it
    const result = pickBrandDark([{ hex: 'ffffff', count: 5 }, { hex: '175236', count: 2 }]);
    // #ffffff excluded as near-white; 175236 is chromatic
    expect(result).toBe('175236');
  });
});

describe('contrastTextColor', () => {
  it('returns white for a dark background (#175236, dark green)', () => {
    expect(contrastTextColor('#175236')).toBe('#ffffff');
  });

  it('returns white for pure black', () => {
    expect(contrastTextColor('#000000')).toBe('#ffffff');
  });

  it('returns dark for pure white', () => {
    expect(contrastTextColor('#ffffff')).toBe('#111111');
  });

  it('returns dark for a light background', () => {
    expect(contrastTextColor('#f5f5f5')).toBe('#111111');
  });

  it('returns #111111 on unparseable input (safe fallback)', () => {
    expect(contrastTextColor('transparent')).toBe('#111111');
    expect(contrastTextColor('rgba(0,0,0,0)')).toBe('#111111');
  });
});

describe('relativeLuminance', () => {
  it('returns 1 for white', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 4);
  });

  it('returns 0 for black', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 4);
  });

  it('returns null for non-hex input', () => {
    expect(relativeLuminance('transparent')).toBeNull();
    expect(relativeLuminance('rgb(0,0,0)')).toBeNull();
  });
});
