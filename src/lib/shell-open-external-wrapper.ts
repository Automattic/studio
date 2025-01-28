import { shell, dialog } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';

// Determines if an error should be muted (not reported to Sentry) based on known "application not
// found" error codes.
const shouldMute = ( error: Error ) => {
	return error.message.endsWith( '(0x800401F5)' );
};

// This wrapper handles shell.openExternal errors, showing appropriate dialog messages
// while only reporting specific errors to Sentry. Some common "application not found"
// errors are muted to avoid unnecessary error reporting.
export const shellOpenExternalWrapper = async ( url: string ) => {
	try {
		await shell.openExternal( url );
	} catch ( error ) {
		if ( error instanceof Error && ! shouldMute( error ) ) {
			Sentry.captureException( error );
		}

		let title = '';
		let message = '';
		if ( url.startsWith( 'vscode://file/' ) ) {
			title = __( 'Failed to open VS Code' );
			message = __(
				'Studio is unable to open VS Code. Please ensure it is functioning correctly.'
			);
		} else if ( url.startsWith( 'phpstorm://open?file=' ) ) {
			title = __( 'Failed to open PHP Storm' );
			message = __(
				'Studio is unable to open PHPStorm. Please ensure it is functioning correctly.'
			);
		} else {
			title = __( 'Failed to open browser' );
			message = __(
				'Studio is unable to open your default browser. Please ensure it is functioning correctly.'
			);
		}

		dialog.showMessageBox( {
			type: 'error',
			message: title,
			detail: message,
			buttons: [ __( 'OK' ) ],
		} );
	}
};
