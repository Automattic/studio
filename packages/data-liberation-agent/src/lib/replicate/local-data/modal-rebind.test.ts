// src/lib/replicate/local-data/modal-rebind.test.ts
import { describe, it, expect } from 'vitest';
import { rebindArrayLookups, DLA_ITEM_HELPER_JS } from './modal-rebind.js';

describe('DLA_ITEM_HELPER_JS', () => {
  it('defines window.dlaItem reading the dla-item island', () => {
    expect(DLA_ITEM_HELPER_JS).toContain('window.dlaItem');
    expect(DLA_ITEM_HELPER_JS).toContain('.dla-item[data-id=');
    expect(DLA_ITEM_HELPER_JS).toContain('JSON.parse');
  });

  it('flattens meta keys to the top level so source modal field reads keep working', () => {
    // Evaluate the helper against a fake DOM island and assert flattening.
    const island = { id: 'x', title: 'T', meta: { price: 9, story: 's' }, gallery: [] };
    const fn = new Function(
      'document',
      'window',
      `${DLA_ITEM_HELPER_JS}\nreturn window.dlaItem('x');`,
    );
    const fakeDoc = { querySelector: () => ({ textContent: JSON.stringify(island) }) };
    const out = fn(fakeDoc, {}) as Record<string, unknown>;
    expect(out.price).toBe(9);
    expect(out.story).toBe('s');
    expect(out.title).toBe('T');
  });
});

describe('rebindArrayLookups', () => {
  it('rewrites OBJETS.find(x => x.id === id) to window.dlaItem(id)', () => {
    const js = 'function openModal(id){ const o = OBJETS.find(x=>x.id===id); if(!o) return; }';
    const r = rebindArrayLookups(js, ['OBJETS']);
    expect(r.rewritten).toBe(1);
    expect(r.js).toContain('const o = window.dlaItem(id);');
    expect(r.js).not.toContain('OBJETS.find');
  });

  it('handles == and whitespace and an expression argument', () => {
    const js = "const o = OBJETS.find( item => item.id == node.getAttribute('data-id') );";
    const r = rebindArrayLookups(js, ['OBJETS']);
    expect(r.rewritten).toBe(1);
    expect(r.js).toContain("window.dlaItem(node.getAttribute('data-id'))");
  });

  it('rewrites multiple arrays and counts each site', () => {
    const js = 'A.find(x=>x.id===a); B.find(y=>y.id===b);';
    const r = rebindArrayLookups(js, ['A', 'B']);
    expect(r.rewritten).toBe(2);
    expect(r.js).toBe('window.dlaItem(a); window.dlaItem(b);');
  });

  it('leaves the array definition and unrelated uses intact', () => {
    const js = 'const OBJETS=[{id:1}]; OBJETS.map(render); const o=OBJETS.find(x=>x.id===id);';
    const r = rebindArrayLookups(js, ['OBJETS']);
    expect(r.js).toContain('const OBJETS=[{id:1}]');
    expect(r.js).toContain('OBJETS.map(render)');
    expect(r.js).toContain('window.dlaItem(id)');
  });

  it('no matching lookup → unchanged, zero count', () => {
    const js = 'doThing();';
    const r = rebindArrayLookups(js, ['OBJETS']);
    expect(r).toEqual({ js, rewritten: 0 });
  });
});
