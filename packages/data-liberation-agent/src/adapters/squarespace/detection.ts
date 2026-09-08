// src/adapters/squarespace/detection.ts — Squarespace's own detection signals.
import type { PlatformDetection } from '../../platform/types.js';

export const detection: PlatformDetection = {
	urlPatterns: [ /squarespace\.com/i ],
	httpSignals: [
		{ header: 'server', value: 'squarespace', signal: 'Server: Squarespace header' },
		{ header: 'x-servedby', value: 'squarespace', signal: 'X-ServedBy: squarespace header' },
	],
	sourceSignals: [
		{
			pattern: /static\.squarespace\.com/i,
			signal: 'static.squarespace.com in page source',
		},
	],
};
