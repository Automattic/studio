import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

// This module is imported FIRST by apps/studio/src/index.ts so its side
// effects run before any other module reads config paths. Its static imports
// must stay limited to Node built-ins and `electron` — anything else risks
// transitively evaluating a module that resolves paths before the overrides
// below are in place.

// Never derive these from config — wipeSandbox() deletes them recursively.
const SIMULATION_ROOT = path.join( os.homedir(), '.studio-simulation' );
const SANDBOX_CONFIG_DIR = path.join( SIMULATION_ROOT, 'config' );
const SANDBOX_HOME_DIR = path.join( SIMULATION_ROOT, 'home' );
const SANDBOX_USER_DATA_DIR = path.join( SIMULATION_ROOT, 'electron-user-data' );
const SANDBOX_APP_DATA_DIR = path.join( SIMULATION_ROOT, 'app-data' );
// Keep in sync with simulationRelaunchFile in scripts/start-studio.mjs.
const RELAUNCH_FILE = path.join( SIMULATION_ROOT, 'relaunch.json' );

const SANDBOX_DIRS = [
	SANDBOX_CONFIG_DIR,
	SANDBOX_HOME_DIR,
	SANDBOX_USER_DATA_DIR,
	SANDBOX_APP_DATA_DIR,
];

const simulating =
	process.env.NODE_ENV === 'development' && process.env.STUDIO_SIMULATE_NEW_USER === '1';

export function isSimulatingNewUser(): boolean {
	return simulating;
}

if ( simulating ) {
	for ( const dir of SANDBOX_DIRS ) {
		fs.mkdirSync( dir, { recursive: true } );
	}
	// Redirects shared.json, app.json, cli.json, certificates, server-files and
	// WordPress.org login storage (see packages/common/lib/well-known-paths.ts).
	// CLI child processes inherit the env, so they use the sandbox too.
	process.env.DEV_CONFIG_DIR = SANDBOX_CONFIG_DIR;
	// Consumed by defaultSitePath in apps/studio/src/storage/paths.ts.
	process.env.STUDIO_SIMULATED_HOME = SANDBOX_HOME_DIR;
	// Isolates site thumbnails (getSiteThumbnailPath).
	app.setPath( 'appData', SANDBOX_APP_DATA_DIR );
	// Isolates cookies, localStorage, session partitions and the
	// single-instance lock (which is keyed to the userData path).
	app.setPath( 'userData', SANDBOX_USER_DATA_DIR );
	app.setPath( 'sessionData', SANDBOX_USER_DATA_DIR );

	void app.whenReady().then( () => {
		if ( process.platform === 'darwin' ) {
			app.dock?.setBadge( 'SIM' );
		}
	} );
}

async function wipeSandbox(): Promise< void > {
	for ( const dir of SANDBOX_DIRS ) {
		await fs.promises.rm( dir, { recursive: true, force: true } );
	}
}

/**
 * Relaunch the app into (or out of) the pristine new-user sandbox.
 * `carriedEnv` holds env vars (feature flags such as ENABLE_AGENTIC_UI) that
 * must survive the relaunch so the same UI mode loads on the other side.
 */
export async function toggleNewUserSimulation(
	carriedEnv: Record< string, string >
): Promise< void > {
	const entering = ! simulating;
	if ( entering ) {
		// Pristine on every entry. This runs on the real profile, before the
		// relaunch; only the hardcoded sandbox paths are ever deleted.
		await wipeSandbox();
	}

	if ( process.env.STUDIO_DEV_RELAUNCHER === '1' ) {
		// Under `npm start` a plain app.relaunch() would reopen against dead dev
		// servers — electron-vite exits when Electron closes. Hand off to
		// scripts/start-studio.mjs, which respawns electron-vite with this env.
		await fs.promises.mkdir( SIMULATION_ROOT, { recursive: true } );
		await fs.promises.writeFile(
			RELAUNCH_FILE,
			JSON.stringify( { simulate: entering, env: carriedEnv }, null, '\t' )
		);
	} else {
		// app.relaunch() spawns the new instance from this process, so the
		// mutated env (carriedEnv is already part of process.env) is inherited.
		if ( entering ) {
			process.env.STUDIO_SIMULATE_NEW_USER = '1';
		} else {
			delete process.env.STUDIO_SIMULATE_NEW_USER;
		}
		app.relaunch();
	}
	app.quit();
}
