// src/lib/replicate/local-theme/foundation.test.ts
import { describe, it, expect } from 'vitest';
import { buildLocalFoundation, extractCssColors } from './foundation.js';

const palette = {
  version: 1 as const,
  sampledUrls: 4,
  colors: [
    { hex: '#f7f2e9', count: 400, urls: 4 }, // cream — lightest, high freq
    { hex: '#0e2a30', count: 380, urls: 4 }, // ink — darkest, high freq
    { hex: '#e2573b', count: 120, urls: 4 }, // coral — saturated accent
    { hex: '#135e6b', count: 90, urls: 4 },  // teal
    { hex: '#00ff00', count: 2, urls: 1 },   // noise — below url floor
  ],
};
const typography = {
  version: 1 as const,
  sampledUrls: 4,
  bySelector: {
    body: [{ fontFamily: '"Work Sans", sans-serif', fontSize: '17px', fontWeight: '400', lineHeight: '28px', urls: 4 }],
    h1: [{ fontFamily: 'Fraunces, Georgia, serif', fontSize: '70px', fontWeight: '900', lineHeight: '76px', urls: 4 }],
  },
};
const breakpoints = { version: 1 as const, sampledUrls: 4, minWidth: [768], maxWidth: [1024] };

describe('buildLocalFoundation', () => {
  const { foundation, footerBgToken, footerTextToken } = buildLocalFoundation({ palette, typography, breakpoints });

  it('picks dark text on light surface with a saturated accent', () => {
    expect(foundation.color?.text?.default?.value).toBe('#0e2a30');
    expect(foundation.color?.surface?.base?.value).toBe('#f7f2e9');
    expect(foundation.color?.accent?.primary?.value).toBe('#e2573b');
    expect(foundation.color?.surface?.inverse?.value).toBe('#0e2a30');
    expect(foundation.color?.text?.inverse?.value).toBe('#f7f2e9');
  });

  it('maps body and display families from typography aggregates', () => {
    expect(foundation.typography?.families?.body?.value).toContain('Work Sans');
    expect(foundation.typography?.families?.display?.value).toContain('Fraunces');
  });

  it('derives button component from the accent', () => {
    expect(foundation.components?.button?.background).toBe('#e2573b');
  });

  it('emits footer tokens for the theme scaffold', () => {
    expect(footerBgToken).toBe('surface-inverse');
    expect(footerTextToken).toBe('text-inverse');
  });

  it('ignores below-floor noise colors and is deterministic', () => {
    const again = buildLocalFoundation({ palette, typography, breakpoints });
    expect(again.foundation).toEqual(foundation);
    expect(JSON.stringify(foundation)).not.toContain('#00ff00');
  });

  it('orients surface/text for dark sites (dominant dark background)', () => {
    const dark = buildLocalFoundation({
      palette: {
        version: 1,
        sampledUrls: 4,
        colors: [
          { hex: '#1a1a1a', count: 400, urls: 4 }, // near-black bg — dominant
          { hex: '#f0f0f0', count: 350, urls: 4 }, // near-white text
          { hex: '#4ea1ff', count: 80, urls: 4 },  // blue accent
        ],
      },
      typography,
      breakpoints,
    });
    expect(dark.foundation.color?.surface?.base?.value).toBe('#1a1a1a');
    expect(dark.foundation.color?.text?.default?.value).toBe('#f0f0f0');
    expect(dark.foundation.color?.accent?.primary?.value).toBe('#4ea1ff');
    // contrast partners: footer band contrasts the page
    expect(dark.foundation.color?.surface?.inverse?.value).toBe('#f0f0f0');
    expect(dark.foundation.color?.text?.inverse?.value).toBe('#1a1a1a');
  });

  it('handles an achromatic palette without NaN or throw', () => {
    const mono = buildLocalFoundation({
      palette: {
        version: 1,
        sampledUrls: 4,
        colors: [
          { hex: '#ffffff', count: 300, urls: 4 },
          { hex: '#000000', count: 200, urls: 4 },
          { hex: '#808080', count: 100, urls: 4 },
        ],
      },
      typography: { version: 1, sampledUrls: 4, bySelector: {} },
      breakpoints: { version: 1, sampledUrls: 4, minWidth: [], maxWidth: [] },
    });
    const color = mono.foundation.color;
    for (const v of [
      color?.surface?.base?.value,
      color?.surface?.inverse?.value,
      color?.text?.default?.value,
      color?.text?.inverse?.value,
      color?.accent?.primary?.value,
    ]) {
      expect(v).toBeDefined();
    }
    expect(JSON.stringify(mono.foundation)).not.toContain('NaN');
  });

  it('keeps button contrast on dark monochrome palettes', () => {
    const mono = buildLocalFoundation({
      palette: {
        version: 1,
        sampledUrls: 4,
        colors: [
          { hex: '#0a0a0a', count: 400, urls: 4 }, // page bg — dominant, dark
          { hex: '#2a2a2a', count: 100, urls: 4 }, // raised card bg
        ],
      },
      typography: { version: 1, sampledUrls: 4, bySelector: {} },
      breakpoints: { version: 1, sampledUrls: 4, minWidth: [], maxWidth: [] },
    });
    const button = mono.foundation.components?.button;
    expect(button?.background).toBeTruthy();
    expect(button?.background).not.toBe(button?.text); // invisible-button regression lock
  });

  it('falls back sanely on empty aggregates', () => {
    const empty = buildLocalFoundation({
      palette: { version: 1, sampledUrls: 0, colors: [] },
      typography: { version: 1, sampledUrls: 0, bySelector: {} },
      breakpoints: { version: 1, sampledUrls: 0, minWidth: [], maxWidth: [] },
    });
    // Empty usable → light-default orientation with pinned defaults.
    expect(empty.foundation.color?.text?.default?.value).toBe('#111111');
    expect(empty.foundation.color?.surface?.base?.value).toBe('#ffffff');
    expect(empty.foundation.typography?.families?.body?.value).toBe('system-ui, sans-serif');
  });

  it('picks a css-literal accent when the aggregator only saw container poles', () => {
    // Walrus-real shape: the screenshot aggregator samples CONTAINER
    // backgrounds, so the coral that lives only on a.button never reaches
    // palette.json — but it is literal in the authored CSS.
    const real = buildLocalFoundation(
      {
        palette: {
          version: 1,
          sampledUrls: 1,
          colors: [
            { hex: '#f7f2e9', count: 2, urls: 1 }, // cream containers
            { hex: '#0e2a30', count: 1, urls: 1 }, // ink footer band
          ],
        },
        typography: { version: 1, sampledUrls: 1, bySelector: {} },
        breakpoints: { version: 1, sampledUrls: 1, minWidth: [], maxWidth: [] },
      },
      {
        cssColors: [
          { hex: '#e2573b', count: 6 }, // coral — saturated, not a pole
          { hex: '#135e6b', count: 4 }, // teal — l=0.247, below gate
          { hex: '#f7f2e9', count: 9 }, // cream — lightest pole, excluded
        ],
      },
    );
    expect(real.foundation.color?.accent?.primary?.value).toBe('#e2573b');
    expect(real.foundation.components?.button?.background).toBe('#e2573b');
  });

  it('prefers an aggregate-sampled accent over css literals', () => {
    const r = buildLocalFoundation(
      {
        palette: {
          version: 1,
          sampledUrls: 4,
          colors: [
            { hex: '#f7f2e9', count: 400, urls: 4 },
            { hex: '#0e2a30', count: 380, urls: 4 },
            { hex: '#d04030', count: 50, urls: 4 }, // sampled saturated — actually rendered
          ],
        },
        typography: { version: 1, sampledUrls: 4, bySelector: {} },
        breakpoints: { version: 1, sampledUrls: 4, minWidth: [], maxWidth: [] },
      },
      { cssColors: [{ hex: '#00aa88', count: 100 }] }, // literal, higher count — still loses
    );
    expect(r.foundation.color?.accent?.primary?.value).toBe('#d04030');
  });

  it('keeps the textColor fallback when neither aggregates nor css literals are saturated', () => {
    const r = buildLocalFoundation(
      {
        palette: {
          version: 1,
          sampledUrls: 4,
          colors: [
            { hex: '#0a0a0a', count: 400, urls: 4 },
            { hex: '#2a2a2a', count: 100, urls: 4 },
          ],
        },
        typography: { version: 1, sampledUrls: 4, bySelector: {} },
        breakpoints: { version: 1, sampledUrls: 4, minWidth: [], maxWidth: [] },
      },
      { cssColors: [{ hex: '#333333', count: 8 }] }, // achromatic literal — no candidate
    );
    expect(r.foundation.color?.accent?.primary?.value).toBe('#2a2a2a'); // textColor pole
  });
});

describe('extractCssColors', () => {
  it('counts and normalizes hex literals, ordered desc by occurrences', () => {
    expect(extractCssColors(['a{color:#E2573B} .x{background:#e2573b} .y{border-color:#fff}'])).toEqual([
      { hex: '#e2573b', count: 2 },
      { hex: '#ffffff', count: 1 },
    ]);
  });

  it('returns empty for sources without hex literals', () => {
    expect(extractCssColors(['body{color:red}', ''])).toEqual([]);
  });
});
