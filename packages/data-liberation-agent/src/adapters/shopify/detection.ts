// src/adapters/shopify/detection.ts — Shopify's own detection signals.
import type { PlatformDetection } from '../../platform/types.js';

export const detection: PlatformDetection = {
	urlPatterns: [ /myshopify\.com|shopify\.com/i ],
	httpSignals: [
		{ header: 'x-shopid', signal: 'X-ShopId header' },
		{ header: 'powered-by', value: 'shopify', signal: 'Powered-by: Shopify header' },
	],
	sourceSignals: [
		{ pattern: /cdn\.shopify\.com/i, signal: 'cdn.shopify.com in page source' },
		{
			pattern: /_shopify_s|_shopify_y|Shopify\.theme/i,
			signal: 'Shopify markers in page source',
		},
	],
};
