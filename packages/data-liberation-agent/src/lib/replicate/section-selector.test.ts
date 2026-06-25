import { describe, it, expect } from 'vitest';
import { buildSelector } from './section-selector.js';

describe('buildSelector', () => {
  it('uses tag + #id when an id is present', () => {
    expect(buildSelector({ tag: 'section', id: 'banner', classes: ['hero'], nthOfType: 2 }))
      .toBe('section#banner.hero');
  });
  it('appends up to 3 class tokens, dropping hash-y ones', () => {
    expect(buildSelector({ tag: 'div', id: null, classes: ['row', 'a1b2c3d4e5', 'cols', 'pad', 'mt'], nthOfType: 1 }))
      .toBe('div.row.cols.pad'); // hex-hash 'a1b2c3d4e5' dropped, capped at 3
  });
  it('adds :nth-of-type only when tag is otherwise ambiguous (no id, no kept class)', () => {
    expect(buildSelector({ tag: 'section', id: null, classes: [], nthOfType: 3 }))
      .toBe('section:nth-of-type(3)');
  });
  it('omits :nth-of-type when a class disambiguates', () => {
    expect(buildSelector({ tag: 'nav', id: null, classes: ['site-nav'], nthOfType: 5 }))
      .toBe('nav.site-nav');
  });
  it('drops over-long class tokens (>=16 chars)', () => {
    expect(buildSelector({ tag: 'div', id: null, classes: ['this-is-a-very-long-classname'], nthOfType: 4 }))
      .toBe('div:nth-of-type(4)');
  });
});
