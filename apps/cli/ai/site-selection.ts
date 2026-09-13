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
export function formatActiveSitePrefix( site: SiteInfo ): string {
	if ( site.remote && site.url ) {
		return `[Active site: "${ site.name }" (ID: ${ site.wpcomSiteId }) at ${ site.url } (WordPress.com)]`;
	}
	return `[Active site: "${ site.name }" at ${ site.path }${
		site.running ? ' (running)' : ' (stopped)'
	}]`;
}
