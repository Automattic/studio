import { app } from 'electron';
import fs from 'fs';
import path from 'path';

let appPaths: Record< keyof InstalledApps, string[] >;
let terminalPaths: Record< 'iterm' | 'warp', string[] >;

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
		warp: [
			path.join( systemApplications, 'Warp.app' ),
			path.join( userApplications, 'Warp.app' ),
		],
	};
} else if ( process.platform === 'linux' ) {
	appPaths = {
		vscode: [ '/usr/bin/code' ],
		phpstorm: [ '/usr/bin/phpstorm' ],
	};
	terminalPaths = {
		iterm: [], // iTerm is macOS only
		warp: [ '/usr/bin/warp' ], // Check for Warp in Linux
	};
} else if ( process.platform === 'win32' ) {
	const localAppData = app.getPath( 'appData' );
	
	appPaths = {
		vscode: [ path.join( localAppData, 'Code' ) ],
		phpstorm: [ '' ], // Disable phpStorm for Windows
	};
	terminalPaths = {
		iterm: [], // iTerm is macOS only
		warp: [ path.join( localAppData, 'Warp' ) ], // Check for Warp in Windows
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
