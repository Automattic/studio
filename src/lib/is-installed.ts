import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const appPaths: Record< keyof InstalledApps, string > =
	process.platform == 'win32'
		? {
				vscode: path.join( app.getPath( 'appData' ), 'Code' ),
				phpstorm: '', // Disable phpSotrm for Windows
		  }
		: {
				vscode: '/Applications/Visual Studio Code.app',
				phpstorm: '/Applications/PhpStorm.app',
		  };

export function isInstalled( key: keyof typeof appPaths ): boolean {
	if ( ! appPaths[ key ] ) {
		return false;
	}
	return fs.existsSync( appPaths[ key ] );
}
