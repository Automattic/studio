import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SiteInfo } from 'cli/ai/types';

type LocalSiteSelectedCallback = ( site: SiteInfo ) => void | Promise< void >;

let localSiteSelectedCallback: LocalSiteSelectedCallback | null = null;

export function setLocalSiteSelectedCallback( callback: LocalSiteSelectedCallback | null ) {
	localSiteSelectedCallback = callback;
}

let lastSelectedLocalSite: SiteInfo | null = null;

export async function emitLocalSiteSelected( site: SiteInfo ): Promise< void > {
	lastSelectedLocalSite = site;
	await localSiteSelectedCallback?.( site );
}

// The local site a tool most recently made active, in any turn.
export function getLastSelectedLocalSite(): SiteInfo | null {
	return lastSelectedLocalSite;
}

// Turn-scoped context line prepended to every user prompt so the agent knows
// which site the session is attached to.
export function formatActiveSitePrefix( site: SiteInfo ): string {
	if ( site.remote && site.url ) {
		return `[Active site: "${ site.name }" (ID: ${ site.wpcomSiteId }) at ${ site.url } (WordPress.com)]`;
	}
	const designPath = path.join( site.path, 'DESIGN.md' );
	const design = existsSync( designPath ) ? `, design system: ${ designPath }` : '';
	return `[Active site: "${ site.name }" at ${ site.path }${
		site.running ? ' (running)' : ' (stopped)'
	}${ design }]`;
}
