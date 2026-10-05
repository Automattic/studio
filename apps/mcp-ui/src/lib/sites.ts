import type { Library, SiteEntry, SiteKind } from '@/data/core';

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

export const liveUrl = ( entry: SiteEntry ) =>
	entry.kind === 'local' && ! entry.site.running ? null : safeUrl( entry.site.url );

export const siteName = ( entry: SiteEntry ) => text( entry.site.name ) || 'Untitled site';

export function findEntry( library: Library | undefined, kind: SiteKind, id: string ) {
	if ( kind === 'local' ) {
		const site = library?.localSites.find( ( candidate ) => String( candidate.id ) === id );
		return site ? ( { kind, key: `local/${ site.id }`, site } as SiteEntry ) : null;
	}
	const site = library?.wpcom.sites.find( ( candidate ) => String( candidate.id ) === id );
	return site ? ( { kind, key: `wpcom/${ site.id }`, site } as SiteEntry ) : null;
}

export function searchEntries( library: Library, query: string ) {
	const needle = query.trim().toLowerCase();
	const matches = ( site: { name?: string; url?: string } ) =>
		! needle || `${ text( site.name ) } ${ text( site.url ) }`.toLowerCase().includes( needle );
	return {
		local: library.localSites
			.filter( matches )
			.map( ( site ): SiteEntry => ( { kind: 'local', key: `local/${ site.id }`, site } ) ),
		wpcom: library.wpcom.sites
			.filter( matches )
			.map( ( site ): SiteEntry => ( { kind: 'wpcom', key: `wpcom/${ site.id }`, site } ) ),
	};
}

export function formatDate( value: unknown ): string {
	const parsed = new Date( text( value ) );
	return value && ! isNaN( parsed.getTime() )
		? parsed.toLocaleDateString( undefined, { year: 'numeric', month: 'short', day: 'numeric' } )
		: '';
}

const DEEP_LINK = /^\/sites\/(local|wpcom)\/([^/?#]+)/;

export function parseDeepLink( url: string ): { kind: SiteKind; id: string } | null {
	const match = DEEP_LINK.exec( url );
	return match ? { kind: match[ 1 ] as SiteKind, id: decodeURIComponent( match[ 2 ] ) } : null;
}
