import type { PlatformAdapter } from '../../types.js';
import { capture } from './capture.js';
import { discover } from './discover.js';
import { extract } from './extract.js';

// ---------------------------------------------------------------------------
// Re-exports — public API surface (importers use shopify/index.js by name)
// ---------------------------------------------------------------------------

export { extractShopDomain, scorePageQuality, extractShopifyMediaUrls } from './content.js';
export type { QualitySignals } from './content.js';
export { normalizeWeightToKg, shopifyProductToWoo, shopifyGraphqlProductToWoo } from './products.js';
export type { ShopifyProductJson } from './types.js';
export type { ShopifyAdapterOpts, ShopifyInventory } from './types.js';

// ---------------------------------------------------------------------------
// Adapter assembly
// ---------------------------------------------------------------------------

function detect(url: string): boolean {
  return /myshopify\.com|shopify\.com/i.test(url);
}

export const shopifyAdapter: PlatformAdapter = {
  id: 'shopify',
  capture,
  detect,
  discover,
  extract,
};
