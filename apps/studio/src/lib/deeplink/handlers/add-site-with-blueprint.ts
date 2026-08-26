import { app, dialog, shell } from 'electron';
import nodePath from 'path';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { __ } from '@wordpress/i18n';
import fs from 'fs-extra';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { download } from 'src/lib/download';
import { getLogsFilePath } from 'src/logging';
import { getMainWindow } from 'src/main-window';

function getBlueprintDeeplinkErrorMessage( error: unknown ): string {
	const errorMessage = ( error instanceof Error ? error.message : '' ).toLowerCase();

	const networkErrors = [ 'enotfound', 'econnrefused', 'etimedout', 'network' ];
	if ( networkErrors.some( ( err ) => errorMessage.includes( err ) ) ) {
		return __(
			'Could not connect to the server. Please check your internet connection and try again.'
		);
	}

	return __( 'Please check the link and try again.' );
}

/**
 * Handles the add-site deeplink callback.
 * This function is called when a user clicks a deeplink like:
 * - wp-studio://add-site?blueprint_url=<encoded-url>
 * - wp-studio://add-site?blueprint=<base64-encoded-json>
 *
 * Both URL and Base64 encode json types of blueprints are saved to a temporary file, validated,
 * and then the Add Site modal is opened with the blueprint pre-filled.
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

	if ( ! blueprintUrl && ! blueprintBase64 ) {
		console.error( 'add-site deeplink missing blueprint_url or blueprint parameter' );
		return;
	}

	const tmpDir = nodePath.join( app.getPath( 'temp' ), 'wp-studio-blueprints' );
	await fs.mkdir( tmpDir, { recursive: true } );

	let blueprintPath: string | undefined;
	let blueprintJson: Record< string, unknown >;

	try {
		const timestamp = Date.now();
		blueprintPath = nodePath.join( tmpDir, `blueprint-${ timestamp }.json` );

		// Handle base64-encoded blueprint in the deeplink URL
		if ( blueprintBase64 ) {
			const blueprintJsonString = Buffer.from( blueprintBase64, 'base64' ).toString( 'utf-8' );
			blueprintJson = JSON.parse( blueprintJsonString );
			await fs.writeJson( blueprintPath, blueprintJson );
		} else if ( blueprintUrl ) {
			// Handle blueprint linked in the deeplink URL
			const decodedUrl = decodeURIComponent( blueprintUrl );
			new URL( decodedUrl );

			await download( decodedUrl, blueprintPath, false, 'blueprint' );
			blueprintJson = await fs.readJson( blueprintPath );
		} else {
			return;
		}

		const validation = await validateBlueprintData( blueprintJson );

		if ( ! validation.valid ) {
			throw new Error( validation.error || __( 'Invalid Blueprint format' ) );
		}

		await sendIpcEventToRenderer( 'add-site-with-blueprint', {
			blueprintPath,
		} );
	} catch ( error ) {
		console.error( 'Failed to process Blueprint from deeplink:', error );

		if ( blueprintPath ) {
			await fs.remove( blueprintPath ).catch( () => {
				// Ignore cleanup errors
			} );
		}

		const response = await dialog.showMessageBox( mainWindow, {
			type: 'error',
			message: __( 'Failed to load Blueprint' ),
			detail: getBlueprintDeeplinkErrorMessage( error ),
			buttons: [ __( 'Open Studio Logs' ), __( 'OK' ) ],
			defaultId: 1,
		} );

		if ( response.response === 0 ) {
			const logFilePath = getLogsFilePath();
			const err = await shell.openPath( logFilePath );
			if ( err ) {
				console.error( `Error opening logs file: ${ logFilePath } ${ err }` );
			}
		}
	}
}
