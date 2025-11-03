import { app } from 'electron';
import nodePath from 'path';
import { __ } from '@wordpress/i18n';
import fs from 'fs-extra';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { download } from 'src/lib/download';
import { getMainWindow } from 'src/main-window';

/**
 * Handles the add-site deeplink callback.
 * This function is called when a user clicks a deeplink like:
 * wpcom-local-dev://add-site?blueprint_url=<encoded-url>
 *
 * It downloads the blueprint from the URL, saves it locally, and opens the Add Site modal
 * with the blueprint pre-filled.
 */
export async function handleAddSiteBlueprintWithUrl( urlObject: URL ): Promise< void > {
	const { searchParams } = urlObject;
	const blueprintUrl = searchParams.get( 'blueprint_url' );

	if ( ! blueprintUrl ) {
		console.error( 'add-site deeplink missing blueprint_url parameter' );
		return;
	}

	try {
		const decodedUrl = decodeURIComponent( blueprintUrl );
		new URL( decodedUrl );
	} catch ( error ) {
		console.error( 'Invalid blueprint_url in add-site deeplink:', error );
		return;
	}

	const decodedUrl = decodeURIComponent( blueprintUrl );

	const tmpDir = nodePath.join( app.getPath( 'temp' ), 'wp-studio-blueprints' );
	await fs.mkdir( tmpDir, { recursive: true } );

	const urlHash = Buffer.from( decodedUrl ).toString( 'base64url' ).slice( 0, 16 );
	const blueprintPath = nodePath.join( tmpDir, `blueprint-${ urlHash }.json` );

	try {
		await download( decodedUrl, blueprintPath, false, 'blueprint' );

		const mainWindow = await getMainWindow();
		if ( mainWindow.isMinimized() ) {
			mainWindow.restore();
		}
		mainWindow.focus();

		await sendIpcEventToRenderer( 'add-site-blueprint', { blueprintPath } );
	} catch ( error ) {
		console.error( 'Failed to download blueprint from deeplink:', error );
		await fs.remove( blueprintPath ).catch( () => {
			// Ignore cleanup errors
		} );
	}
}
