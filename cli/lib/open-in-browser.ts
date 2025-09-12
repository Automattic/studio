import { spawn } from 'child_process';

export function openInBrowser( url: string ): void {
	let cmd: string;
	let args: string[];

	switch ( process.platform ) {
		case 'darwin':
			cmd = 'open';
			args = [ url ];
			break;
		case 'linux':
			cmd = 'xdg-open';
			args = [ url ];
			break;
		case 'win32':
			cmd = 'cmd';
			args = [ '/c', `start ${ url }` ];
			break;
		default:
			throw new Error( 'Platform not supported for opening browser' );
	}

	spawn( cmd, args ).on( 'error', () => {
		throw new Error( 'Failed to open browser' );
	} );
}
