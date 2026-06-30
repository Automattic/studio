import { describe, it, expect, vi } from 'vitest';
import { parseSitemapXml, classifyUrl } from '../src/lib/extraction/sitemap.js';

describe('parseSitemapXml', () => {
  it('extracts URLs from a standard sitemap', () => {
    const xml = `<?xml version="1.0"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/</loc></url>
      <url><loc>https://example.com/about</loc></url>
      <url><loc>https://example.com/blog/post-1</loc></url>
    </urlset>`;
    const urls = parseSitemapXml(xml);
    expect(urls).toEqual([
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/blog/post-1',
    ]);
  });

  it('extracts sub-sitemap URLs from a sitemap index', () => {
    const xml = `<?xml version="1.0"?>
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
      <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
    </sitemapindex>`;
    const urls = parseSitemapXml(xml);
    expect(urls).toEqual([
      'https://example.com/sitemap-pages.xml',
      'https://example.com/sitemap-posts.xml',
    ]);
  });

  it('returns empty array for invalid XML', () => {
    const urls = parseSitemapXml('not xml at all');
    expect(urls).toEqual([]);
  });
});

describe('classifyUrl', () => {
  it('classifies blog paths as post', () => {
    expect(classifyUrl('https://example.com/blog/my-post')).toBe('post');
    expect(classifyUrl('https://example.com/post/my-post')).toBe('post');
    expect(classifyUrl('https://example.com/news/breaking-story')).toBe('post');
    expect(classifyUrl('https://example.com/article/feature')).toBe('post');
    expect(classifyUrl('https://example.com/blogs/news/my-article')).toBe('post');
    expect(classifyUrl('https://example.com/blog-1/post/my-post')).toBe('post');
    expect(classifyUrl('https://example.com/single-post/my-post')).toBe('post');
  });

  it('classifies bare blog/news paths as page (listing pages, not posts)', () => {
    // Bare /blog, /news, /articles are blog *listing* pages, not individual
    // posts. They should be classified as `page` so they are not written to
    // WXR as authorless post items.
    expect(classifyUrl('https://example.com/blog')).toBe('page');
    expect(classifyUrl('https://example.com/blog/')).toBe('page');
    expect(classifyUrl('https://example.com/news')).toBe('page');
    expect(classifyUrl('https://example.com/articles')).toBe('page');
  });

  it('classifies product paths', () => {
    expect(classifyUrl('https://example.com/product/widget')).toBe('product');
    expect(classifyUrl('https://example.com/store/item')).toBe('product');
  });

  it('classifies root as homepage', () => {
    expect(classifyUrl('https://example.com/')).toBe('homepage');
    expect(classifyUrl('https://example.com')).toBe('homepage');
  });

  it('classifies unknown paths as page', () => {
    expect(classifyUrl('https://example.com/about')).toBe('page');
    expect(classifyUrl('https://example.com/contact')).toBe('page');
  });
});
