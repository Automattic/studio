import { app } from 'electron';
import fs from 'fs';
import path from 'path';

type PlatformPaths = {
	[ K in keyof InstalledApps | keyof InstalledTerminals ]: string[];
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

function getLocalProgramsPath(): string {
	if ( process.platform !== 'win32' ) {
		return app.getPath( 'appData' );
	}

	const localAppData = process.env.LOCALAPPDATA;
	if ( localAppData ) {
		return path.win32.join( localAppData, 'Programs' );
	}

	// Fallback to electron's appData path if environment variable is not available
	return path.win32.join( app.getPath( 'appData' ), 'Local', 'Programs' );
}

// Define installation paths for each IDE by platform
const installationPaths: Record< string, PlatformPaths > = {
	darwin: {
		vscode: [ 'Visual Studio Code.app' ],
		phpstorm: [ 'PhpStorm.app' ],
		cursor: [ 'Cursor.app' ],
		windsurf: [ 'Windsurf.app' ],
		webstorm: [ 'WebStorm.app' ],
		iterm: [ 'iTerm.app' ],
		terminal: [ 'Terminal.app' ],
	},
	linux: {
		vscode: [ '/usr/bin/code' ],
		phpstorm: [ '/usr/bin/phpstorm' ],
		cursor: [ '/usr/bin/cursor' ],
		windsurf: [ '/usr/bin/windsurf' ],
		webstorm: [ '/usr/bin/webstorm' ],
		iterm: [],
		terminal: [],
	},
	win32: {
		vscode: [
			path.win32.join( getProgramFilesPath(), 'Microsoft VS Code' ),
			path.win32.join( getLocalProgramsPath(), 'Microsoft VS Code' ),
		],
		phpstorm: [
			path.win32.join( getProgramFilesPath(), 'JetBrains\\PhpStorm' ),
			path.win32.join( getLocalProgramsPath(), 'PhpStorm' ),
		],
		cursor: [
			path.win32.join( getProgramFilesPath(), 'Cursor' ),
			path.win32.join( getLocalProgramsPath(), 'cursor' ),
		],
		windsurf: [
			path.win32.join( getProgramFilesPath(), 'Windsurf' ),
			path.win32.join( getLocalProgramsPath(), 'Windsurf' ),
		],
		webstorm: [
			path.win32.join( getProgramFilesPath(), 'JetBrains\\WebStorm' ),
			path.win32.join( getLocalProgramsPath(), 'WebStorm' ),
		],
		iterm: [],
		terminal: [],
	},
};

if ( process.platform === 'darwin' ) {
	const systemApplications = '/Applications';
	const userApplications = path.join( app.getPath( 'home' ), 'Applications' );

	Object.keys( installationPaths.darwin ).forEach( ( ide ) => {
		const appName = installationPaths.darwin[ ide as keyof InstalledApps ][ 0 ];
		if ( appName ) {
			installationPaths.darwin[ ide as keyof InstalledApps ] = [
				path.join( systemApplications, appName ),
				path.join( userApplications, appName ),
			];
		}
	} );
} else if ( process.platform === 'win32' ) {
	// For JetBrains IDEs, check for version-specific folders
	[ 'phpstorm', 'webstorm' ].forEach( ( ide ) => {
		const basePaths = installationPaths.win32[ ide as keyof InstalledApps ];
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

export function isInstalled( key: keyof InstalledApps | keyof InstalledTerminals ): boolean {
	const platform = process.platform;
	const paths = installationPaths[ platform ]?.[ key ];

	// Return true if any of the possible paths exist
	return paths.some( ( pathStr: string ) => pathStr && fs.existsSync( pathStr ) );
}
