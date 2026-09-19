// src/hosts/netlify.ts
//
// Netlify serves a "Powered by Netlify" badge into pages it hosts. The badge
// is a fixed-position iframe created at runtime by the host's own HUD script,
// so it appears in the rendered DOM while the served HTML contains no frame at
// all. Left unattributed, it reads as an embedded application surface the site
// does not have.
import type { Host } from '../platform/host.js';

export const netlifyHost: Host = {
	id: 'netlify',
	detection: {
		httpSignals: [
			{ header: 'x-nf-request-id', signal: 'Netlify request identifier response header' },
			{ header: 'server', value: 'netlify', signal: 'Netlify server response header' },
		],
		sourceSignals: [
			{
				pattern: /<script\b[^>]*\bsrc=["'][^"']*\/\.netlify\/scripts\//i,
				signal: 'Netlify instrumentation script served from the reserved /.netlify/ path',
			},
		],
	},
	residue: [
		{
			selector: 'iframe#nl-badge-frame',
			evidence: 'Netlify "Powered by Netlify" badge frame, created by the host HUD script',
		},
	],
};
