import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildPageLinkMap } from './page-link-map.js';

describe('buildPageLinkMap', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(process.cwd(), '.tmp-test-linkmap-'));
    writeFileSync(
      join(dir, 'redirect-map.json'),
      JSON.stringify([
        { from: '/about', to: '/about/' },
        { from: '/post/news-1', to: '/news-1/' },
      ]),
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('maps relative + absolute same-site hrefs to local permalinks', () => {
    const map = buildPageLinkMap(dir, ['https://www.acme.test/about']);
    // root-relative key
    expect(map.get('/about')).toBe('/about/');
    // absolute same-site key (host normalized, www stripped)
    expect(map.get('acme.test/about')).toBe('/about/');
    // root is always seeded
    expect(map.get('/')).toBe('/');
  });

  it('returns a root-only map when redirect-map.json is missing', () => {
    const empty = mkdtempSync(join(process.cwd(), '.tmp-test-linkmap-empty-'));
    try {
      const map = buildPageLinkMap(empty, ['https://www.acme.test/']);
      expect(map.get('/')).toBe('/');
      expect(map.get('/about')).toBeUndefined();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('buildPageLinkMap product entries (products.jsonl)', () => {
  it('maps /products/<handle> to the predicted local /product/<slug>/ permalink', () => {
    const dir = mkdtempSync(join(process.cwd(), '.tmp-test-linkmap-prod-'));
    try {
      writeFileSync(join(dir, 'redirect-map.json'), JSON.stringify([{ from: '/about', to: '/about/' }]));
      writeFileSync(
        join(dir, 'products.jsonl'),
        [
          JSON.stringify({ name: 'Dream Fan & Bundle', sku: 'parent-1', sourceUrl: 'https://shop.acme.test/products/dream-fan-machine' }),
          JSON.stringify({ name: 'Dream Fan & Bundle', sku: 'variant-no-url' }),
          'not-json',
        ].join('\n'),
      );
      const map = buildPageLinkMap(dir, ['https://shop.acme.test/']);
      // sanitize_title prediction: '&' dropped, spaces hyphenated
      expect(map.get('/products/dream-fan-machine')).toBe('/product/dream-fan-bundle/');
      // absolute same-site key works for products too
      expect(map.get('shop.acme.test/products/dream-fan-machine')).toBe('/product/dream-fan-bundle/');
      // page entries unaffected
      expect(map.get('/about')).toBe('/about/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no products.jsonl → no product entries, map otherwise intact', () => {
    const dir = mkdtempSync(join(process.cwd(), '.tmp-test-linkmap-noprod-'));
    try {
      writeFileSync(join(dir, 'redirect-map.json'), JSON.stringify([{ from: '/about', to: '/about/' }]));
      const map = buildPageLinkMap(dir, ['https://acme.test/']);
      expect(map.get('/about')).toBe('/about/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
