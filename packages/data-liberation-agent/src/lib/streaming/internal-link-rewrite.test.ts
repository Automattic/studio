import { describe, it, expect, vi } from 'vitest';
import { buildInternalLinkMap, rewriteInternalLinks } from './internal-link-rewrite.js';

// Fictional source site — no real source-site URLs/slugs (project convention).
// `redirect-map.json` is the canonical source-path -> local-permalink map (the
// same map the nav/footer rewrite in theme-scaffold consumes).
const redirectMap = [
  { from: '/about-the-shop', to: '/about-the-shop/' },
  { from: '/contact', to: '/contact/' },
];
const origins = ['craftwood-fixture.test'];

describe('buildInternalLinkMap', () => {
  it('always maps the site root to "/" under both path and host+path keys', () => {
    const map = buildInternalLinkMap(redirectMap, { siteOrigins: origins });
    expect(map.get('/')).toBe('/');
    expect(map.get('craftwood-fixture.test/')).toBe('/');
  });

  it('maps a redirect entry under both path and host+path keys', () => {
    const map = buildInternalLinkMap(redirectMap, { siteOrigins: origins });
    expect(map.get('/about-the-shop')).toBe('/about-the-shop/');
    expect(map.get('craftwood-fixture.test/about-the-shop')).toBe('/about-the-shop/');
  });

  it('builds path-only keys when no origins are supplied', () => {
    const map = buildInternalLinkMap(redirectMap);
    expect(map.get('/contact')).toBe('/contact/');
    expect(map.get('craftwood-fixture.test/contact')).toBeUndefined();
  });
});

describe('rewriteInternalLinks', () => {
  const map = buildInternalLinkMap(redirectMap, { siteOrigins: origins });

  it('rewrites an absolute internal href to the root-relative permalink', () => {
    const out = rewriteInternalLinks('<a href="https://www.craftwood-fixture.test/about-the-shop">About</a>', map);
    expect(out).toBe('<a href="/about-the-shop/">About</a>');
  });

  it('rewrites a root-relative href', () => {
    const out = rewriteInternalLinks('<a href="/contact">Contact</a>', map);
    expect(out).toBe('<a href="/contact/">Contact</a>');
  });

  it('rewrites a bare relative href', () => {
    const out = rewriteInternalLinks('<a href="about-the-shop">About</a>', map);
    expect(out).toBe('<a href="/about-the-shop/">About</a>');
  });

  it('rewrites a .html form', () => {
    const out = rewriteInternalLinks('<a href="/about-the-shop.html">About</a>', map);
    expect(out).toBe('<a href="/about-the-shop/">About</a>');
  });

  it('rewrites a trailing-slash form', () => {
    const out = rewriteInternalLinks('<a href="https://www.craftwood-fixture.test/contact/">Contact</a>', map);
    expect(out).toBe('<a href="/contact/">Contact</a>');
  });

  it('matches the non-www host variant', () => {
    const out = rewriteInternalLinks('<a href="https://craftwood-fixture.test/contact">Contact</a>', map);
    expect(out).toBe('<a href="/contact/">Contact</a>');
  });

  it('preserves a #fragment when rewriting', () => {
    const out = rewriteInternalLinks('<a href="/about-the-shop#team">Team</a>', map);
    expect(out).toBe('<a href="/about-the-shop/#team">Team</a>');
  });

  it('leaves an external host untouched and does not warn', () => {
    const onMissing = vi.fn();
    const out = rewriteInternalLinks('<a href="https://other-site.test/about-the-shop">x</a>', map, { onMissing });
    expect(out).toBe('<a href="https://other-site.test/about-the-shop">x</a>');
    expect(onMissing).not.toHaveBeenCalled();
  });

  it('leaves mailto:/tel: and in-page anchors untouched', () => {
    const input = '<a href="mailto:hi@x.test">m</a><a href="tel:+15551234">t</a><a href="#section">s</a>';
    const out = rewriteInternalLinks(input, map);
    expect(out).toBe(input);
  });

  it('leaves an unmapped internal relative href as-is and reports it via onMissing', () => {
    const onMissing = vi.fn();
    const out = rewriteInternalLinks('<a href="/never-extracted">x</a>', map, { onMissing });
    expect(out).toBe('<a href="/never-extracted">x</a>');
    expect(onMissing).toHaveBeenCalledWith('/never-extracted');
  });

  it('returns input unchanged for an empty map', () => {
    const input = '<a href="/contact">Contact</a>';
    expect(rewriteInternalLinks(input, new Map())).toBe(input);
  });

  it('rewrites single-quoted href attributes too', () => {
    const out = rewriteInternalLinks("<a href='/contact'>Contact</a>", map);
    expect(out).toBe("<a href='/contact/'>Contact</a>");
  });
});
