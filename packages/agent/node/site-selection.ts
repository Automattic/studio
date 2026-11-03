import { existsSync } from 'node:fs';
import path from 'node:path';
import { getSiteEmailDirectory } from '@studio/common/sites/site-email';
import type { SiteInfo } from './types';

// The active site, as the system prompt states it: which site the session is
// attached to, rebuilt every turn from Studio's site data.
export function formatActiveSite( site: SiteInfo ): string {
	if ( site.remote && site.url ) {
		return `"${ site.name }" (ID: ${ site.wpcomSiteId }) at ${ site.url } (WordPress.com)`;
	}
	const designPath = path.join( site.path, 'DESIGN.md' );
	const design = existsSync( designPath ) ? `, design system: ${ designPath }` : '';
	const email = site.id
		? `, email it sends: ${ getSiteEmailDirectory( site.id ) } (one .eml file per message)`
		: '';
	return `"${ site.name }" at ${ site.path }${
		site.running ? ' (running)' : ' (stopped)'
	}${ design }${ email }`;
}
