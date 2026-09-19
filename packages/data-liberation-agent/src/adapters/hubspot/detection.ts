// src/adapters/hubspot/detection.ts — HubSpot's own detection signals.
//
// HubSpot CMS sites use custom domains with no URL signal; detection relies
// on the HubSpot generator meta tag in the page source.
import type { PlatformDetection } from '../../platform/types.js';

export const detection: PlatformDetection = {
	sourceSignals: [
		{
			pattern: /<meta[^>]+name=["']generator["'][^>]+content=["']HubSpot["']/i,
			signal: 'HubSpot generator meta tag',
		},
	],
};
