// src/platform/builtins.ts
//
// Registers every built-in platform through the same public registerPlatform
// API third-party consumers use — built-ins get no private path into the
// registry. This module is imported for its side effect wherever the registry
// must be populated (the public package entry, the detection engine's
// back-compat barrel, and the legacy adapters shim).
//
// Adding a built-in platform = create src/adapters/<platform>/ (declaring its
// own detection signals) and add ONE registerPlatform line here. No enum, no
// switch, no separate detection table.
import type { Platform } from './types.js';
import { registerPlatform } from './registry.js';
import { defaultAdapter } from '../adapters/default/index.js';
import { godaddyWmAdapter } from '../adapters/godaddy-wm/index.js';
import { hostingerAdapter } from '../adapters/hostinger/index.js';
import { hubspotAdapter } from '../adapters/hubspot/index.js';
import { shopifyAdapter } from '../adapters/shopify/index.js';
import { squarespaceAdapter } from '../adapters/squarespace/index.js';
import { webflowAdapter } from '../adapters/webflow/index.js';
import { weeblyAdapter } from '../adapters/weebly/index.js';
import { wixAdapter } from '../adapters/wix/index.js';

// The generic fallback (id 'default') uses the same Platform contract as every
// other entry; it simply declares no detection signals and is selected
// implicitly when detection names nothing.
registerPlatform( defaultAdapter, { fallback: true } );

// Registration order is deterministic and doubles as the cross-platform
// tiebreak order if several platforms' signals ever matched the same response
// (the last matching platform wins). Built-in signals are fingerprints of
// disjoint platform infrastructure, so in practice this only matters when
// consumer-registered platforms deliberately share signals.
const builtins: Platform[] = [
	godaddyWmAdapter,
	hostingerAdapter,
	hubspotAdapter,
	shopifyAdapter,
	squarespaceAdapter,
	webflowAdapter,
	weeblyAdapter,
	wixAdapter,
];

for ( const platform of builtins ) {
	registerPlatform( platform );
}
