import { sequential } from '@studio/common/lib/sequential';
import { SiteServer } from 'src/site-server';

// Capture and cache a site's thumbnail. Uses sequential with deduplicateKey to
// prevent concurrent BrowserWindow creation for the same site and to serialize
// captures across all sites (one at a time).
export const captureSiteThumbnail = sequential< [ string ], void >(
	async ( id: string ) => {
		const server = SiteServer.get( id );
		if ( ! server || ! server.details.running ) {
			return;
		}

		try {
			await server.updateCachedThumbnail();
		} catch ( error ) {
			console.error( `Failed to update thumbnail for server ${ id }:`, error );
		}
	},
	{ deduplicateKey: ( id ) => id }
);
