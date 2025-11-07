import { app, dialog } from 'electron';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';
import fs from 'fs-extra';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { download } from 'src/lib/download';
import { getMainWindow } from 'src/main-window';

/**
 * Handles the add-site deeplink callback.
 * This function is called when a user clicks a deeplink like:
 * - wpcom-local-dev://add-site?blueprint_url=<encoded-url>
 * - wpcom-local-dev://add-site?blueprint=<base64-encoded-json>
 *
 * It either downloads the blueprint from the URL or decodes the base64 blueprint,
 * and opens the Add Site modal with the blueprint pre-filled.
 */
export async function handleAddSiteWithBlueprint( urlObject: URL ): Promise< void > {
	const { searchParams } = urlObject;
	const blueprintUrl = searchParams.get( 'blueprint_url' );
	const blueprintBase64 = searchParams.get( 'blueprint' );

	const mainWindow = await getMainWindow();
	if ( mainWindow.isMinimized() ) {
		mainWindow.restore();
	}
	mainWindow.focus();

	// Handle base64-encoded blueprint in the deeplink URL
	if ( blueprintBase64 ) {
		try {
			const blueprintJson = Buffer.from( blueprintBase64, 'base64' ).toString( 'utf-8' );
			JSON.parse( blueprintJson );
			await sendIpcEventToRenderer( 'add-site-blueprint-from-base64', { blueprintJson } );
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( 'Failed to parse blueprint from deeplink:', error );
		}
		return;
	}

	// Handle blueprint linked in the deeplink URL
	if ( ! blueprintUrl ) {
		console.error( 'add-site deeplink missing blueprint_url or blueprint parameter' );
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
		await sendIpcEventToRenderer( 'add-site-blueprint-from-url', { blueprintPath } );
	} catch ( error ) {
		console.error( 'Failed to download blueprint from deeplink:', error );
		await fs.remove( blueprintPath ).catch( () => {
			// Ignore cleanup errors
		} );

		const mainWindow = await getMainWindow();
		await dialog.showMessageBox( mainWindow, {
			type: 'error',
			message: __( 'Failed to download blueprint' ),
			detail: __( 'The blueprint could not be downloaded. Please check the URL and try again.' ),
			buttons: [ __( 'OK' ) ],
		} );
	}
}
