import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { backgroundTasks } from 'src/lib/background-tasks';
import { getImageData } from 'src/lib/get-image-data';
import { SiteServer } from 'src/site-server';
import { getSiteThumbnailPath } from 'src/storage/paths';

// Capture and cache a site's thumbnail. Routed through the background task
// scheduler to dedupe concurrent captures and keep BrowserWindow work off the
// caller's critical path.
export function captureSiteThumbnail( id: string, emitLoadingEvent = true ): Promise< void > {
	return backgroundTasks.enqueue( {
		name: 'capture-site-thumbnail',
		scope: `site:${ id }`,
		concurrencyGroup: 'site-thumbnail-capture',
		requiresRunning: () => SiteServer.get( id )?.details.running === true,
		run: async () => {
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
	} );
}
