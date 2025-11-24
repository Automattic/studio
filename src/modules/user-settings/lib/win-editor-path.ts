import fs from 'fs';
import nodePath from 'path';
import { escapeRegex } from 'common/lib/escape-regex';
import { SupportedEditor, supportedEditorConfig } from 'src/modules/user-settings/lib/editor';

/**
 * Finds the executable path for a given editor on Windows
 */
export async function winFindEditorPath( editorKey: SupportedEditor ): Promise< string | null > {
	const editor = supportedEditorConfig[ editorKey ];
	if ( ! editor || ! editor.winPaths ) {
		return null;
	}

	for ( const possiblePath of editor.winPaths ) {
		// Expand Windows environment variables in path
		const expandedPath = possiblePath.replace( /%([^%]+)%/g, ( _, n ) => process.env[ n ] || '' );

		// Handle wildcards in paths
		if ( expandedPath.includes( '*' ) ) {
			const pathParts = expandedPath.split( '*' );
			const basePath = nodePath.dirname( pathParts[ 0 ] );
			const pattern = nodePath.basename( pathParts[ 0 ] );

			try {
				const files = fs.readdirSync( basePath );
				const matchingFiles = files.filter( ( file ) => {
					const safePattern = escapeRegex( pattern );
					return file.match( new RegExp( safePattern + '.*' ) );
				} );

				for ( const file of matchingFiles ) {
					const fullPath = nodePath.join( basePath, file, pathParts[ 1 ] );
					if ( fs.existsSync( fullPath ) ) {
						return fullPath;
					}
				}
			} catch ( error ) {
				// Skip if directory doesn't exist
				continue;
			}
		} else {
			if ( fs.existsSync( expandedPath ) ) {
				return expandedPath;
			}
		}
	}

	return null;
}
