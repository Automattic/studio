import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SiteInfo } from 'cli/ai/types';

type LocalSiteSelectedCallback = ( site: SiteInfo ) => void | Promise< void >;

let localSiteSelectedCallback: LocalSiteSelectedCallback | null = null;

export function setLocalSiteSelectedCallback( callback: LocalSiteSelectedCallback | null ) {
	localSiteSelectedCallback = callback;
}

export async function emitLocalSiteSelected( site: SiteInfo ): Promise< void > {
	await localSiteSelectedCallback?.( site );
}

// Turn-scoped context line prepended to every user prompt so the agent knows
// which site the session is attached to.
// `remoteCapabilities` describes what a WordPress.com site's plan and the
// user's role allow (describeWpcomSiteCapabilities).
export function formatActiveSitePrefix( site: SiteInfo, remoteCapabilities?: string ): string {
	if ( site.remote && site.url ) {
		return `[Active site: "${ site.name }" (ID: ${ site.wpcomSiteId }) at ${
			site.url
		} (WordPress.com${ remoteCapabilities ? `; ${ remoteCapabilities }` : '' })]`;
	}
	const designPath = path.join( site.path, 'DESIGN.md' );
	const design = existsSync( designPath ) ? `, design system: ${ designPath }` : '';
	return `[Active site: "${ site.name }" at ${ site.path }${
		site.running ? ' (running)' : ' (stopped)'
	}${ design }]`;
}
