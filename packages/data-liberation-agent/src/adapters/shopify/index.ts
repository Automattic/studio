import type { PlatformAdapter } from '../../types.js';
import { capture } from './capture.js';
import { detection } from './detection.js';
import { discover } from './discover.js';

// ---------------------------------------------------------------------------
// Re-exports — public API surface (importers use shopify/index.js by name)
// ---------------------------------------------------------------------------

export { extractShopDomain, scorePageQuality, extractShopifyMediaUrls } from './content.js';
export type { QualitySignals } from './content.js';
export type { ShopifyProductJson } from './types.js';
export type { ShopifyAdapterOpts, ShopifyInventory } from './types.js';

// ---------------------------------------------------------------------------
// Adapter assembly
// ---------------------------------------------------------------------------

export const shopifyAdapter: PlatformAdapter = {
  id: 'shopify',
  detection,
  liberation: capture,
  discover,
};
