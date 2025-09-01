import { spawn } from 'child_process';
import { __ } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';

/**
 * Opens the default browser with the specified URL
 */
export async function openBrowser( url: string ): Promise< void > {
	const platform = process.platform;
	let cmd: string;
	let args: string[];

	switch ( platform ) {
		case 'darwin':
			cmd = 'open';
			args = [ url ];
			break;
		case 'win32':
			cmd = 'rundll32';
			args = [ 'url.dll,FileProtocolHandler', url ];
			break;
		default:
			cmd = 'xdg-open';
			args = [ url ];
			break;
	}

	return new Promise( ( resolve, reject ) => {
		const child = spawn( cmd, args );

		child.on( 'error', ( error ) => {
			reject(
				new LoggerError( __( 'Failed to open browser. Please open the URL manually.' ), error )
			);
		} );

		child.on( 'exit', ( code ) => {
			if ( code === 0 ) {
				resolve();
			} else {
				reject( new LoggerError( __( 'Failed to open browser. Please open the URL manually.' ) ) );
			}
		} );
	} );
}
