import fs from 'fs';
import path from 'path';
import { LoggerError } from 'cli/logger';

function isWordPressDirectory( projectPath: string ): boolean {
	return (
		fs.existsSync( path.join( projectPath, 'wp-content' ) ) &&
		fs.existsSync( path.join( projectPath, 'wp-includes' ) ) &&
		fs.existsSync( path.join( projectPath, 'wp-load.php' ) )
	);
}

function hasWpContentDirectory( projectPath: string ): boolean {
	return fs.existsSync( path.join( projectPath, 'wp-content' ) );
}

export function validateSiteFolder( siteFolder: string, action: string ): true {
	if ( ! fs.existsSync( siteFolder ) ) {
		throw new LoggerError( `Folder not found: ${ siteFolder }`, action );
	}

	if ( ! isWordPressDirectory( siteFolder ) && ! hasWpContentDirectory( siteFolder ) ) {
		throw new LoggerError(
			`The specified folder doesn't appear to be a WordPress site. ` +
				`Please ensure it contains a wp-content directory.`,
			action
		);
	}

	return true;
}
