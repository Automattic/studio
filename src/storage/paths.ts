import { app } from 'electron';
import path from 'path';

export function getUserDataFilePath(): string {
	if ( process.env.E2E && process.env.E2E_APP_DATA_PATH ) {
		return path.join( process.env.E2E_APP_DATA_PATH, app.getName(), 'appdata-v1.json' );
	}
	const appDataPath = app.getPath( 'appData' ); // Resolves to ~/Library/Application Support on macOS
	return path.join( appDataPath, app.getName(), 'appdata-v1.json' );
}

export function getServerFilesPath(): string {
	if ( process.env.E2E && process.env.E2E_APP_DATA_PATH ) {
		return path.join( process.env.E2E_APP_DATA_PATH, app.getName(), 'server-files' );
	}
	const appDataPath = app.getPath( 'appData' ); // Resolves to ~/Library/Application Support on macOS
	return path.join( appDataPath, app.getName(), 'server-files' );
}

export const DEFAULT_SITE_PATH = path.join(
	( process.env.E2E && process.env.E2E_HOME_PATH
		? process.env.E2E_HOME_PATH
		: app?.getPath( 'home' ) ) || '',
	'Studio'
);

export function getSiteThumbnailPath( siteId: string ): string {
	if ( process.env.E2E && process.env.E2E_APP_DATA_PATH ) {
		return path.join(
			process.env.E2E_APP_DATA_PATH,
			app.getName(),
			'thumbnails',
			`${ siteId }.png`
		);
	}
	const appDataPath = app.getPath( 'appData' );
	return path.join( appDataPath, app.getName(), 'thumbnails', `${ siteId }.png` );
}

export function getResourcesPath(): string {
	if ( process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' ) {
		return process.cwd();
	}

	const exePath = path.dirname( app.getPath( 'exe' ) );

	if ( process.platform === 'darwin' ) {
		return path.resolve( exePath, '..', 'Resources' );
	}

	return path.join( exePath, 'resources' );
}
