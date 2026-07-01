import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { inventoryReplica, sanitizeSlug } from './inventory.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');

describe('sanitizeSlug', () => {
  it('strips leading www.', () => {
    expect(sanitizeSlug('www.example.com')).toBe('example-com');
  });
  it('lowercases and hyphenates non-alphanumerics', () => {
    expect(sanitizeSlug('GetSnooz.com')).toBe('getsnooz-com');
    expect(sanitizeSlug('foo bar baz')).toBe('foo-bar-baz');
  });
  it('trims trailing hyphens', () => {
    expect(sanitizeSlug('foo--bar.--')).toBe('foo-bar');
  });
});

describe('inventoryReplica — synthetic fixtures', () => {
  it('throws when output.wxr is missing', () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'inv-no-wxr-'));
    try {
      expect(() => inventoryReplica(dir)).toThrow(/output\.wxr missing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts archetypes from a minimal WXR and respects sourceUrl meta', () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'inv-min-'));
    try {
      const wxr = `<?xml version="1.0"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/" xmlns:excerpt="https://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example</title>
    <wp:base_blog_url>https://example.com</wp:base_blog_url>
    <description></description>
    <item>
      <title>Home</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_type>page</wp:post_type>
      <wp:post_name>home</wp:post_name>
      <wp:post_date>2025-01-01 00:00:00</wp:post_date>
      <wp:postmeta>
        <wp:meta_key>_source_url</wp:meta_key>
        <wp:meta_value><![CDATA[https://example.com/]]></wp:meta_value>
      </wp:postmeta>
    </item>
    <item>
      <title>About</title>
      <wp:post_id>2</wp:post_id>
      <wp:post_type>page</wp:post_type>
      <wp:post_name>about</wp:post_name>
      <wp:post_date>2025-01-01 00:00:00</wp:post_date>
      <wp:postmeta>
        <wp:meta_key>_source_url</wp:meta_key>
        <wp:meta_value><![CDATA[https://example.com/about]]></wp:meta_value>
      </wp:postmeta>
    </item>
    <item>
      <title>Hello</title>
      <wp:post_id>3</wp:post_id>
      <wp:post_type>post</wp:post_type>
      <wp:post_name>hello</wp:post_name>
      <wp:post_date>2025-01-01 00:00:00</wp:post_date>
      <wp:postmeta>
        <wp:meta_key>_source_url</wp:meta_key>
        <wp:meta_value><![CDATA[https://example.com/blog/hello]]></wp:meta_value>
      </wp:postmeta>
    </item>
  </channel>
</rss>`;
      writeFileSync(join(dir, 'output.wxr'), wxr);

      const inv = inventoryReplica(dir);
      // Page with sourceUrl `/` classifies as homepage; other page is `page`; post is `post`.
      expect(inv.archetypes.homepage.count).toBe(1);
      expect(inv.archetypes.homepage.urls).toContain('https://example.com/');
      expect(inv.archetypes.page.count).toBe(1);
      expect(inv.archetypes.page.urls).toContain('https://example.com/about');
      expect(inv.archetypes.post.count).toBe(1);
      expect(inv.archetypes.post.urls).toContain('https://example.com/blog/hello');
      expect(inv.archetypes.product.count).toBe(0);
      expect(inv.designFoundationExists).toBe(false);
      expect(inv.designFoundationPath).toBeNull();
      expect(inv.hasProducts).toBe(false);
      expect(inv.productCount).toBe(0);

      // siteSlug is sanitized; representatives carry the expected shape (1-3 per
      // non-empty archetype, with url/slug/htmlBytes). Hermetic replacement for the
      // assertions the deleted real-output-fixture block used to make.
      expect(inv.siteSlug).toBeTruthy();
      expect(inv.siteSlug).not.toContain('.');
      expect(inv.siteSlug).not.toMatch(/^www-/);
      for (const archetype of ['page', 'post'] as const) {
        const reps = inv.representatives[archetype];
        expect(reps.length).toBeGreaterThan(0);
        expect(reps.length).toBeLessThanOrEqual(3);
        for (const r of reps) {
          expect(r.url).toBeTruthy();
          expect(r.slug).toBeTruthy();
          expect(typeof r.htmlBytes).toBe('number');
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts non-empty lines in products.jsonl', () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'inv-products-'));
    try {
      writeFileSync(
        join(dir, 'output.wxr'),
        `<?xml version="1.0"?><rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/" xmlns:excerpt="https://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>x</title><description></description></channel></rss>`,
      );
      writeFileSync(
        join(dir, 'products.jsonl'),
        `{"id":1}\n{"id":2}\n\n{"id":3}\n`,
      );

      const inv = inventoryReplica(dir);
      expect(inv.productCount).toBe(3);
      expect(inv.hasProducts).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags missing design-foundation.json in notes', () => {
    mkdirSync(FIXTURE_TMP, { recursive: true });
    const dir = mkdtempSync(join(FIXTURE_TMP, 'inv-nodf-'));
    try {
      writeFileSync(
        join(dir, 'output.wxr'),
        `<?xml version="1.0"?><rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/" xmlns:excerpt="https://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>x</title><description></description></channel></rss>`,
      );
      const inv = inventoryReplica(dir);
      expect(inv.notes.some((n) => n.includes('design-foundation.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

