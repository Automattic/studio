// src/adapters/weebly/detection.ts — Weebly's own detection signals.
import type { PlatformDetection } from '../../platform/types.js';

export const detection: PlatformDetection = {
	urlPatterns: [ /weebly\.com/i ],
	httpSignals: [
		{
			header: 'x-host',
			value: 'weebly.net',
			signal: 'X-Host: *.weebly.net header (Weebly backend)',
		},
	],
	sourceSignals: [
		{ pattern: /editmysite\.com/i, signal: 'editmysite.com CDN in page source' },
		{
			pattern: /wsite-menu-item|wsite-content|_W\.configDomain\s*=\s*["'].*weebly/i,
			signal: 'Weebly markers in page source',
		},
	],
};
