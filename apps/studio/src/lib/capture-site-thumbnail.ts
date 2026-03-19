import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getImageData } from 'src/lib/get-image-data';
import { SiteServer } from 'src/site-server';
import { getSiteThumbnailPath } from 'src/storage/paths';

// Track in-flight captures to avoid concurrent BrowserWindow creation for the same site.
const pendingCaptures = new Set< string >();

export async function captureSiteThumbnail( id: string ): Promise< void > {
	if ( pendingCaptures.has( id ) ) {
		return;
	}

	const server = SiteServer.get( id );
	if ( ! server || ! server.details.running ) {
		return;
	}

	pendingCaptures.add( id );
	await sendIpcEventToRenderer( 'thumbnail-loading', { id } );
	try {
		await server.updateCachedThumbnail();
		const thumbnailPath = getSiteThumbnailPath( id );
		const thumbnailData = await getImageData( thumbnailPath );
		await sendIpcEventToRenderer( 'thumbnail-loaded', { id, imageData: thumbnailData } );
	} catch ( error ) {
		await sendIpcEventToRenderer( 'thumbnail-load-error', { id } );
		console.error( `Failed to update thumbnail for server ${ id }:`, error );
	} finally {
		pendingCaptures.delete( id );
	}
}
