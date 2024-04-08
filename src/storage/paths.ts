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

export function getSiteThumbnailPath( siteId: string ): string {
	const appDataPath = app.getPath( 'appData' );
	return path.join( appDataPath, app.getName(), 'thumbnails', `${ siteId }.png` );
}

export function getResourcesPath(): string {
	if ( process.env.NODE_ENV === 'development' ) {
		return process.cwd();
	}

	const exePath = path.dirname( app.getPath( 'exe' ) );

	if ( process.platform === 'darwin' ) {
		return path.resolve( exePath, '..', 'Resources' );
	}

	return path.join( exePath, 'resources' );
}
