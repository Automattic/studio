import os from 'os';
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
	if ( process.env.DEV_APP_DATA_PATH ) {
		return process.env.DEV_APP_DATA_PATH;
	}
	return path.join( getStudioHome(), 'appdata.json' );
}

export function getUserDataLockFilePath(): string {
	return path.join( getStudioHome(), 'appdata.json.lock' );
}

function getStudioHome(): string {
	if ( process.env.E2E && process.env.E2E_HOME_PATH ) {
		return path.join( process.env.E2E_HOME_PATH, '.studio' );
	}
	const homedir = app?.getPath( 'home' ) || os.homedir();
	return path.join( homedir, '.studio' );
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
		? path.join( getResourcesPath(), '..', 'cli', 'dist', 'cli', 'main.js' )
		: path.join( getResourcesPath(), 'cli', 'main.js' );
}

export function getBundledNodeBinaryPath(): string {
	const nodeBinaryName = process.platform === 'win32' ? 'node.exe' : 'node';

	if ( process.env.NODE_ENV === 'production' ) {
		return path.join( getResourcesPath(), 'bin', nodeBinaryName );
	}

	// In test environment, use the Electron node binary. The system-level node binary is not reliable
	// in this context.
	if ( process.env.NODE_ENV === 'test' ) {
		return process.execPath;
	}

	// In development, use the system-level node binary. The bundled node binary most likely isn't
	// available, and the Electron binary is noticeably slower.
	return nodeBinaryName;
}

function getAppDataPath(): string {
	if ( inChildProcess() ) {
		if ( ! process.env.STUDIO_APP_DATA_PATH ) {
			throw Error( 'STUDIO_APP_DATA_PATH environment variable not defined for child process' );
		}
		return process.env.STUDIO_APP_DATA_PATH;
	}
	if ( process.env.E2E && process.env.E2E_APP_DATA_PATH ) {
		// In E2E mode, return the base appData path directly. Callers append app name and subpaths.
		return process.env.E2E_APP_DATA_PATH;
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
