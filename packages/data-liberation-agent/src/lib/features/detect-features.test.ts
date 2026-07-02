import { describe, it, expect } from 'vitest';
import { detectFeatures, type PlatformFeature } from './detect-features.js';

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
});
