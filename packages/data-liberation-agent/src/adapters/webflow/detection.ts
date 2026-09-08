// src/adapters/webflow/detection.ts — Webflow's own detection signals.
import type { PlatformDetection } from '../../platform/types.js';

export const detection: PlatformDetection = {
	urlPatterns: [ /webflow\.io|webflow\.com/i ],
	httpSignals: [
		{ header: 'x-powered-by', value: 'webflow', signal: 'X-Powered-By: Webflow header' },
		{ header: 'x-wf-region', signal: 'x-wf-region header (Webflow infrastructure)' },
	],
	sourceSignals: [
		{ pattern: /data-wf-domain/i, signal: 'data-wf-domain attribute in page source' },
	],
};
