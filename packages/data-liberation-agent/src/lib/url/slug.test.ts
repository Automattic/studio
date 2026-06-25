import { describe, it, expect } from 'vitest';
import { pageSlugFromUrl, claimSlug } from './index.js';

describe('pageSlugFromUrl', () => {
  it('uses the LAST path segment, not the --joined path', () => {
    expect(pageSlugFromUrl('https://getsnooz.com/pages/about-us')).toBe('about-us');
    expect(pageSlugFromUrl('https://getsnooz.com/pages/shop-all')).toBe('shop-all');
  });

  it('handles blog/article nested paths', () => {
    expect(pageSlugFromUrl('https://getsnooz.com/blogs/snoozweek/white-noise-vs-brown-noise'))
      .toBe('white-noise-vs-brown-noise');
  });

  it('maps the homepage / root to "homepage"', () => {
    expect(pageSlugFromUrl('https://getsnooz.com/')).toBe('homepage');
    expect(pageSlugFromUrl('https://getsnooz.com')).toBe('homepage');
  });

  it('tolerates trailing slashes', () => {
    expect(pageSlugFromUrl('https://getsnooz.com/pages/about-us/')).toBe('about-us');
  });

  it('normalizes to WP slug characters', () => {
    expect(pageSlugFromUrl('https://x.com/pages/About Us!')).toBe('about-us');
    expect(pageSlugFromUrl('https://x.com/pages/Caf%C3%A9')).toBe('caf');
  });

  it('falls back to "homepage" on unparseable input', () => {
    expect(pageSlugFromUrl('not a url')).toBe('homepage');
  });

  // FINDING D: reserved-word / collision visibility.
  it('suffixes a WP-reserved last segment so it cannot shadow a core route', () => {
    expect(pageSlugFromUrl('https://x.com/feed')).toBe('feed-page');
    expect(pageSlugFromUrl('https://x.com/section/wp-admin')).toBe('wp-admin-page');
    expect(pageSlugFromUrl('https://x.com/embed')).toBe('embed-page');
    expect(pageSlugFromUrl('https://x.com/blog/page')).toBe('page-page');
    expect(pageSlugFromUrl('https://x.com/attachment')).toBe('attachment-page');
    expect(pageSlugFromUrl('https://x.com/wp-json')).toBe('wp-json-page');
  });

  it('does not let a page literally named "homepage" shadow the root sentinel', () => {
    expect(pageSlugFromUrl('https://x.com/pages/homepage')).toBe('homepage-page');
  });

  it('does not shadow homepage when a non-empty segment normalizes to empty', () => {
    // All-punctuation segment → distinct fallback, not the homepage sentinel.
    expect(pageSlugFromUrl('https://x.com/pages/!!!')).toBe('page-1');
  });

  it('leaves a normal (non-reserved) slug unchanged', () => {
    expect(pageSlugFromUrl('https://x.com/pages/about-us')).toBe('about-us');
  });
});

describe('claimSlug', () => {
  it('returns the base on first use, suffixes on collision', () => {
    const seen = new Map<string, number>();
    expect(claimSlug('contact', seen)).toBe('contact');
    expect(claimSlug('contact', seen)).toBe('contact-2');
    expect(claimSlug('contact', seen)).toBe('contact-3');
    expect(claimSlug('about', seen)).toBe('about');
  });
});
