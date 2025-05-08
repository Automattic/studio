import fs from 'fs';
import nodePath from 'path';
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
		const expandedPath = possiblePath.replace( /%([^%]+)%/g, ( _, n ) => process.env[ n ] || '' );

		// Handle wildcards in paths (for JetBrains Toolbox installations)
		if ( expandedPath.includes( '*' ) ) {
			const basePath = nodePath.dirname( expandedPath );
			const pattern = nodePath.basename( expandedPath );

			try {
				const files = await fs.promises.readdir( basePath );
				const matchingFiles = files.filter( ( file ) =>
					file.match( new RegExp( pattern.replace( '*', '.*' ) ) )
				);

				for ( const file of matchingFiles ) {
					const fullPath = nodePath.join( basePath, file );
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
