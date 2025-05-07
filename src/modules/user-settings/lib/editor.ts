import * as fs from 'fs';
import * as path from 'path';
import { __ } from '@wordpress/i18n';

export type SupportedEditor = 'vscode' | 'phpstorm' | 'cursor' | 'windsurf' | 'webstorm';

export type SupportedEditorConfig = {
	label: string;
	url: ( path: string ) => string;
	bundleId: string;
	winCommand: string;
	winPaths: string[];
};

export const supportedEditorConfig: Record< SupportedEditor, SupportedEditorConfig > = {
	vscode: {
		// translators: "VS Code" is the brand name for an IDE and does not need to be translated
		label: __( 'VS Code' ),
		url: ( path: string ) => `vscode://file/${ path }?windowId=_blank`,
		bundleId: 'com.microsoft.VSCode',
		winCommand: 'code',
		winPaths: [
			'%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\code.exe',
			'%PROGRAMFILES%\\Microsoft VS Code\\code.exe',
			'%PROGRAMFILES(X86)%\\Microsoft VS Code\\code.exe',
		],
	},
	phpstorm: {
		// translators: "PhpStorm" is the brand name for an IDE and does not need to be translated
		label: __( 'PhpStorm' ),
		url: ( path: string ) => `phpstorm://open?file=${ path }`,
		bundleId: 'com.jetbrains.PhpStorm',
		winCommand: 'phpstorm64.exe',
		winPaths: [
			'%LOCALAPPDATA%\\JetBrains\\Toolbox\\apps\\PhpStorm\\ch-0\\*\\bin\\phpstorm64.exe',
			'%PROGRAMFILES%\\JetBrains\\PhpStorm\\bin\\phpstorm64.exe',
		],
	},
	webstorm: {
		// translators: "WebStorm" is the brand name for an IDE and does not need to be translated
		label: __( 'WebStorm' ),
		url: ( path: string ) => `webstorm://open?file=${ path }`,
		bundleId: 'com.jetbrains.WebStorm',
		winCommand: 'webstorm64.exe',
		winPaths: [
			'%LOCALAPPDATA%\\JetBrains\\Toolbox\\apps\\WebStorm\\ch-0\\*\\bin\\webstorm64.exe',
			'%PROGRAMFILES%\\JetBrains\\WebStorm\\bin\\webstorm64.exe',
		],
	},
	windsurf: {
		// translators: "Windsurf" is the brand name for an IDE and does not need to be translated
		label: __( 'Windsurf' ),
		url: ( path: string ) => `windsurf://file/${ path }?windowId=_blank`,
		bundleId: 'com.exafunction.windsurf',
		winCommand: 'windsurf.exe',
		winPaths: [
			'%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe',
			'%PROGRAMFILES%\\Windsurf\\Windsurf.exe',
		],
	},
	cursor: {
		// translators: "Cursor" is the brand name for an IDE and does not need to be translated
		label: __( 'Cursor' ),
		url: ( path: string ) => `cursor://file/${ path }?windowId=_blank`,
		bundleId: 'com.todesktop.230313mzl4w4u92',
		winCommand: 'cursor.exe',
		winPaths: [
			'%LOCALAPPDATA%\\Programs\\Cursor\\Cursor.exe',
			'%PROGRAMFILES%\\Cursor\\Cursor.exe',
		],
	},
};

/**
 * Expands Windows environment variables in a path
 */
export function winExpandPath( path: string ): string {
	return path.replace( /%([^%]+)%/g, ( _, n ) => process.env[ n ] || '' );
}

/**
 * Finds the executable path for a given editor on Windows
 */
export async function winFindEditorPath( editorName: string ): Promise< string | null > {
	const editor = supportedEditorConfig[ editorName as SupportedEditor ];
	if ( ! editor || ! editor.winPaths ) {
		return null;
	}

	for ( const possiblePath of editor.winPaths ) {
		const expandedPath = winExpandPath( possiblePath );

		// Handle wildcards in paths (for JetBrains Toolbox installations)
		if ( expandedPath.includes( '*' ) ) {
			const basePath = path.dirname( expandedPath );
			const pattern = path.basename( expandedPath );

			try {
				const files = await fs.promises.readdir( basePath );
				const matchingFiles = files.filter( ( f ) =>
					f.match( new RegExp( pattern.replace( '*', '.*' ) ) )
				);

				for ( const file of matchingFiles ) {
					const fullPath = path.join( basePath, file );
					if (
						await fs.promises
							.access( fullPath )
							.then( () => true )
							.catch( () => false )
					) {
						return fullPath;
					}
				}
			} catch ( error ) {
				// Skip if directory doesn't exist
				continue;
			}
		} else {
			if (
				await fs.promises
					.access( expandedPath )
					.then( () => true )
					.catch( () => false )
			) {
				return expandedPath;
			}
		}
	}

	return null;
}
