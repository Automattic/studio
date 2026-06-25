import { describe, it, expect } from 'vitest';
import { colorDeltaE2000 } from './color-delta.js';

describe('colorDeltaE2000', () => {
  it('is 0 for identical colors', () => {
    expect(colorDeltaE2000('rgb(10, 20, 30)', 'rgb(10, 20, 30)')).toBeCloseTo(0, 5);
  });
  it('is ~100 for black vs white (pure lightness axis)', () => {
    expect(colorDeltaE2000('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBeCloseTo(100, 0);
  });
  it('is small for two near-identical greys (below the parity floor)', () => {
    expect(colorDeltaE2000('rgb(200, 200, 200)', 'rgb(205, 205, 205)')).toBeLessThan(5);
  });
  it('is above the parity floor for a pale-blue band rendered white', () => {
    // the corneliusholmes failure mode: a tinted band flattened to white
    expect(colorDeltaE2000('rgb(200, 220, 255)', 'rgb(255, 255, 255)')).toBeGreaterThan(10);
  });
  it('parses rgba() and ignores alpha', () => {
    expect(colorDeltaE2000('rgba(10, 20, 30, 0.5)', 'rgb(10, 20, 30)')).toBeCloseTo(0, 5);
  });
  it('treats an unparseable color as maximally different (flagged, not silently equal)', () => {
    expect(colorDeltaE2000('not-a-color', 'rgb(255, 255, 255)')).toBe(Number.POSITIVE_INFINITY);
  });
});
