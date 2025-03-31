import { app } from 'electron';
import fs from 'fs';
import path from 'path';

let appPaths: Record< keyof InstalledApps, string[] >;

if ( process.platform === 'darwin' ) {
	// Get both system and user Applications directories
	const systemApplications = '/Applications';
	const userApplications = path.join( app.getPath( 'home' ), 'Applications' );

	appPaths = {
		vscode: [
			path.join( systemApplications, 'Visual Studio Code.app' ),
			path.join( userApplications, 'Visual Studio Code.app' ),
		],
		phpstorm: [
			path.join( systemApplications, 'PhpStorm.app' ),
			path.join( userApplications, 'PhpStorm.app' ),
		],
	};
} else if ( process.platform === 'linux' ) {
	appPaths = {
		vscode: [ '/usr/bin/code' ],
		phpstorm: [ '/usr/bin/phpstorm' ],
	};
} else if ( process.platform === 'win32' ) {
	appPaths = {
		vscode: [ path.join( app.getPath( 'appData' ), 'Code' ) ],
		phpstorm: [ '' ], // Disable phpStorm for Windows
	};
}

export function isInstalled( key: keyof typeof appPaths ): boolean {
	if ( ! appPaths[ key ] ) {
		return false;
	}
	// Return true if any of the possible paths exist
	return appPaths[ key ].some( ( path ) => path && fs.existsSync( path ) );
}
