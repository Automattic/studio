import { describe, it, expect } from 'vitest';
import { rewriteInternalHrefs, rewriteInternalLinksInJs, slugToUrl } from './href-rewrite.js';

const PAGES = [
  { relPath: 'index.html', slug: 'home' },
  { relPath: 'shop.html', slug: 'shop' },
  { relPath: 'the-shop.html', slug: 'the-shop' },
];
const SLUGS = PAGES.map((p) => p.slug);

describe('slugToUrl', () => {
  it('home → /, others → /slug/', () => {
    expect(slugToUrl('home')).toBe('/');
    expect(slugToUrl('shop')).toBe('/shop/');
  });
});

describe('rewriteInternalHrefs', () => {
  it('rewrites internal anchors to permalinks; external/# untouched', () => {
    const html = `<div><a href="shop.html" class="btn">Shop</a><a href="./index.html">Home</a><a href="https://x.test/shop.html">Ext</a><a href="#top">Top</a></div>`;
    const out = rewriteInternalHrefs(html, SLUGS);
    expect(out).toContain('href="/shop/"');
    expect(out).toContain('href="/"');
    expect(out).toContain('href="https://x.test/shop.html"');
    expect(out).toContain('href="#top"');
  });

  it('unknown pages stay untouched', () => {
    const out = rewriteInternalHrefs(`<a href="missing.html">x</a>`, SLUGS);
    expect(out).toContain('href="missing.html"');
  });
});

describe('rewriteInternalLinksInJs (build-time bundle adaptation)', () => {
  it('rewrites quoted internal page literals — this is a WordPress site now', () => {
    const js = `const NAV=[{href:'shop.html'},{href:'the-shop.html'},{href:"index.html"}];fetch('/api/shop.html.json');`;
    const out = rewriteInternalLinksInJs(js, PAGES);
    expect(out).toContain(`href:'/shop/'`);
    expect(out).toContain(`href:'/the-shop/'`);
    expect(out).toContain(`href:"/"`);
    // Not a whole-literal match — untouched (conservative).
    expect(out).toContain(`'/api/shop.html.json'`);
  });

  it('longest path wins (the-shop.html must not become the-/shop/)', () => {
    const out = rewriteInternalLinksInJs(`x='the-shop.html';y='shop.html';`, PAGES);
    expect(out).toContain(`x='/the-shop/'`);
    expect(out).toContain(`y='/shop/'`);
  });
});
