import { app } from 'electron';
import fs from 'fs';
import path from 'path';

type InstalledApp =
	| 'vscode'
	| 'phpstorm'
	| 'cursor'
	| 'windsurf'
	| 'nova'
	| 'webstorm'
	| 'sublime'
	| 'atom';

type PlatformPaths = {
	[ K in InstalledApp ]: string[];
};

// Define installation paths for each IDE by platform
const installationPaths: Record< string, PlatformPaths > = {
	darwin: {
		vscode: [ 'Visual Studio Code.app' ],
		phpstorm: [ 'PhpStorm.app' ],
		cursor: [ 'Cursor.app' ],
		windsurf: [ 'Windsurf.app' ],
		nova: [ 'Nova.app' ],
		webstorm: [ 'WebStorm.app' ],
		sublime: [ 'Sublime Text.app' ],
		atom: [ 'Atom.app' ],
	},
	win32: {
		vscode: [
			'C:\\Program Files\\Microsoft VS Code',
			path.join( app.getPath( 'appData' ), 'Local\\Programs\\Microsoft VS Code' ),
		],
		phpstorm: [
			'C:\\Program Files\\JetBrains\\PhpStorm',
			path.join( app.getPath( 'appData' ), 'JetBrains\\PhpStorm' ),
		],
		cursor: [
			'C:\\Program Files\\Cursor',
			path.join( app.getPath( 'appData' ), 'Local\\Programs\\Cursor' ),
		],
		windsurf: [ 'C:\\Program Files\\Windsurf', path.join( app.getPath( 'appData' ), 'Windsurf' ) ],
		nova: [], // Nova is Mac-only
		webstorm: [
			'C:\\Program Files\\JetBrains\\WebStorm',
			path.join( app.getPath( 'appData' ), 'JetBrains\\WebStorm' ),
		],
		sublime: [ 'C:\\Program Files\\Sublime Text', 'C:\\Program Files\\Sublime Text 3' ],
		atom: [ path.join( app.getPath( 'appData' ), 'atom' ), 'C:\\Program Files\\Atom' ],
	},
	linux: {
		vscode: [
			'/usr/share/code',
			path.join( app.getPath( 'home' ), '.local/share/code' ),
			'/snap/code',
		],
		phpstorm: [ '/opt/phpstorm', path.join( app.getPath( 'home' ), 'PhpStorm' ) ],
		cursor: [ '/opt/cursor', path.join( app.getPath( 'home' ), '.local/share/cursor' ) ],
		windsurf: [ '/opt/windsurf', path.join( app.getPath( 'home' ), '.local/share/windsurf' ) ],
		nova: [], // Nova is Mac-only
		webstorm: [ '/opt/webstorm', path.join( app.getPath( 'home' ), 'WebStorm' ) ],
		sublime: [ '/opt/sublime_text', '/usr/bin/sublime_text' ],
		atom: [ '/usr/share/atom', path.join( app.getPath( 'home' ), '.atom' ) ],
	},
};

if ( process.platform === 'darwin' ) {
	const systemApplications = '/Applications';
	const userApplications = path.join( app.getPath( 'home' ), 'Applications' );

	Object.keys( installationPaths.darwin ).forEach( ( ide ) => {
		const appName = installationPaths.darwin[ ide as InstalledApp ][ 0 ];
		if ( appName ) {
			installationPaths.darwin[ ide as InstalledApp ] = [
				path.join( systemApplications, appName ),
				path.join( userApplications, appName ),
			];
		}
	} );
}

if ( process.platform === 'linux' ) {
	Object.keys( installationPaths.linux ).forEach( ( ide ) => {
		installationPaths.linux[ ide as InstalledApp ].push( `/usr/bin/${ ide }` );
		installationPaths.linux[ ide as InstalledApp ].push( `/usr/local/bin/${ ide }` );
	} );
}

if ( process.platform === 'win32' ) {
	// For JetBrains IDEs, check for version-specific folders
	[ 'phpstorm', 'webstorm' ].forEach( ( ide ) => {
		const basePaths = installationPaths.win32[ ide as InstalledApp ];

		if ( fs.existsSync( 'C:\\Program Files\\JetBrains' ) ) {
			const jetbrainsDir = 'C:\\Program Files\\JetBrains';
			const entries = fs.readdirSync( jetbrainsDir );

			entries.forEach( ( entry ) => {
				if ( entry.toLowerCase().includes( ide ) ) {
					basePaths.push( path.join( jetbrainsDir, entry ) );
				}
			} );
		}
	} );
}

export function isInstalled( key: InstalledApp ): boolean {
	const platform = process.platform;
	const paths = installationPaths[ platform ]?.[ key ] || [];

	// Return true if any of the possible paths exist
	return paths.some( ( pathStr: string ) => pathStr && fs.existsSync( pathStr ) );
}
