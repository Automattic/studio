import { describe, it, expect } from 'vitest';
import { discoverDataArrays, discoverMounts, discoverIdLookups } from './discover-js-data.js';

const RECS = [
  { id: 'a-1', title: 'Alpha', price: 120, cat: 'glass' },
  { id: 'b-2', title: 'Beta', price: 80, cat: 'wood' },
];

describe('discoverDataArrays (all declaration forms, name-agnostic)', () => {
  it('finds a top-level const record array', () => {
    const found = discoverDataArrays(`const PRODUCTS = ${JSON.stringify(RECS)}; function r(){}`);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('PRODUCTS');
    expect(found[0].confidence).toBe('high');
    expect(found[0].records).toEqual(RECS);
  });

  it('finds window.X = [...] and export const X = [...]', () => {
    expect(discoverDataArrays(`window.STOCK = ${JSON.stringify(RECS)};`)[0]?.name).toBe('STOCK');
    expect(discoverDataArrays(`export const ITEMS = ${JSON.stringify(RECS)};`)[0]?.name).toBe('ITEMS');
  });

  it('finds an array nested in an object property (name = key)', () => {
    const found = discoverDataArrays(`const SITE = { items: ${JSON.stringify(RECS)} };`);
    expect(found[0].name).toBe('items');
    expect(found[0].records).toEqual(RECS);
  });

  it('finds an array returned from an IIFE (anonymous name)', () => {
    const found = discoverDataArrays(`const X = (function(){ return ${JSON.stringify(RECS)}; })();`);
    expect(found.some((a) => JSON.stringify(a.records) === JSON.stringify(RECS))).toBe(true);
  });

  it('ignores non-record arrays', () => {
    expect(discoverDataArrays(`const NAV = ['Home','Shop']; const N = [1,2,3];`)).toEqual([]);
  });

  it('marks a literal that references runtime values as low-confidence (no records)', () => {
    const found = discoverDataArrays(`const ITEMS = [{ id: 'x', when: Date.now() }];`);
    expect(found[0].confidence).toBe('low');
    expect(found[0].records).toBeUndefined();
    expect(found[0].evidence).toContain('Date.now');
  });

  it('returns [] (does not throw) on unparseable source', () => {
    expect(discoverDataArrays(`const x = {{{ broken`)).toEqual([]);
  });
});

describe('discoverMounts (broad targets, placeholder-tolerant)', () => {
  it('links a call-matched container even when it holds a loading placeholder', () => {
    const html = `<main><div class="grid g--4" id="newestGrid"><p>Loading...</p></div></main>`;
    const js = `mountGrid('#newestGrid', newestObjets(4));`;
    const m = discoverMounts(html, js);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ selector: '#newestGrid', wrapperClass: 'grid g--4', perPageHint: 4, confidence: 'high' });
  });

  it('matches class and data-attribute selectors, not just ids', () => {
    const html = `<ul class="catalog"></ul><div data-grid="shop"></div>`;
    const js = `render('.catalog', A); fill('[data-grid="shop"]', B);`;
    expect(discoverMounts(html, js).map((m) => m.selector).sort()).toEqual(['.catalog', '[data-grid="shop"]']);
  });

  it('flags a strictly-empty #id container with no matching call as low-confidence', () => {
    const m = discoverMounts(`<div id="orphan"></div>`, `console.log('x');`);
    expect(m).toHaveLength(1);
    expect(m[0].confidence).toBe('low');
    expect(m[0].sourceCall).toBeUndefined();
  });

  it('does not flag a non-empty container that has no matching call', () => {
    expect(discoverMounts(`<div id="filled"><span>x</span></div>`, `noop();`)).toEqual([]);
  });
});

describe('discoverIdLookups', () => {
  it('returns array names in ARR.find(x => x.id === ...) (== or ===)', () => {
    const js = `
      function open(id){ return OBJETS.find(x => x.id === id); }
      function peek(id){ return STOCK.find(p => p.id == id); }
      const noise = LIST.filter(x => x.ok);
    `;
    expect(discoverIdLookups(js).sort()).toEqual(['OBJETS', 'STOCK']);
  });

  it('returns [] with no id lookup, and [] (not throw) on unparseable source', () => {
    expect(discoverIdLookups(`const x = 1;`)).toEqual([]);
    expect(discoverIdLookups(`)(}{`)).toEqual([]);
  });
});
