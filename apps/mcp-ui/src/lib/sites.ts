import type { LocalSite, SiteEntry, WpcomSite } from '@/data/types';

export const text = ( value: unknown ) => ( typeof value === 'string' ? value : '' );

export function safeUrl( value: unknown ): string | null {
	try {
		const url = new URL( text( value ) );
		return [ 'https:', 'http:' ].includes( url.protocol ) ? url.href : null;
	} catch {
		return null;
	}
}

export function hostname( value: string ): string {
	try {
		return new URL( value ).host;
	} catch {
		return '';
	}
}

export const liveUrl = ( { kind, site }: SiteEntry ) =>
	kind === 'local' && ! site.running ? null : safeUrl( site.url );

export const siteName = ( { site }: SiteEntry ) => text( site.name ) || 'Untitled site';

export const entryKey = ( { kind, site }: SiteEntry ) => `${ kind }/${ site.id }`;

export function formatDate( value: unknown ): string {
	const date = new Date( text( value ) );
	return isNaN( date.getTime() )
		? ''
		: date.toLocaleDateString( undefined, { year: 'numeric', month: 'short', day: 'numeric' } );
}

// The sites as entries, both kinds filtered by the search.
export function searchEntries( localSites: LocalSite[], wpcomSites: WpcomSite[], query: string ) {
	const needle = query.trim().toLowerCase();
	const matches = ( entry: SiteEntry ) =>
		! needle ||
		`${ text( entry.site.name ) } ${ text( entry.site.url ) }`.toLowerCase().includes( needle );
	return {
		local: localSites.map( ( site ): SiteEntry => ( { kind: 'local', site } ) ).filter( matches ),
		wpcom: wpcomSites.map( ( site ): SiteEntry => ( { kind: 'wpcom', site } ) ).filter( matches ),
	};
}
