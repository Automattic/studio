import { app } from 'electron';
import fs from 'fs';
import path from 'path';

let appPaths: Record< keyof InstalledApps, string[] >;
let terminalPaths: Record< 'iterm', string[] >;

if ( process.platform === 'darwin' ) {
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

	terminalPaths = {
		iterm: [
			path.join( systemApplications, 'iTerm.app' ),
			path.join( userApplications, 'iTerm.app' ),
		],
	};
} else if ( process.platform === 'linux' ) {
	appPaths = {
		vscode: [ '/usr/bin/code' ],
		phpstorm: [ '/usr/bin/phpstorm' ],
	};
	terminalPaths = {
		iterm: [], // iTerm is macOS only
	};
} else if ( process.platform === 'win32' ) {
	appPaths = {
		vscode: [ path.join( app.getPath( 'appData' ), 'Code' ) ],
		phpstorm: [ '' ], // Disable phpStorm for Windows
	};
	terminalPaths = {
		iterm: [], // iTerm is macOS only
	};
}

export function isInstalled( key: keyof typeof appPaths | keyof typeof terminalPaths ): boolean {
	const paths =
		appPaths[ key as keyof typeof appPaths ] || terminalPaths[ key as keyof typeof terminalPaths ];
	if ( ! paths ) {
		return false;
	}
	return paths.some( ( path: string ) => path && fs.existsSync( path ) );
}
