import fs from 'fs';
import path from 'path';

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

export function validateSiteFolder( siteFolder: string ): true | Error {
	if ( ! fs.existsSync( siteFolder ) ) {
		return new Error( `Folder not found: ${ siteFolder }` );
	}

	if ( ! isWordPressDirectory( siteFolder ) && ! hasWpContentDirectory( siteFolder ) ) {
		return new Error(
			`The specified folder doesn't appear to be a WordPress site. ` +
				`Please ensure it contains a wp-content directory.`
		);
	}

	return true;
}
