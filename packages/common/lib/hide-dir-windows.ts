import { execFile } from 'child_process';
import path from 'path';

/**
 * Sets the "hidden" attribute on a directory on Windows using `attrib +H`.
 * No-op on non-Windows platforms.
 */
export async function hideDirectoryOnWindows( dirPath: string ): Promise< void > {
	if ( process.platform !== 'win32' ) {
		return;
	}
	return new Promise( ( resolve ) => {
		execFile( 'attrib', [ '+H', dirPath ], () => {
			resolve();
		} );
	} );
}

/**
 * Returns true if the directory has the "hidden" attribute set on Windows.
 * Always returns false on non-Windows platforms.
 */
export async function isDirectoryHiddenOnWindows( dirPath: string ): Promise< boolean > {
	if ( process.platform !== 'win32' ) {
		return false;
	}
	const resolvedPath = path.resolve( dirPath );
	return new Promise( ( resolve ) => {
		execFile( 'attrib', [ resolvedPath ], ( error, stdout ) => {
			if ( error ) {
				resolve( false );
				return;
			}
			// attrib output format: "     H  C:\path\to\dir"
			// The attributes appear before the path, H indicates hidden
			const attributes = stdout.substring( 0, stdout.indexOf( resolvedPath ) );
			resolve( attributes.includes( 'H' ) );
		} );
	} );
}
