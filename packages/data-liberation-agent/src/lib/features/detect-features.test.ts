import { describe, it, expect } from 'vitest';
import { detectFeatures, fetchFeatureHtmlSamples } from './detect-features.js';

describe('detectFeatures', () => {
  it('detects Wix Stores from URL patterns', () => {
    const urls = [
      'https://example.com/',
      'https://example.com/product-page/cool-shirt',
      'https://example.com/about',
    ];
    const features = detectFeatures('wix', urls, []);
    const store = features.find((f) => f.id === 'store');
    expect(store).toBeDefined();
    expect(store!.detected).toBe(true);
    expect(store!.transferable).toBe(true);
  });

  it('detects Wix Bookings from URL patterns', () => {
    const urls = [
      'https://example.com/',
      'https://example.com/booking-calendar/service-1',
    ];
    const features = detectFeatures('wix', urls, []);
    const bookings = features.find((f) => f.id === 'bookings');
    expect(bookings).toBeDefined();
    expect(bookings!.detected).toBe(true);
  });

  it('detects forms from HTML markers', () => {
    const htmlSamples = [
      '<div data-mesh-id="comp-form123"></div>',
    ];
    const features = detectFeatures('wix', [], htmlSamples);
    const forms = features.find((f) => f.id === 'forms');
    expect(forms).toBeDefined();
    expect(forms!.detected).toBe(true);
  });

  it('detects Wix Members from URL patterns', () => {
    const urls = ['https://example.com/members-area/profile'];
    const features = detectFeatures('wix', urls, []);
    const members = features.find((f) => f.id === 'members');
    expect(members).toBeDefined();
    expect(members!.detected).toBe(true);
  });

  it('detects Squarespace Commerce from URL patterns', () => {
    const urls = ['https://example.com/store/p/widget'];
    const features = detectFeatures('squarespace', urls, []);
    const store = features.find((f) => f.id === 'store');
    expect(store).toBeDefined();
    expect(store!.detected).toBe(true);
    expect(store!.transferable).toBe(true);
  });

  it('detects Shopify features from URL patterns', () => {
    const urls = ['https://example.com/collections/all', 'https://example.com/products/widget'];
    const features = detectFeatures('shopify', urls, []);
    const store = features.find((f) => f.id === 'store');
    expect(store).toBeDefined();
    expect(store!.detected).toBe(true);
  });

  it('detects Webflow forms from HTML markers', () => {
    const htmlSamples = ['<form class="w-form"><input type="text" /></form>'];
    const features = detectFeatures('webflow', [], htmlSamples);
    const forms = features.find((f) => f.id === 'forms');
    expect(forms).toBeDefined();
    expect(forms!.detected).toBe(true);
  });

  it('detects Squarespace Scheduling from HTML markers', () => {
    const htmlSamples = ['<div class="sqs-block-schedulingblock"></div>'];
    const features = detectFeatures('squarespace', [], htmlSamples);
    const scheduling = features.find((f) => f.id === 'scheduling');
    expect(scheduling).toBeDefined();
    expect(scheduling!.detected).toBe(true);
  });

  it('returns no detections for a plain site', () => {
    const urls = ['https://example.com/', 'https://example.com/about'];
    const features = detectFeatures('wix', urls, []);
    const detected = features.filter((f) => f.detected);
    expect(detected).toEqual([]);
  });

  it('returns all possible features even when not detected', () => {
    const features = detectFeatures('wix', [], []);
    expect(features.length).toBeGreaterThan(0);
    expect(features.every((f) => typeof f.id === 'string')).toBe(true);
    expect(features.every((f) => typeof f.detected === 'boolean')).toBe(true);
  });

  it('includes wpRecommendation for detected features', () => {
    const urls = ['https://example.com/product-page/widget'];
    const features = detectFeatures('wix', urls, []);
    const store = features.find((f) => f.id === 'store' && f.detected);
    expect(store).toBeDefined();
    expect(store!.wpRecommendation).toBeTruthy();
  });

  // --- Weebly: previously excluded from every rule, so a Weebly site always
  // came back feature-less. Weebly sites unpublish 27 Sep 2026; triage needs this.

  it('detects a Weebly (Square) store from URL patterns', () => {
    const urls = ['https://example.com/store/c1/Prints.html', 'https://example.com/store/p12/Riso-Print.html'];
    const features = detectFeatures('weebly', urls, []);
    const store = features.find((f) => f.id === 'store');
    expect(store!.detected).toBe(true);
    expect(store!.evidence).toEqual(['url']);
  });

  it('detects a Weebly store from wsite-com markup', () => {
    const html = ['<div class="wsite-com-category-product-wrap"><a class="wsite-com-product-title">Print</a></div>'];
    const features = detectFeatures('weebly', ['https://example.com/'], html);
    expect(features.find((f) => f.id === 'store')!.detected).toBe(true);
  });

  it('detects Weebly forms from wsite-form markup', () => {
    const html = ['<div class="wsite-form-container"><input class="wsite-form-input wsite-input" /></div>'];
    const features = detectFeatures('weebly', [], html);
    expect(features.find((f) => f.id === 'forms')!.detected).toBe(true);
  });

  it('detects a Weebly forum from the /forum/ path', () => {
    const features = detectFeatures('weebly', ['https://example.com/forum/general'], []);
    expect(features.find((f) => f.id === 'forum')!.detected).toBe(true);
  });

  it('offers store, forms, members and forum rules for Weebly', () => {
    const ids = detectFeatures('weebly', [], []).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['store', 'forms', 'members', 'forum', 'bookings']));
  });

  // --- Evidence: lets triage distinguish a slug hit from a markup hit.

  it('reports which signal fired', () => {
    const features = detectFeatures(
      'wix',
      ['https://example.com/events/gala'],
      ['<div data-hook="events-list"></div>'],
    );
    expect(features.find((f) => f.id === 'events')!.evidence).toEqual(['url', 'html']);
    expect(features.find((f) => f.id === 'store')!.evidence).toEqual([]);
  });

  // --- New rules that change the DIFM triage verdict.

  it('detects Wix Restaurants from markup and ordering URLs', () => {
    const byUrl = detectFeatures('wix', ['https://example.com/online-ordering'], []);
    expect(byUrl.find((f) => f.id === 'restaurants')!.detected).toBe(true);
    const byHtml = detectFeatures('wix', [], ['<div data-hook="restaurants-menu"></div>']);
    expect(byHtml.find((f) => f.id === 'restaurants')!.detected).toBe(true);
  });

  it('detects Wix Pricing Plans', () => {
    const features = detectFeatures('wix', ['https://example.com/plans-pricing'], []);
    expect(features.find((f) => f.id === 'pricing-plans')!.detected).toBe(true);
  });

  it('detects a multilingual Wix site from language-prefixed URLs', () => {
    const urls = ['https://example.com/', 'https://example.com/about', 'https://example.com/es/about'];
    const features = detectFeatures('wix', urls, []);
    expect(features.find((f) => f.id === 'multilingual')!.detected).toBe(true);
  });

  it('does not flag two-letter section slugs as languages', () => {
    const urls = ['https://example.com/my/account', 'https://example.com/go/somewhere'];
    const features = detectFeatures('wix', urls, []);
    expect(features.find((f) => f.id === 'multilingual')!.detected).toBe(false);
  });

  it('detects Velo / CMS from the Wix code runtime in page markup', () => {
    const features = detectFeatures('wix', [], ['<script src="https://static.parastorage.com/services/wix-code-sdk/1.0/app.js"></script>']);
    expect(features.find((f) => f.id === 'cms')!.detected).toBe(true);
  });

  it('does not offer Wix-only rules for other platforms', () => {
    const ids = detectFeatures('weebly', [], []).map((f) => f.id);
    expect(ids).not.toContain('restaurants');
    expect(ids).not.toContain('cms');
  });
});

describe('fetchFeatureHtmlSamples', () => {
  it('fetches the homepage first, then sitemap URLs, up to the sample size', async () => {
    const seen: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      seen.push(String(input));
      return new Response('<html>' + String(input) + '</html>', { status: 200 });
    }) as typeof fetch;
    const urls = ['https://example.com/', 'https://example.com/a', 'https://example.com/b', 'https://example.com/c', 'https://example.com/d'];
    const samples = await fetchFeatureHtmlSamples('example.com', urls, 3, fakeFetch);
    expect(seen).toEqual(['https://example.com', 'https://example.com/a', 'https://example.com/b']);
    expect(samples).toHaveLength(3);
  });

  it('drops failed fetches instead of throwing', async () => {
    const fakeFetch = (async (input: string | URL | Request) => {
      if (String(input).endsWith('/broken')) throw new Error('boom');
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
    const samples = await fetchFeatureHtmlSamples('https://example.com', ['https://example.com/broken'], 2, fakeFetch);
    expect(samples).toEqual(['ok']);
  });
});
