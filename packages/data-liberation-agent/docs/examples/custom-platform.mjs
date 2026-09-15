// docs/examples/custom-platform.mjs
//
// Runnable custom-platform example for an INSTALLED data-liberation package.
// See docs/platform-api.md for the full contract.
//
//   mkdir consumer && cd consumer
//   npm install /path/to/data-liberation-agent-<version>.tgz
//   cp ../docs/examples/custom-platform.mjs .
//   node custom-platform.mjs

import { registerPlatform, detectPlatform, registeredPlatforms } from 'data-liberation';

registerPlatform( {
	id: 'acme-builder',
	detection: {
		// Tier 1 — matched against the URL before any fetch.
		urlPatterns: [ /acme-builder\.example/i ],
		// Tier 2 — response-header fingerprint.
		httpSignals: [
			{ header: 'x-generator', value: 'acme', signal: 'X-Generator: acme header' },
		],
		// Tier 3 — page-source marker (only consulted when no header matched).
		sourceSignals: [
			{ pattern: /cdn\.acme-static\.example/i, signal: 'acme CDN in page source' },
		],
	},
	// Discovery — the one required capability. Return the site's routes.
	async discover( url ) {
		return {
			siteMeta: { title: 'Acme site' },
			urls: [
				{ url, type: 'homepage' },
				{ url: new URL( 'pricing', url ).href, type: 'page' },
			],
		};
	},
	// Optional liberation hooks customize how the source page is prepared.
	liberation: { removeSelectors: [ '.acme-cookie-banner' ] },
} );

// The custom platform joins the built-ins in the same registry.
console.log( 'registered:', registeredPlatforms().map( ( p ) => p.id ).join( ', ' ) );

// Auto-detection now selects it (URL tier — no network needed for this one).
console.log( await detectPlatform( 'https://blog.acme-builder.example/' ) );
