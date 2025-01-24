import { shell, dialog } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';

// Check if error is one of the known "application not found" errors that we checked and can mute
// Examples of errors which can be muted:
// "Failed to open: 没有应用程序与此操作的指定文件有关联。 (0x483)"
// "Failed to open: Application not found (0x800401F5)"
const shouldMute = ( error: Error ) => {
	return (
		error.message.startsWith( 'Failed to open:' ) &&
		( error.message.endsWith( '(0x483)' ) || error.message.endsWith( '(0x800401F5)' ) )
	);
};

// With this wrapper some errors are mutes and some not
// And we throw just simple message which can be rendered at the frontend
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
			title = __( 'Failed to open "VS Code"' );
			message = __( 'Studio is unable to open VS Code. Please ensure it is functioning correctly' );
		} else if ( url.startsWith( 'phpstorm://open?file=' ) ) {
			title = __( 'Failed to open "PHP Storm"' );
			message = __(
				'Studio is unable to open PHPStorm. Please ensure it is functioning correctly'
			);
		} else {
			title = __( 'Failed to open browser' );
			message = __(
				'Studio is unable to open your default browser. Please ensure it is functioning correctly'
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
