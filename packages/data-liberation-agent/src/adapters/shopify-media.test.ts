import { describe, it, expect } from 'vitest';
import { extractShopifyMediaUrls } from './shopify/index.js';

// Regression coverage for page-builder (Replo/Shogun/PageFly) imagery capture.
// getsnooz.com is a Replo-on-Shopify store: 19 pages reference
// assets.replocdn.com but 0 such images were captured because the old extractor
// (a) only swept cdn.shopify.com and (b) required a file extension in the path.
// Replo URLs are bare UUIDs with no extension, so they were all dropped.
describe('extractShopifyMediaUrls — page-builder CDN imagery', () => {
  it('captures extension-less Replo CDN <img src> URLs', () => {
    const html = `<img src="https://assets.replocdn.com/projects/49187cf6/4ad58ef3-8bf7-4614-b56e-d08d197fd0e9" class="r-6rymgy" loading="eager">`;
    const urls = extractShopifyMediaUrls(html);
    expect(urls).toContain(
      'https://assets.replocdn.com/projects/49187cf6/4ad58ef3-8bf7-4614-b56e-d08d197fd0e9',
    );
  });

  it('captures extension-less URLs that carry only a ?width= query param', () => {
    const html = `<img src="https://assets.replocdn.com/projects/p/abc?width=820">`;
    const urls = extractShopifyMediaUrls(html);
    expect(urls).toContain('https://assets.replocdn.com/projects/p/abc?width=820');
  });

  it('captures URLs referenced only via srcset / data-srcset', () => {
    const html = `<img srcset="https://assets.replocdn.com/projects/p/one?width=600 600w, https://assets.replocdn.com/projects/p/two?width=1024 1024w">
      <source data-srcset="https://assets.replocdn.com/projects/p/three?width=1800 1800w">`;
    const urls = extractShopifyMediaUrls(html);
    expect(urls).toContain('https://assets.replocdn.com/projects/p/one?width=600');
    expect(urls).toContain('https://assets.replocdn.com/projects/p/two?width=1024');
    expect(urls).toContain('https://assets.replocdn.com/projects/p/three?width=1800');
  });

  it('captures lazy-load data-src attributes', () => {
    const html = `<img data-src="https://assets.replocdn.com/projects/p/lazy" src="data:image/gif;base64,AAAA">`;
    const urls = extractShopifyMediaUrls(html);
    expect(urls).toContain('https://assets.replocdn.com/projects/p/lazy');
    // the data: URI is not absolute http(s) — dropped
    expect(urls.some((u) => u.startsWith('data:'))).toBe(false);
  });

  it('captures CSS background-image url() references', () => {
    const html = `<div style="background-image: url('https://assets.replocdn.com/projects/p/bg?width=1800')"></div>`;
    const urls = extractShopifyMediaUrls(html);
    expect(urls).toContain('https://assets.replocdn.com/projects/p/bg?width=1800');
  });

  it('still captures classic Shopify CDN URLs with extensions', () => {
    const html = `<img src="https://cdn.shopify.com/s/files/1/0/products/snooz.jpg?v=123">`;
    const urls = extractShopifyMediaUrls(html);
    expect(urls).toContain('https://cdn.shopify.com/s/files/1/0/products/snooz.jpg?v=123');
  });

  it('rejects non-image assets (js/css/fonts) even when extension-less host matches', () => {
    const html = `
      <img src="https://example.com/app.js">
      <img src="https://example.com/styles.css">
      <img src="https://example.com/font.woff2">`;
    const urls = extractShopifyMediaUrls(html);
    expect(urls).toHaveLength(0);
  });

  it('rejects tracking / analytics pixel hosts', () => {
    const html = `
      <img src="https://www.google-analytics.com/collect?v=1">
      <img src="https://www.facebook.com/tr?id=123">
      <img src="https://cdn.shopify.com/shopifycloud/web-pixels-manager/pixel">`;
    const urls = extractShopifyMediaUrls(html);
    expect(urls).toHaveLength(0);
  });

  it('dedupes repeated references to the same URL', () => {
    const html = `
      <img src="https://assets.replocdn.com/projects/p/dup">
      <img src="https://assets.replocdn.com/projects/p/dup">`;
    const urls = extractShopifyMediaUrls(html);
    expect(urls.filter((u) => u.endsWith('/dup'))).toHaveLength(1);
  });
});
