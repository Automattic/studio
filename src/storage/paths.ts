import { app } from 'electron';
import path from 'path';

export function getUserDataFilePath(): string {
	return path.join( getAppDataPath(), getAppName(), 'appdata-v1.json' );
}

export function getServerFilesPath(): string {
	return path.join( getAppDataPath(), getAppName(), 'server-files' );
}

export const DEFAULT_SITE_PATH = path.join(
	( process.env.E2E && process.env.E2E_HOME_PATH
		? process.env.E2E_HOME_PATH
		: app?.getPath( 'home' ) ) || '',
	'Studio'
);

export function getSiteThumbnailPath( siteId: string ): string {
	return path.join( getAppDataPath(), getAppName(), 'thumbnails', `${ siteId }.png` );
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

function inChildProcess() {
	return process.env.STUDIO_IN_CHILD_PROCESS === 'true';
}

function getAppDataPath(): string {
	if ( inChildProcess() ) {
		if ( ! process.env.STUDIO_APP_DATA_PATH ) {
			throw Error( 'STUDIO_APP_DATA_PATH environment variable not defined for child process' );
		}
		return process.env.STUDIO_APP_DATA_PATH;
	}
	if ( process.env.E2E && process.env.E2E_APP_DATA_PATH ) {
		return path.join( process.env.E2E_APP_DATA_PATH, app.getName(), 'appdata-v1.json' );
	}
	return app.getPath( 'appData' ); // Resolves to ~/Library/Application Support on macOS
}

function getAppName(): string {
	if ( inChildProcess() ) {
		if ( ! process.env.STUDIO_APP_NAME ) {
			throw Error( 'STUDIO_APP_NAME environment variable not defined for child process' );
		}
		return process.env.STUDIO_APP_NAME;
	}
	return app.getName();
}
