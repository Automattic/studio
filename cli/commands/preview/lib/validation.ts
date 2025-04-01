import fs from 'fs';
import path from 'path';
import { isWordPressDirectory } from 'src/lib/fs-utils';
import { LoggerError } from 'cli/logger';

function hasWpContentDirectory( projectPath: string ): boolean {
	return fs.existsSync( path.join( projectPath, 'wp-content' ) );
}

export function validateSiteFolder( siteFolder: string ): true {
	if ( ! fs.existsSync( siteFolder ) ) {
		throw new LoggerError( `Folder not found: ${ siteFolder }` );
	}

	if ( ! isWordPressDirectory( siteFolder ) && ! hasWpContentDirectory( siteFolder ) ) {
		throw new LoggerError(
			`The specified folder doesn't appear to be a WordPress site. ` +
				`Please ensure it contains a wp-content directory.`
		);
	}

	return true;
}
