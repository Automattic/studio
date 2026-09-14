import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { decodeTitle, toPreviewPath } from './use-site-search';

export interface FrontLink {
	title: string;
	// Preview path (pathname + search + hash) within the site.
	path: string;
}

interface RawContentItem {
	id?: number;
	link?: string;
	title?: { rendered?: string } | string;
}

function toFrontLink( item: RawContentItem | undefined ): FrontLink | undefined {
	if ( ! item || typeof item.link !== 'string' ) {
		return undefined;
	}
	const path = toPreviewPath( item.link );
	if ( ! path ) {
		return undefined;
	}
	const rawTitle = typeof item.title === 'object' ? item.title?.rendered : item.title;
	return { title: rawTitle ? decodeTitle( rawTitle ) : path, path };
}

/**
 * The newest published post and a published page for a local site, as
 * front-end permalinks — so the preview omnibox can offer real front-end
 * destinations alongside the WP Admin ones. Each lookup is independent, so one
 * missing kind (no posts yet) still yields the other. Returns empty when the
 * site REST API is unreachable (the caller just omits these rows).
 */
export function useSiteFrontLinks( siteId: string, enabled: boolean ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: [ 'site-front-links', siteId ],
		queryFn: async (): Promise< { post?: FrontLink; page?: FrontLink } > => {
			const fetchFirst = async ( path: string ): Promise< FrontLink | undefined > => {
				try {
					const response = await connector.fetchSiteRest( siteId, { path } );
					if ( response.status >= 400 ) {
						return undefined;
					}
					const items = JSON.parse( response.body ) as RawContentItem[];
					return toFrontLink( Array.isArray( items ) ? items[ 0 ] : undefined );
				} catch {
					return undefined;
				}
			};
			const [ post, page ] = await Promise.all( [
				fetchFirst( '/wp/v2/posts?per_page=1&_fields=id,link,title' ),
				fetchFirst( '/wp/v2/pages?per_page=1&_fields=id,link,title' ),
			] );
			return { post, page };
		},
		enabled,
		staleTime: 60_000,
		meta: { persist: false },
	} );
}
