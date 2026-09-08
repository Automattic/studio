// src/adapters/wix/detection.ts
//
// Wix's automatic-detection signals, owned here (next to the adapter) rather
// than in a central detection table. The tiered engine in
// src/lib/detect-platform consumes these via the platform registry.
import type { PlatformDetection } from '../../platform/types.js';

export const detection: PlatformDetection = {
	urlPatterns: [ /wixsite\.com|wix\.com/i ],
	httpSignals: [ { header: 'x-wix-request-id', signal: 'X-Wix-Request-Id header' } ],
	sourceSignals: [
		{ pattern: /wixstatic\.com/i, signal: 'wixstatic.com in page source' },
	],
};
