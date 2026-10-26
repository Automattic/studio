import { existsSync } from 'node:fs';
import path from 'node:path';
import { getSiteEmailDirectory } from 'cli/lib/site-email';
import type { SiteInfo } from 'cli/ai/types';

type LocalSiteSelectedCallback = ( site: SiteInfo ) => void | Promise< void >;

let localSiteSelectedCallback: LocalSiteSelectedCallback | null = null;

export function setLocalSiteSelectedCallback( callback: LocalSiteSelectedCallback | null ) {
	localSiteSelectedCallback = callback;
}

export async function emitLocalSiteSelected( site: SiteInfo ): Promise< void > {
	await localSiteSelectedCallback?.( site );
}

// The active site, as the system prompt states it: which site the session is
// attached to, rebuilt every turn from Studio's site data.
export function formatActiveSite( site: SiteInfo ): string {
	if ( site.remote && site.url ) {
		return `"${ site.name }" (ID: ${ site.wpcomSiteId }) at ${ site.url } (WordPress.com)`;
	}
	const designPath = path.join( site.path, 'DESIGN.md' );
	const design = existsSync( designPath ) ? `, design system: ${ designPath }` : '';
	const emailPath = site.id ? getSiteEmailDirectory( site.id ) : undefined;
	const email = emailPath && existsSync( emailPath ) ? `, email it sent: ${ emailPath }` : '';
	return `"${ site.name }" at ${ site.path }${
		site.running ? ' (running)' : ' (stopped)'
	}${ design }${ email }`;
}
