import { app } from 'electron';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { getAppConfigPath } from '@studio/common/lib/well-known-paths';

export function getUserDataFilePath(): string {
	return getAppConfigPath();
}

export function getOldServerFilesPath(): string {
	return path.join( getAppDataPath(), getAppName(), 'server-files' );
}

export function getOldUserDataCertificatesPath(): string {
	return path.join( getAppDataPath(), getAppName(), 'certificates' );
}

export const defaultSitePath = path.join(
	process.env.E2E && process.env.E2E_HOME_PATH ? process.env.E2E_HOME_PATH : app.getPath( 'home' ),
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

export function getCliBinaryPath(): string | null {
	// The bundled binary is only produced by the packaging step, so in test
	// and development we fall back to running the CLI script with system node.
	if ( process.env.NODE_ENV !== 'production' ) {
		return null;
	}
	const binaryName = process.platform === 'win32' ? 'studio.exe' : 'studio';
	return path.join( getResourcesPath(), 'bin', binaryName );
}

// Where the standalone binary extracts its embedded runtime assets (main.mjs,
// wp-files, node_modules) on first run. We point it at a per-user writable dir
// rather than the app bundle's Resources, which can be read-only for
// non-admin/managed installs and whose code signature we must not mutate.
export function getCliExtractionDir(): string {
	return path.join( app.getPath( 'userData' ), 'cli' );
}

export function getCliPath(): string {
	return process.env.NODE_ENV === 'development'
		? path.join( getResourcesPath(), '..', 'cli', 'dist', 'cli', 'main.mjs' )
		: path.join( getResourcesPath(), 'cli', 'main.mjs' );
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
	if ( ! app ) {
		throw new Error( 'Electron app not available in child process' );
	}
	return app.getName();
}

async function ensurePathIsDirectory( directory: string ) {
	const stats = await fsPromises.stat( directory );
	if ( ! stats.isDirectory() ) {
		throw new Error( 'Selected path is not a directory.' );
	}
}

async function ensurePathIsWritable( directory: string ) {
	await fsPromises.access( directory, fs.constants.W_OK );
}

export async function ensureWritableDirectory( directory: string ) {
	await ensurePathIsDirectory( directory );
	await ensurePathIsWritable( directory );
}
