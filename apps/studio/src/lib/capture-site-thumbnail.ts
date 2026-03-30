import { sequential } from '@studio/common/lib/sequential';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getImageData } from 'src/lib/get-image-data';
import { SiteServer } from 'src/site-server';
import { getSiteThumbnailPath } from 'src/storage/paths';

// Capture and cache a site's thumbnail. Uses sequential with deduplicateKey to
// prevent concurrent BrowserWindow creation for the same site and to serialize
// captures across all sites (one at a time).
export const captureSiteThumbnail = sequential< [ string, boolean? ], void >(
	async ( id: string, emitLoadingEvent = true ) => {
		const server = SiteServer.get( id );
		if ( ! server || ! server.details.running ) {
			return;
		}

		if ( emitLoadingEvent ) {
			await sendIpcEventToRenderer( 'thumbnail-loading', { id } );
		}

		try {
			await server.updateCachedThumbnail();
			const thumbnailPath = getSiteThumbnailPath( id );
			const thumbnailData = await getImageData( thumbnailPath );
			await sendIpcEventToRenderer( 'thumbnail-loaded', { id, imageData: thumbnailData } );
		} catch ( error ) {
			await sendIpcEventToRenderer( 'thumbnail-load-error', { id } );
			console.error( `Failed to update thumbnail for server ${ id }:`, error );
		}
	},
	{ deduplicateKey: ( id ) => id }
);
