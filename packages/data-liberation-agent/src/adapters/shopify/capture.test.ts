import { describe, it, expect } from 'vitest';
import { capture } from './capture.js';
import { shopifyAdapter } from './index.js';

describe('shopify capture', () => {
  it('declares the app-widget removal selectors', () => {
    expect(capture.removeSelectors).toEqual(
      expect.arrayContaining(['#upCart', '#upCartStickyButton', '[class*="kl-teaser"]']),
    );
  });
  it('is attached to the adapter', () => {
    expect(shopifyAdapter.capture).toBe(capture);
  });
});
