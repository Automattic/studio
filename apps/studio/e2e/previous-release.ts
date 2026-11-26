import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import semver from 'semver';
import { getProcessManagerPaths } from '../../cli/lib/paths';
import cliPackageJson from '../../cli/package.json';
import type { ReadableStream } from 'stream/web';

const CDN_PLATFORMS: Record< string, string > = {
	'darwin-arm64': 'mac-silicon',
	'darwin-x64': 'mac-intel',
	'win32-arm64': 'windows-arm64',
	'win32-x64': 'windows-x64',
	'linux-arm64': 'linux-arm64',
	'linux-x64': 'linux-x64',
};

// Kept between local runs.
const RELEASES_DIR = path.join( os.tmpdir(), 'studio-e2e-previous-release' );

/**
 * Runs the previous release's CLI as if offline, so it keeps the WordPress it bundles. Online,
 * creating a site downloads a newer one from wordpress.org, which closes the connection after the
 * zip, and Node 24.22.1's fetch can crash on that (`assert(!this.paused)`). The sites stay reachable.
 */
export const PREVIOUS_RELEASE_ENV = {
	NODE_USE_ENV_PROXY: '1',
	HTTP_PROXY: 'http://127.0.0.1:9',
	HTTPS_PROXY: 'http://127.0.0.1:9',
	NO_PROXY: 'localhost,127.0.0.1,[::1]',
};

/**
 * The newest Studio release older than this build. Releases before 2.1.0 are skipped: on Windows
 * they listen on the same named pipes whatever STUDIO_PROCESS_MANAGER_HOME says, so their daemon
 * can't be isolated. Every release is also published to npm as `wp-studio`.
 */
function getPreviousVersion() {
	const versions: string[] = JSON.parse(
		execFileSync(
			process.platform === 'win32' ? 'npm.cmd' : 'npm',
			[ 'view', 'wp-studio', 'versions', '--json' ],
			{ encoding: 'utf8', shell: process.platform === 'win32' }
		)
	);
	const version = semver.maxSatisfying(
		versions,
		`>=2.1.0 <${ semver.coerce( cliPackageJson.version ) }`
	);
	if ( ! version ) {
		throw new Error( `No Studio release older than ${ cliPackageJson.version }.` );
	}
	return version;
}

// The folder holding `resources/app.asar`, or the `.app` bundle on macOS.
function findApp( dir: string, depth = 4 ): string | undefined {
	if ( dir.endsWith( '.app' ) || fs.existsSync( path.join( dir, 'resources', 'app.asar' ) ) ) {
		return dir;
	}
	if ( depth === 0 ) {
		return undefined;
	}
	for ( const entry of fs.readdirSync( dir, { withFileTypes: true } ) ) {
		const found = entry.isDirectory() && findApp( path.join( dir, entry.name ), depth - 1 );
		if ( found ) {
			return found;
		}
	}
	return undefined;
}

/**
 * Downloads and unpacks the previous Studio release for this platform, and returns its app folder.
 */
export async function preparePreviousRelease(): Promise< { version: string; appPath: string } > {
	const version = getPreviousVersion();
	const platform = `${ process.platform }-${ process.arch }`;
	const releaseDir = path.join( RELEASES_DIR, `${ version }-${ platform }` );
	// Named like the packaged build: `parseElectronApp` reads the platform from the folder name.
	const appPath = path.join(
		releaseDir,
		process.platform === 'darwin' ? 'Studio.app' : `Studio-${ platform }`
	);
	if ( fs.existsSync( appPath ) ) {
		return { version, appPath };
	}

	// The update package of each platform is a plain archive, unlike the installers.
	const response = await fetch(
		`https://appscdn.wordpress.com/downloads/wordpress-com-studio/${ CDN_PLATFORMS[ platform ] }/v${ version }/update`
	);
	if ( ! response.ok || ! response.body ) {
		throw new Error( `Downloading Studio ${ version } failed with HTTP ${ response.status }.` );
	}
	fs.rmSync( releaseDir, { recursive: true, force: true } );
	const extractDir = path.join( releaseDir, 'extracted' );
	fs.mkdirSync( extractDir, { recursive: true } );
	const archive = path.join( releaseDir, 'update' );
	await pipeline(
		Readable.fromWeb( response.body as ReadableStream< Uint8Array > ),
		fs.createWriteStream( archive )
	);

	if ( process.platform === 'darwin' ) {
		execFileSync( 'ditto', [ '-x', '-k', archive, extractDir ] );
	} else if ( process.platform === 'win32' ) {
		// Windows' own tar reads zip files; the GNU tar of Git Bash, first on CI's PATH, doesn't.
		const tar = path.join( process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe' );
		execFileSync( tar, [ '-xf', archive, '-C', extractDir ] );
	} else {
		execFileSync( 'dpkg-deb', [ '-x', archive, extractDir ] );
	}
	const extractedApp = findApp( extractDir );
	if ( ! extractedApp ) {
		throw new Error( `No app found in the Studio ${ version } update package.` );
	}
	// Like the packaged build in CI: the container can't run Chromium's setuid sandbox helper.
	fs.rmSync( path.join( extractedApp, 'chrome-sandbox' ), { force: true } );
	fs.renameSync( extractedApp, appPath );
	fs.rmSync( archive );
	fs.rmSync( extractDir, { recursive: true, force: true } );
	return { version, appPath };
}

/**
 * Sends a request to the process-manager daemon of `daemonHome` and returns its payload.
 */
export function daemonRequest(
	daemonHome: string,
	type: 'ping' | 'list-processes'
): Promise< Record< string, unknown > > {
	return new Promise( ( resolve, reject ) => {
		const socket = net.createConnection( getProcessManagerPaths( daemonHome ).controlSocketPath );
		let buffer = Buffer.alloc( 0 );
		socket.on( 'error', reject );
		socket.on( 'connect', () => {
			const payload = Buffer.from( JSON.stringify( { type, requestId: randomUUID() } ) );
			const length = Buffer.alloc( 4 );
			length.writeUInt32BE( payload.length );
			socket.write( Buffer.concat( [ length, payload ] ) );
		} );
		socket.on( 'data', ( chunk ) => {
			buffer = Buffer.concat( [ buffer, chunk ] );
			if ( buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE( 0 ) ) {
				socket.destroy();
				const response = JSON.parse(
					buffer.subarray( 4, 4 + buffer.readUInt32BE( 0 ) ).toString()
				);
				if ( response.type === 'error' ) {
					reject( new Error( response.error?.message ) );
				} else {
					resolve( response.payload ?? {} );
				}
			}
		} );
	} );
}
