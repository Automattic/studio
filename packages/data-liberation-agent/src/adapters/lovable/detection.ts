import type { PlatformDetection } from '../../platform/types.js';

export const detection: PlatformDetection = {
	urlPatterns: [ /lovable\.app|lovable\.dev/i ],
	sourceSignals: [
		{ pattern: /id=["']lovable-badge["']|#lovable-badge/i, signal: '#lovable-badge in page source' },
		{ pattern: /utm_source=lovable-badge|lovable\.dev\/projects\//i, signal: 'Lovable project badge URL in page source' },
	],
};
