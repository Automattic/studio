// src/lib/replicate/local-data/neutralize-mounts.test.ts
import { describe, it, expect } from 'vitest';
import { neutralizeDataMounts } from './neutralize-mounts.js';

describe('neutralizeDataMounts', () => {
  it('removes the data-injection call for a mounted selector', () => {
    const js = "mountGrid('#newestGrid', newestObjets(4));";
    const { js: out, removed } = neutralizeDataMounts(js, ['#newestGrid']);
    expect(removed).toBe(1);
    expect(out).not.toContain('mountGrid');
    expect(out).toContain('neutralized');
  });

  it('removes calls for multiple selectors and counts each', () => {
    const js = "mountGrid('#newestGrid', newestObjets(4));\nmountGrid('#shopGrid', OBJETS);";
    const { js: out, removed } = neutralizeDataMounts(js, ['#newestGrid', '#shopGrid']);
    expect(removed).toBe(2);
    expect(out).not.toContain('mountGrid(');
  });

  it('KEEPS styling/animation/filter/modal JS (only data mounts go)', () => {
    const js = [
      "mountGrid('#newestGrid', newestObjets(4));",
      "document.querySelectorAll('.obj-card[data-cat]').forEach(c => c.classList.add('in'));",
      "filterBtn.addEventListener('click', () => applyFilter('#filters'));",
      "openObjet(document.querySelector('[data-tellme]').dataset.tellme);",
    ].join('\n');
    const { js: out } = neutralizeDataMounts(js, ['#newestGrid']);
    expect(out).toContain("obj-card[data-cat]"); // animation/binding kept
    expect(out).toContain("applyFilter('#filters')"); // filter kept
    expect(out).toContain('openObjet('); // modal kept
    expect(out).not.toContain('mountGrid(');
  });

  it('leaves the mount FUNCTION definition intact (only invocations removed)', () => {
    const js = "function mountGrid(sel, data){ document.querySelector(sel).innerHTML = data.map(card).join(''); }\nmountGrid('#shopGrid', OBJETS);";
    const { js: out, removed } = neutralizeDataMounts(js, ['#shopGrid']);
    expect(removed).toBe(1);
    expect(out).toContain('function mountGrid(sel, data)'); // definition stays
    expect(out).not.toContain("mountGrid('#shopGrid'");
  });

  it('no matching selector → unchanged', () => {
    const js = "doThing('#other');";
    const { js: out, removed } = neutralizeDataMounts(js, ['#newestGrid']);
    expect(removed).toBe(0);
    expect(out).toBe(js);
  });

  it('does NOT break a method-chain member carrying the selector (no orphaned receiver)', () => {
    // The selector literal also appears inside a kept chained query; neutralizing
    // the method call would orphan `document.`/`.forEach` and break the bundle.
    const js = [
      "function mountEmbeds(){",
      "  document.querySelectorAll('[data-objet-embed]').forEach(node => { render(node); });",
      "}",
      "mountEmbeds();",
    ].join('\n');
    const { js: out, removed } = neutralizeDataMounts(js, ['[data-objet-embed]']);
    expect(removed).toBe(0); // chain member is not a receiver-less statement call
    expect(out).toBe(js); // left verbatim
    expect(out).not.toContain('neutralized');
  });

  it('neutralizes the receiver-less statement but spares a same-selector chain member', () => {
    const js = [
      "mountGrid('#shopGrid', OBJETS);",
      "document.querySelectorAll('#shopGrid .obj-card').forEach(c => c.classList.add('in'));",
    ].join('\n');
    const { js: out, removed } = neutralizeDataMounts(js, ['#shopGrid']);
    expect(removed).toBe(1); // only the mountGrid statement
    expect(out).not.toContain("mountGrid('#shopGrid'");
    expect(out).toContain("document.querySelectorAll('#shopGrid .obj-card')"); // chain query kept intact
  });
});
