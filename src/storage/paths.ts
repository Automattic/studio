import { app } from 'electron';
import path from 'path';

export function getUserDataFilePath(): string {
	const appDataPath = app.getPath( 'appData' ); // Resolves to ~/Library/Application Support on macOS
	return path.join( appDataPath, app.getName(), 'appdata-v1.json' );
}

export function getServerFilesPath(): string {
	const appDataPath = app.getPath( 'appData' ); // Resolves to ~/Library/Application Support on macOS
	return path.join( appDataPath, app.getName(), 'server-files' );
}

export const DEFAULT_SITE_PATH = path.join( app?.getPath( 'home' ) || '', 'Studio' );
