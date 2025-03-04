import { app } from 'electron';
import fs from 'fs';
import path from 'path';

let appPaths: Record< keyof InstalledApps, string >;

if ( process.platform === 'darwin' ) {
	appPaths = {
		vscode: '/Applications/Visual Studio Code.app',
		phpstorm: '/Applications/PhpStorm.app',
		iterm: '/Applications/iTerm.app',
	};
} else if ( process.platform === 'linux' ) {
	appPaths = {
		vscode: '/usr/bin/code',
		phpstorm: '/usr/bin/phpstorm',
		iterm: '', // Disable iTerm for Linux
	};
} else if ( process.platform === 'win32' ) {
	appPaths = {
		vscode: path.join( app.getPath( 'appData' ), 'Code' ),
		phpstorm: '', // Disable phpStorm for Windows
		iterm: '', // Disable iTerm for Windows
	};
}

export function isInstalled( key: keyof typeof appPaths ): boolean {
	if ( ! appPaths[ key ] ) {
		return false;
	}
	return fs.existsSync( appPaths[ key ] );
}
