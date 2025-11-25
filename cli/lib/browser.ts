import { spawn } from 'child_process';

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
			cmd = 'PowerShell';
			args = [
				'-NoProfile',
				'-NonInteractive',
				'-ExecutionPolicy',
				'Bypass',
				'-Command',
				'Start',
				`"${ url }"`,
			];
			break;
		case 'linux':
			cmd = 'xdg-open';
			args = [ url ];
			break;
		default:
			return Promise.reject( new Error( 'Unsupported platform' ) );
	}

	return new Promise( ( resolve, reject ) => {
		const child = spawn( cmd, args, {
			env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		} );

		child.on( 'error', reject );

		child.on( 'exit', ( code ) => {
			if ( code === 0 ) {
				resolve();
			} else {
				reject( new Error( 'Failed to open browser' ) );
			}
		} );
	} );
}
