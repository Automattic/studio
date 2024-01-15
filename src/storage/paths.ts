import { app } from 'electron';
import path from 'path';

export function getUserDataFilePath(): string {
	const appDataPath = app.getPath( 'appData' ); // Resolves to ~/Library/Application Support on macOS
	return path.join( appDataPath, 'local-environment', 'appdata-v1.json' );
}
