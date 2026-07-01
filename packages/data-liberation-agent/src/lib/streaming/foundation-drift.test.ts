import { describe, it, expect } from 'vitest';
import { computeInputsDigest, driftScore } from './foundation-drift.js';

const baselinePalette = {
  version: 1,
  sampledUrls: 4,
  colors: [
    { hex: '#111111', count: 10, urls: 4 },
    { hex: '#fefefe', count: 9, urls: 4 },
  ],
};
const baselineTypography = {
  version: 1,
  sampledUrls: 4,
  bySelector: {
    body: [{ fontFamily: 'Inter', fontSize: '16px', fontWeight: '400', lineHeight: '24px', urls: 4 }],
  },
};
const baselineBreakpoints = { version: 1, sampledUrls: 4, minWidth: [768, 1024], maxWidth: [] };

describe('computeInputsDigest', () => {
  it('returns a sha256:<hex64> digest', () => {
    const d = computeInputsDigest(baselinePalette, baselineTypography, baselineBreakpoints);
    expect(d).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is stable across key reorderings', () => {
    const a = computeInputsDigest(baselinePalette, baselineTypography, baselineBreakpoints);
    // Reorder top-level keys of palette
    const reordered = { sampledUrls: 4, colors: baselinePalette.colors, version: 1 as const };
    const b = computeInputsDigest(reordered, baselineTypography, baselineBreakpoints);
    expect(a).toBe(b);
  });

  it('changes when palette content changes', () => {
    const a = computeInputsDigest(baselinePalette, baselineTypography, baselineBreakpoints);
    const shifted = {
      ...baselinePalette,
      colors: [...baselinePalette.colors, { hex: '#ff0000', count: 5, urls: 4 }],
    };
    const b = computeInputsDigest(shifted, baselineTypography, baselineBreakpoints);
    expect(a).not.toBe(b);
  });

  it('changes when typography changes', () => {
    const a = computeInputsDigest(baselinePalette, baselineTypography, baselineBreakpoints);
    const shifted = {
      ...baselineTypography,
      bySelector: {
        body: [
          { fontFamily: 'Roboto', fontSize: '16px', fontWeight: '400', lineHeight: '24px', urls: 4 },
        ],
      },
    };
    const b = computeInputsDigest(baselinePalette, shifted, baselineBreakpoints);
    expect(a).not.toBe(b);
  });

  it('changes when breakpoints change', () => {
    const a = computeInputsDigest(baselinePalette, baselineTypography, baselineBreakpoints);
    const shifted = { ...baselineBreakpoints, minWidth: [1024, 1280] };
    const b = computeInputsDigest(baselinePalette, baselineTypography, shifted);
    expect(a).not.toBe(b);
  });
});

describe('driftScore', () => {
  it('returns 0 when current inputs hash matches prevDigest', () => {
    const digest = computeInputsDigest(baselinePalette, baselineTypography, baselineBreakpoints);
    const score = driftScore(digest, {
      palette: baselinePalette,
      typography: baselineTypography,
      breakpoints: baselineBreakpoints,
    });
    expect(score).toBe(0);
  });

  it('returns > 1 when palette has shifted (re-rev needed)', () => {
    const digest = computeInputsDigest(baselinePalette, baselineTypography, baselineBreakpoints);
    const shifted = {
      ...baselinePalette,
      colors: [...baselinePalette.colors, { hex: '#00ffaa', count: 7, urls: 3 }],
    };
    const score = driftScore(digest, {
      palette: shifted,
      typography: baselineTypography,
      breakpoints: baselineBreakpoints,
    });
    expect(score).toBeGreaterThan(1);
  });

  it('returns > 1 when typography has a font-family change', () => {
    const digest = computeInputsDigest(baselinePalette, baselineTypography, baselineBreakpoints);
    const shifted = {
      ...baselineTypography,
      bySelector: {
        body: [
          { fontFamily: 'Comic Sans', fontSize: '16px', fontWeight: '400', lineHeight: '24px', urls: 4 },
        ],
      },
    };
    const score = driftScore(digest, {
      palette: baselinePalette,
      typography: shifted,
      breakpoints: baselineBreakpoints,
    });
    expect(score).toBeGreaterThan(1);
  });

  it('returns > 1 when prevDigest is empty (first run)', () => {
    const score = driftScore('', {
      palette: baselinePalette,
      typography: baselineTypography,
      breakpoints: baselineBreakpoints,
    });
    expect(score).toBeGreaterThan(1);
  });
});
