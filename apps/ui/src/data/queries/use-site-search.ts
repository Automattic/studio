import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export interface SiteSearchResult {
	id: number;
	title: string;
	// Preview path (pathname + search + hash) within the site.
	path: string;
	// REST subtype, e.g. 'page' or 'post'.
	subtype: string;
}

interface RawSearchResult {
	id?: number;
	title?: string;
	url?: string;
	subtype?: string;
}

// REST titles arrive entity-encoded (e.g. `&amp;`); flatten to plain text
// for display.
export function decodeTitle( value: string ): string {
	const doc = new DOMParser().parseFromString( value, 'text/html' );
	return ( doc.body.textContent ?? '' ).trim();
}

// The results come from the site's own REST API, so their origin is the site
// by construction — but it may be spelled differently from the preview URL
// (REST can advertise `127.0.0.1:<port>` while the preview uses `localhost`).
// Take the path portion without comparing origins.
export function toPreviewPath( url: string ): string | null {
	try {
		const parsed = new URL( url );
		return `${ parsed.pathname }${ parsed.search }${ parsed.hash }`;
	} catch {
		return null;
	}
}

/**
 * Searches a local site's pages, posts, and public CPTs through the site's
 * REST API (`/wp/v2/search`), for the preview omnibox.
 */
export function useSiteSearch( siteId: string, term: string, enabled: boolean ) {
	const connector = useConnector();
	const trimmedTerm = term.trim();
	return useQuery( {
		queryKey: [ 'site-search', siteId, trimmedTerm ],
		queryFn: async (): Promise< SiteSearchResult[] > => {
			const response = await connector.fetchSiteRest( siteId, {
				path: `/wp/v2/search?search=${ encodeURIComponent(
					trimmedTerm
				) }&per_page=8&_fields=id,title,url,type,subtype`,
			} );
			if ( response.status >= 400 ) {
				throw new Error( `Site search failed with status ${ response.status }.` );
			}
			const items = JSON.parse( response.body ) as RawSearchResult[];
			const results: SiteSearchResult[] = [];
			for ( const item of items ) {
				if ( typeof item.id !== 'number' || typeof item.url !== 'string' ) {
					continue;
				}
				const path = toPreviewPath( item.url );
				if ( ! path ) {
					continue;
				}
				results.push( {
					id: item.id,
					title: typeof item.title === 'string' ? decodeTitle( item.title ) : path,
					path,
					subtype: item.subtype ?? '',
				} );
			}
			return results;
		},
		enabled: enabled && trimmedTerm.length > 0,
		placeholderData: keepPreviousData,
		staleTime: 30_000,
		meta: { persist: false },
	} );
}
