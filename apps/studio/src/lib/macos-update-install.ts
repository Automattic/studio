import { app, dialog } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __ } from '@wordpress/i18n';

/**
 * Squirrel.Mac's ShipIt swaps the app bundle for a downloaded update once Studio quits. Copying a
 * large bundle takes minutes, and if the old app is opened meanwhile and downloads the update
 * again, it deletes the files ShipIt is installing from and the install fails.
 */

const RELAUNCHED_AFTER_UPDATE_ARG = '--relaunched-after-update';

// ShipIt keeps running for a moment after it relaunches the app on "Restart", so a ShipIt
// that's still around right at launch isn't necessarily installing anything.
const SHIPIT_SETTLE_MS = 3000;
const SHIPIT_POLL_MS = 250;
const MAX_INSTALL_WAIT_SECONDS = 15 * 60;
const STALE_TEMP_DIR_AGE_MS = 60 * 60 * 1000;

function readBundleIdentifier( appBundlePath: string ): string | null {
	try {
		const plist = fs.readFileSync( path.join( appBundlePath, 'Contents', 'Info.plist' ), 'utf-8' );
		return (
			/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec( plist )?.[ 1 ] ?? null
		);
	} catch {
		return null;
	}
}

/**
 * A `pgrep -f` pattern for the app's ShipIt, whose job and temp directories are named
 * `<bundle id>.ShipIt`. The bracketed first character keeps it from matching a command line that
 * contains the pattern itself, like the relaunch helper's `sh`.
 */
function getShipItProcessPattern( bundleId: string ): string {
	return `[${ bundleId[ 0 ] }]${ bundleId.slice( 1 ) }.ShipIt`;
}

function isShipItRunning( bundleId: string ): boolean {
	return (
		spawnSync( 'pgrep', [ '-f', getShipItProcessPattern( bundleId ) ], { stdio: 'ignore' } )
			.status === 0
	);
}

function isUpdateInstallInProgress( bundleId: string ): boolean {
	for ( let waited = 0; waited < SHIPIT_SETTLE_MS; waited += SHIPIT_POLL_MS ) {
		if ( ! isShipItRunning( bundleId ) ) {
			return false;
		}
		Atomics.wait( new Int32Array( new SharedArrayBuffer( 4 ) ), 0, 0, SHIPIT_POLL_MS );
	}
	return isShipItRunning( bundleId );
}

function getAppBundlePath(): string {
	// `<bundle>.app/Contents/MacOS/<executable>`
	return path.resolve( app.getPath( 'exe' ), '..', '..', '..' );
}

/**
 * When Studio is opened while ShipIt is installing an update, quits and starts a detached helper
 * that opens Studio again once ShipIt is done. Returns true when it took over the launch.
 */
export function handOffToRunningUpdateInstall(): boolean {
	if (
		process.platform !== 'darwin' ||
		! app.isPackaged ||
		process.env.E2E ||
		process.argv.includes( RELAUNCHED_AFTER_UPDATE_ARG )
	) {
		return false;
	}

	const appBundlePath = getAppBundlePath();
	const bundleId = readBundleIdentifier( appBundlePath );
	if ( ! bundleId || ! isUpdateInstallInProgress( bundleId ) ) {
		return false;
	}

	console.log( 'An update is being installed, Studio will reopen when it finishes' );
	void app.whenReady().then( () => {
		dialog.showMessageBoxSync( {
			type: 'info',
			message: __( 'WordPress Studio is finishing an update' ),
			detail: __(
				'This can take a few minutes. WordPress Studio will open again on its own when the update is installed.'
			),
			buttons: [ __( 'OK' ) ],
		} );
		const script = [
			'i=0',
			'while pgrep -f "$1" >/dev/null 2>&1 && [ "$i" -lt "$3" ]; do sleep 1; i=$((i+1)); done',
			'sleep 1',
			`open "$2" --args ${ RELAUNCHED_AFTER_UPDATE_ARG }`,
		].join( '\n' );
		spawn(
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
		).unref();
		app.exit( 0 );
	} );
	return true;
}

/**
 * Removes the working copies ShipIt leaves in the temp directory when an install fails: each is a
 * full copy of the app. Called at launch, once a running install has been handed off.
 */
export async function removeStaleShipItTempDirs(
	bundleId = readBundleIdentifier( getAppBundlePath() ),
	tmpDir = os.tmpdir(),
	now = Date.now()
): Promise< void > {
	if ( ! bundleId ) {
		return;
	}
	const entries = await fs.promises.readdir( tmpDir, { withFileTypes: true } ).catch( () => [] );
	for ( const entry of entries ) {
		if ( ! entry.isDirectory() || ! entry.name.startsWith( `${ bundleId }.ShipIt.` ) ) {
			continue;
		}
		const dirPath = path.join( tmpDir, entry.name );
		try {
			const { mtimeMs } = await fs.promises.stat( dirPath );
			if ( now - mtimeMs >= STALE_TEMP_DIR_AGE_MS ) {
				await fs.promises.rm( dirPath, { recursive: true, force: true } );
				console.log( `Removed leftover update copy ${ dirPath }` );
			}
		} catch ( error ) {
			console.warn( `Failed to remove leftover update copy ${ dirPath }`, error );
		}
	}
}
