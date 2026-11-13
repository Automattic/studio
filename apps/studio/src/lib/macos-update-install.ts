import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Helpers around Squirrel.Mac's ShipIt, the helper process that swaps the app bundle for a
 * downloaded update once Studio quits. Copying a large bundle takes minutes, and anything the
 * old app does in that window (like downloading the update again) can break the install.
 */

export const RELAUNCHED_AFTER_UPDATE_ARG = '--relaunched-after-update';

// ShipIt keeps running for a moment after it relaunches the app on "Restart", so a ShipIt
// that's still around right at launch isn't necessarily installing anything.
const SHIPIT_SETTLE_MS = 3000;
const SHIPIT_POLL_MS = 250;
const MAX_INSTALL_WAIT_SECONDS = 15 * 60;
const STALE_TEMP_DIR_AGE_MS = 60 * 60 * 1000;

/** `/Applications/Studio.app` for an executable at `/Applications/Studio.app/Contents/MacOS/Studio`. */
export function getAppBundlePath( exePath: string ): string {
	return path.posix.resolve( exePath, '..', '..', '..' );
}

export function readBundleIdentifier( appBundlePath: string ): string | null {
	try {
		const plist = fs.readFileSync( path.join( appBundlePath, 'Contents', 'Info.plist' ), 'utf-8' );
		return (
			/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec( plist )?.[ 1 ] ?? null
		);
	} catch {
		return null;
	}
}

/** Squirrel names ShipIt's launchd job, and its temp directories, after the app's bundle id. */
function getShipItJobLabel( bundleId: string ): string {
	return `${ bundleId }.ShipIt`;
}

/**
 * A `pgrep -f` pattern for the app's ShipIt. The first character is wrapped in a bracket
 * expression so the pattern doesn't match a command line that merely contains it, like the
 * relaunch helper's own `sh` process.
 */
export function getShipItProcessPattern( bundleId: string ): string {
	const escaped = getShipItJobLabel( bundleId ).replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
	return `[${ escaped[ 0 ] }]${ escaped.slice( 1 ) }`;
}

function isShipItRunning( bundleId: string ): boolean {
	const result = spawnSync( 'pgrep', [ '-f', getShipItProcessPattern( bundleId ) ], {
		stdio: 'ignore',
	} );
	return result.status === 0;
}

function sleepSync( ms: number ) {
	Atomics.wait( new Int32Array( new SharedArrayBuffer( 4 ) ), 0, 0, ms );
}

/** Whether ShipIt is still running once the brief exit after a relaunch has had time to finish. */
export function isUpdateInstallInProgress( bundleId: string ): boolean {
	for ( let waited = 0; waited < SHIPIT_SETTLE_MS; waited += SHIPIT_POLL_MS ) {
		if ( ! isShipItRunning( bundleId ) ) {
			return false;
		}
		sleepSync( SHIPIT_POLL_MS );
	}
	return isShipItRunning( bundleId );
}

/**
 * Starts a detached helper that waits for ShipIt to finish (or gives up after a while) and then
 * opens the app again, so the user lands on whichever version ShipIt left in place.
 */
export function relaunchAfterUpdateInstall( bundleId: string, appBundlePath: string ): void {
	const script = [
		'i=0',
		'while pgrep -f "$1" >/dev/null 2>&1 && [ "$i" -lt "$3" ]; do sleep 1; i=$((i+1)); done',
		'sleep 1',
		`open "$2" --args ${ RELAUNCHED_AFTER_UPDATE_ARG }`,
	].join( '\n' );
	const child = spawn(
		'/bin/sh',
		[
			'-c',
			script,
			'sh',
			getShipItProcessPattern( bundleId ),
			appBundlePath,
			String( MAX_INSTALL_WAIT_SECONDS ),
		],
		{ detached: true, stdio: 'ignore' }
	);
	child.unref();
}

/**
 * Removes the working copies ShipIt leaves in the temp directory when an install fails. Each is
 * a full copy of the app, so repeated failures can add up to gigabytes. Only call this while
 * ShipIt isn't running.
 */
export async function removeStaleShipItTempDirs(
	bundleId: string,
	tmpDir: string,
	now = Date.now()
): Promise< string[] > {
	const prefix = `${ getShipItJobLabel( bundleId ) }.`;
	const entries = await fs.promises.readdir( tmpDir, { withFileTypes: true } ).catch( () => [] );
	const removed: string[] = [];
	for ( const entry of entries ) {
		if ( ! entry.isDirectory() || ! entry.name.startsWith( prefix ) ) {
			continue;
		}
		const dirPath = path.join( tmpDir, entry.name );
		try {
			const { mtimeMs } = await fs.promises.stat( dirPath );
			if ( now - mtimeMs < STALE_TEMP_DIR_AGE_MS ) {
				continue;
			}
			await fs.promises.rm( dirPath, { recursive: true, force: true } );
			removed.push( dirPath );
		} catch ( error ) {
			console.warn( `Failed to remove ShipIt temp directory ${ dirPath }`, error );
		}
	}
	return removed;
}

/** Whether version `a` is older than `b`, comparing the numeric `x.y.z` part only. */
export function isOlderVersion( a: string, b: string ): boolean {
	const parse = ( version: string ) =>
		( /^(\d+)\.(\d+)\.(\d+)/.exec( version ) ?? [] ).slice( 1 ).map( Number );
	const [ partsA, partsB ] = [ parse( a ), parse( b ) ];
	if ( partsA.length !== 3 || partsB.length !== 3 ) {
		return false;
	}
	for ( let i = 0; i < 3; i++ ) {
		if ( partsA[ i ] !== partsB[ i ] ) {
			return partsA[ i ] < partsB[ i ];
		}
	}
	return false;
}
