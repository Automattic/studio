// src/adapters/godaddy-wm/detection.ts — GoDaddy Websites & Marketing signals.
//
// W+M sites run on custom domains — no URL pattern matching; detection comes
// from an infra header and page-source fingerprints.
import type { PlatformDetection } from '../../platform/types.js';

export const detection: PlatformDetection = {
	httpSignals: [ { header: 'x-siteid', signal: 'X-SiteId header (GoDaddy DPS)' } ],
	sourceSignals: [
		{
			pattern: /Go Daddy Website Builder|Starfield Technologies/i,
			signal: 'GoDaddy Website Builder generator meta in page source',
		},
		{
			pattern: /img1\.wsimg\.com\/isteam/i,
			signal: 'img1.wsimg.com/isteam CDN reference in page source',
		},
	],
};
