import fs from 'fs';
import nodePath from 'path';
import { sequential } from '@studio/common/lib/sequential';
import { createScreenshotWindow } from 'src/screenshot-window';
import { getSiteThumbnailPath } from 'src/storage/paths';

// Capture and cache a running site's thumbnail. Uses sequential with deduplicateKey to
// prevent concurrent BrowserWindow creation for the same site and to serialize
// captures across all sites (one at a time).
export const captureSiteThumbnail = sequential< [ { id: string; url: string } ], void >(
	async ( { id, url } ) => {
		const { window, waitForCapture } = createScreenshotWindow(
			new URL( '/?studio-hide-adminbar', url ).href
		);
		const outPath = getSiteThumbnailPath( id );
		let image: Electron.NativeImage | undefined;
		try {
			await fs.promises.mkdir( nodePath.dirname( outPath ), { recursive: true } );
			image = await waitForCapture();
			await fs.promises.writeFile( outPath, image.toPNG() );
		} catch ( error ) {
			// A failed load keeps the previous thumbnail; a failed write must not leave a partial one.
			if ( image ) {
				await fs.promises.rm( outPath, { force: true } ).catch( () => undefined );
			}
			console.error( `Failed to update thumbnail for site ${ id }:`, error );
		} finally {
			window.destroy();
		}
	},
	{ deduplicateKey: ( { id } ) => id }
);
