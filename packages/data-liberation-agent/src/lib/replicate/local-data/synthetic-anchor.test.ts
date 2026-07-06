import { describe, it, expect } from 'vitest';
import { syntheticCardAnchor } from './synthetic-anchor.js';

describe('syntheticCardAnchor', () => {
  it('is deterministic for the same inputs (idempotent re-runs)', () => {
    expect(syntheticCardAnchor('main > section:nth-of-type(2) > div', '0'))
      .toBe(syntheticCardAnchor('main > section:nth-of-type(2) > div', '0'));
  });
  it('differs for different selectors and different page slugs (no aliasing)', () => {
    const a = syntheticCardAnchor('main > div:nth-of-type(1)', 'home');
    const b = syntheticCardAnchor('main > div:nth-of-type(2)', 'home');
    const c = syntheticCardAnchor('main > div:nth-of-type(1)', 'archive');
    expect(new Set([a, b, c]).size).toBe(3);
  });
  it('produces a valid HTML id token', () => {
    expect(syntheticCardAnchor('main > div', 'home')).toMatch(/^dla-cards-[a-z0-9]+$/);
  });
});
