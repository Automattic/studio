import os from 'os';
import path from 'path';

const WP_CLI_PHAR_FILENAME = 'wp-cli.phar';

export function getServerFilesPath(): string {
	if ( process.platform === 'darwin' ) {
		return path.join( os.homedir(), 'Library', 'Application Support', 'Studio', 'server-files' );
	}
	if ( process.platform === 'win32' ) {
		if ( process.env.APPDATA ) {
			return path.join( process.env.APPDATA, 'Studio', 'server-files' );
		} else {
			throw new Error( 'APPDATA environment variable is not set' );
		}
	}
	throw new Error( 'Unsupported platform' );
}

export function getWpCliPharPath(): string {
	return path.join( getServerFilesPath(), WP_CLI_PHAR_FILENAME );
}
