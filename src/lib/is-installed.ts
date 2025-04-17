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
	| 'atom'
	| 'iterm';

type PlatformPaths = {
	[ K in InstalledApp ]: string[];
};

function getProgramFilesPath(): string {
	if ( process.platform !== 'win32' ) {
		return 'C:\\Program Files';
	}

	// This env var dinamically points to the Program Files path
	// See https://stackoverflow.com/a/9608782
	const programFiles = process.env.ProgramFiles;
	if ( programFiles ) {
		return programFiles;
	}

	// Fallback to default path if environment variable is not available
	return 'C:\\Program Files';
}

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
		iterm: [ 'iTerm.app' ],
	},
	linux: {
		vscode: [ '/usr/bin/code' ],
		phpstorm: [ '/usr/bin/phpstorm' ],
		cursor: [ '/usr/bin/cursor' ],
		windsurf: [ '/usr/bin/windsurf' ],
		nova: [],
		webstorm: [ '/usr/bin/webstorm' ],
		sublime: [ '/usr/bin/sublime' ],
		atom: [ '/usr/bin/atom' ],
		iterm: [],
	},
	win32: {
		vscode: [
			path.win32.join( getProgramFilesPath(), 'Microsoft VS Code' ),
			path.win32.join( app.getPath( 'appData' ), 'Local\\Programs\\Microsoft VS Code' ),
		],
		phpstorm: [
			path.win32.join( getProgramFilesPath(), 'JetBrains\\PhpStorm' ),
			path.win32.join( app.getPath( 'appData' ), 'JetBrains\\PhpStorm' ),
		],
		cursor: [
			path.win32.join( getProgramFilesPath(), 'Cursor' ),
			path.win32.join( app.getPath( 'appData' ), 'Local\\Programs\\Cursor' ),
		],
		windsurf: [
			path.win32.join( getProgramFilesPath(), 'Windsurf' ),
			path.win32.join( app.getPath( 'appData' ), 'Windsurf' ),
		],
		nova: [], // Nova is Mac-only
		webstorm: [
			path.win32.join( getProgramFilesPath(), 'JetBrains\\WebStorm' ),
			path.win32.join( app.getPath( 'appData' ), 'JetBrains\\WebStorm' ),
		],
		sublime: [
			path.win32.join( getProgramFilesPath(), 'Sublime Text' ),
			path.win32.join( getProgramFilesPath(), 'Sublime Text 3' ),
		],
		atom: [
			path.win32.join( app.getPath( 'appData' ), 'atom' ),
			path.win32.join( getProgramFilesPath(), 'Atom' ),
		],
		iterm: [],
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
} else if ( process.platform === 'win32' ) {
	// For JetBrains IDEs, check for version-specific folders
	[ 'phpstorm', 'webstorm' ].forEach( ( ide ) => {
		const basePaths = installationPaths.win32[ ide as InstalledApp ];
		const jetbrainsDir = path.win32.join( getProgramFilesPath(), 'JetBrains' );

		if ( fs.existsSync( jetbrainsDir ) ) {
			const entries = fs.readdirSync( jetbrainsDir );

			entries.forEach( ( entry ) => {
				if ( entry.toLowerCase().includes( ide ) ) {
					basePaths.push( path.win32.join( jetbrainsDir, entry ) );
				}
			} );
		}
	} );
}

export function isInstalled( key: InstalledApp ): boolean {
	const platform = process.platform;
	const paths = installationPaths[ platform ]?.[ key ];

	// Return true if any of the possible paths exist
	return paths.some( ( pathStr: string ) => pathStr && fs.existsSync( pathStr ) );
}
