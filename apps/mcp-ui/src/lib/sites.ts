import type { LocalSite } from '@/data/types';

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

export const liveUrl = ( site: LocalSite ) => ( site.running ? safeUrl( site.url ) : null );

export const siteName = ( site: LocalSite ) => text( site.name ) || 'Untitled site';

export function searchSites( sites: LocalSite[], query: string ): LocalSite[] {
	const needle = query.trim().toLowerCase();
	return sites.filter(
		( site ) =>
			! needle || `${ text( site.name ) } ${ text( site.url ) }`.toLowerCase().includes( needle )
	);
}
