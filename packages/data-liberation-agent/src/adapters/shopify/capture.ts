import type { AdapterCapture } from '../page-actions.js';

/**
 * Shopify storefronts inject third-party app chrome that isn't store content:
 * upCart's cart drawer + sticky button, and Klaviyo teaser popups (kl-teaser-*).
 * Remove them on the live page before capture so they pollute neither the
 * screenshots nor the carried HTML/SectionSpec. Product content comes from the
 * Admin GraphQL/JSON API, so the WXR body is unaffected regardless — this is
 * purely a rendered-capture concern.
 */
export const capture: AdapterCapture = {
  removeSelectors: ['#upCart', '#upCartStickyButton', '[class*="kl-teaser"]'],
};
