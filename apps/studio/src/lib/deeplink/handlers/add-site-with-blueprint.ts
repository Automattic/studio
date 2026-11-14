import { dialog, shell } from 'electron';
import { validateBlueprint } from '@studio/blueprints';
import { openBlueprint } from '@studio/blueprints/node';
import { isNetworkError } from '@studio/common/lib/network-utils';
import { __ } from '@wordpress/i18n';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getLogsFilePath } from 'src/logging';
import { getMainWindow } from 'src/main-window';

function getBlueprintDeeplinkErrorMessage( error: unknown ): string {
	if ( isNetworkError( error ) ) {
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
 * The Blueprint is checked, then the Add Site modal opens with it pre-filled. A Blueprint from a
 * URL is fetched again when the site is created, so its bundled files come along.
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

	try {
		if ( blueprintUrl ) {
			const source = new URL( decodeURIComponent( blueprintUrl ) ).href;
			await using opened = await openBlueprint( source );
			await sendIpcEventToRenderer( 'add-site-with-blueprint', {
				blueprint: opened.blueprint,
				source,
			} );
		} else {
			const blueprint = validateBlueprint(
				JSON.parse( Buffer.from( blueprintBase64 ?? '', 'base64' ).toString( 'utf-8' ) )
			);
			await sendIpcEventToRenderer( 'add-site-with-blueprint', { blueprint } );
		}
	} catch ( error ) {
		console.error( 'Failed to process Blueprint from deeplink:', error );

		const response = await dialog.showMessageBox( mainWindow, {
			type: 'error',
			message: __( 'Failed to load Blueprint' ),
			detail: getBlueprintDeeplinkErrorMessage( error ),
			buttons: [ __( 'Open WordPress Studio Logs' ), __( 'OK' ) ],
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
