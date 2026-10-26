import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useConnector } from '@/data/core';
import { siteThumbnailQueryKey } from '@/data/queries/use-site-thumbnail';
import { getPathFromPreviewUrl } from './address-bar';

// Keeps the page that just loaded as the site's picture for while it's
// stopped, once the page has had a moment to settle.
export function usePreviewCapture(
	siteId: string,
	siteUrl: string,
	viewportRef: RefObject< HTMLDivElement | null >
) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const [ loadedPage, setLoadedPage ] = useState< { url: string; guestId?: number } | null >(
		null
	);
	useEffect( () => {
		const pagePath = loadedPage && getPathFromPreviewUrl( loadedPage.url, siteUrl );
		if ( ! pagePath ) {
			return;
		}
		const timer = setTimeout( () => {
			const viewport = viewportRef.current;
			if ( ! viewport?.clientWidth || ! viewport.clientHeight ) {
				return;
			}
			void connector
				.captureSitePreview( siteId, {
					path: pagePath,
					width: Math.min( viewport.clientWidth, 2400 ),
					height: Math.min( viewport.clientHeight, 2400 ),
					guestId: loadedPage.guestId,
				} )
				.then( ( thumbnail ) => {
					if ( thumbnail ) {
						queryClient.setQueryData( siteThumbnailQueryKey( siteId ), thumbnail );
					}
				} )
				.catch( () => undefined );
		}, 240 );
		return () => clearTimeout( timer );
	}, [ connector, loadedPage, queryClient, siteId, siteUrl, viewportRef ] );
	return useCallback( ( url: string, guestId?: number ) => setLoadedPage( { url, guestId } ), [] );
}
