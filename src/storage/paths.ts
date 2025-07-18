import path from 'path';

function inChildProcess() {
	return process.env.STUDIO_IN_CHILD_PROCESS === 'true';
}

// Import electron conditionally to avoid issues in child processes
let app: Electron.App | undefined;
try {
	if ( ! inChildProcess() ) {
		( { app } = require( 'electron' ) );
	}
} catch ( error ) {
	// If electron is not available (e.g., in child process), app will remain undefined
}

export function getUserDataFilePath(): string {
	return path.join( getAppDataPath(), getAppName(), 'appdata-v1.json' );
}

export function getServerFilesPath(): string {
	return path.join( getAppDataPath(), getAppName(), 'server-files' );
}

export function getUserDataCertificatesPath(): string {
	return path.join( getAppDataPath(), getAppName(), 'certificates' );
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
	if ( ! app ) {
		throw new Error( 'Electron app not available in child process' );
	}

	if ( process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' ) {
		return app.getAppPath();
	}

	const exePath = path.dirname( app.getPath( 'exe' ) );

	if ( process.platform === 'darwin' ) {
		return path.resolve( exePath, '..', 'Resources' );
	}

	return path.join( exePath, 'resources' );
}

export function getCliPath(): string {
	return process.env.NODE_ENV === 'development'
		? path.join( getResourcesPath(), 'dist', 'cli', 'main.js' )
		: path.join( getResourcesPath(), 'cli', 'main.js' );
}

function getAppDataPath(): string {
	if ( inChildProcess() ) {
		if ( ! process.env.STUDIO_APP_DATA_PATH ) {
			throw Error( 'STUDIO_APP_DATA_PATH environment variable not defined for child process' );
		}
		return process.env.STUDIO_APP_DATA_PATH;
	}
	if ( process.env.E2E && process.env.E2E_APP_DATA_PATH ) {
		if ( ! app ) {
			throw new Error( 'Electron app not available in child process' );
		}
		return path.join( process.env.E2E_APP_DATA_PATH, app.getName(), 'appdata-v1.json' );
	}
	if ( ! app ) {
		throw new Error( 'Electron app not available in child process' );
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
	if ( ! app ) {
		throw new Error( 'Electron app not available in child process' );
	}
	return app.getName();
}
