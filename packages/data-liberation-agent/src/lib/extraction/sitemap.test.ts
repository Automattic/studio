import { describe, it, expect } from 'vitest';
import { classifyUrl } from './sitemap.js';

describe('classifyUrl', () => {
  it('classifies the homepage', () => {
    expect(classifyUrl('https://example.com/')).toBe('homepage');
    expect(classifyUrl('https://example.com')).toBe('homepage');
  });

  it('classifies an actual product page', () => {
    expect(classifyUrl('https://example.com/store/p20/Widget.html')).toBe('product'); // Weebly
    expect(classifyUrl('https://example.com/products/widget')).toBe('product');
    expect(classifyUrl('https://example.com/shop/widget')).toBe('product');
  });

  it('does not classify a store/shop category page as a product', () => {
    // Weebly names a category /store/c<N>/... against a product's /store/p<N>/...; importing
    // one as a product creates a junk WooCommerce row named after the category (lonestardinners.com).
    expect(classifyUrl('https://example.com/store/c1/Current_Menu.html')).toBe('page');
    expect(classifyUrl('https://example.com/shop/c6/Beer_Soaps.html')).toBe('page');
  });

  it('does not classify the bare store/shop index as a product', () => {
    expect(classifyUrl('https://example.com/store')).toBe('page');
    expect(classifyUrl('https://example.com/store/')).toBe('page');
    expect(classifyUrl('https://example.com/shop')).toBe('page');
  });

  it('does not classify generic category/collection listing pages as products', () => {
    expect(classifyUrl('https://example.com/product-category/widgets')).toBe('page');
    expect(classifyUrl('https://example.com/collections/widgets')).toBe('page'); // Shopify
    expect(classifyUrl('https://example.com/category/widgets')).toBe('page');
    expect(classifyUrl('https://example.com/product-tag/on-sale')).toBe('page');
  });

  it('classifies a blog post but not a bare blog listing', () => {
    expect(classifyUrl('https://example.com/blog/my-post')).toBe('post');
    expect(classifyUrl('https://example.com/blog')).toBe('page');
    expect(classifyUrl('https://example.com/blog/')).toBe('page');
  });

  it('classifies gallery and event pages', () => {
    expect(classifyUrl('https://example.com/gallery/summer')).toBe('gallery');
    expect(classifyUrl('https://example.com/events/launch-party')).toBe('event');
  });

  it('falls back to page for anything else', () => {
    expect(classifyUrl('https://example.com/about-us')).toBe('page');
  });
});
