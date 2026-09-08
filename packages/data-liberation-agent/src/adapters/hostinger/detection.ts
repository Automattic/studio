// src/adapters/hostinger/detection.ts — Hostinger's own detection signals.
//
// Hostinger sites live on custom domains with no URL signal; detection relies
// entirely on page-source fingerprinting.
import type { PlatformDetection } from '../../platform/types.js';

export const detection: PlatformDetection = {
	sourceSignals: [
		{
			pattern: /zyrosite\.com/i,
			signal: 'zyrosite.com CDN in page source (Hostinger Website Builder)',
		},
		{
			pattern: /<meta[^>]+name=["']generator["'][^>]+content=["']Hostinger[^"']*["']/i,
			signal: 'Hostinger generator meta tag',
		},
	],
};
