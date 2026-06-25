import { describe, it, expect } from 'vitest';
import { chromeKey } from './chrome-key.js';

describe('chromeKey', () => {
  it('is stable across volatile tokens (instance ids, active state, reveal gates)', () => {
    const a = chromeKey({ region: 'footer', pathIndex: [0, 2, 1], tag: 'a', className: 'link list-menu__item--link scroll-trigger' });
    const b = chromeKey({ region: 'footer', pathIndex: [0, 2, 1], tag: 'a', className: 'link list-menu__item--link active' });
    expect(a).toBe(b); // gate + active stripped; structural key identical
  });

  it('differs when structure differs', () => {
    const a = chromeKey({ region: 'footer', pathIndex: [0, 2, 1], tag: 'a', className: 'link' });
    const b = chromeKey({ region: 'footer', pathIndex: [0, 2, 2], tag: 'a', className: 'link' });
    expect(a).not.toBe(b);
  });

  it('strips --offscreen suffix (JS reveal gate) from any class token', () => {
    // foo--offscreen is a builder gate pattern; the whole token should vanish
    const a = chromeKey({ region: 'nav', pathIndex: [0, 1], tag: 'div', className: 'menu foo--offscreen logo' });
    const b = chromeKey({ region: 'nav', pathIndex: [0, 1], tag: 'div', className: 'menu logo' });
    expect(a).toBe(b);
  });

  it('strips standalone --offscreen class token', () => {
    const a = chromeKey({ region: 'header', pathIndex: [0], tag: 'div', className: 'wrap --offscreen' });
    const b = chromeKey({ region: 'header', pathIndex: [0], tag: 'div', className: 'wrap' });
    expect(a).toBe(b);
  });

  it('produces the same key for elements differing only by Wix instance id', () => {
    // canonicalizeInstanceIds normalises comp-<inst> (not _r_ prefixed) to positional
    // tokens, so two placements of the same component component produce equal keys.
    const a = chromeKey({ region: 'header', pathIndex: [0, 1], tag: 'div', className: 'comp-abc123_r_comp-sharedXYZ widget' });
    const b = chromeKey({ region: 'header', pathIndex: [0, 1], tag: 'div', className: 'comp-def456_r_comp-sharedXYZ widget' });
    expect(a).toBe(b);
  });

  it('class list is sorted so order in source does not affect key', () => {
    const a = chromeKey({ region: 'footer', pathIndex: [0], tag: 'span', className: 'beta alpha gamma' });
    const b = chromeKey({ region: 'footer', pathIndex: [0], tag: 'span', className: 'gamma beta alpha' });
    expect(a).toBe(b);
  });

  it('strips all known volatile token forms', () => {
    const base = chromeKey({ region: 'nav', pathIndex: [1], tag: 'li', className: 'item' });
    for (const vol of ['active', 'current', 'is-active', 'selected', 'aria-current', 'scroll-trigger--active', 'animate--in']) {
      const withVol = chromeKey({ region: 'nav', pathIndex: [1], tag: 'li', className: `item ${vol}` });
      expect(withVol).toBe(base);
    }
  });
});
