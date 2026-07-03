import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import { resolve } from 'path';

const root = resolve( import.meta.dirname, '..' );
const uiDevPort = 5200;

// Keep in sync with RELAUNCH_FILE in apps/studio/src/lib/simulation-mode.ts.
const simulationRelaunchFile = resolve( os.homedir(), '.studio-simulation', 'relaunch.json' );

function consumeRelaunchHandoff() {
	try {
		const handoff = JSON.parse( fs.readFileSync( simulationRelaunchFile, 'utf8' ) );
		fs.rmSync( simulationRelaunchFile, { force: true } );
		return handoff;
	} catch {
		return null;
	}
}

function spawnCommand( command, args, options = {} ) {
	return spawn( command, args, {
		stdio: 'inherit',
		cwd: root,
		shell: true,
		...options,
	} );
}

function stopProcess( childProcess ) {
	if ( childProcess && ! childProcess.killed ) {
		childProcess.kill();
	}
}

async function main() {
	console.log( `=> Starting @studio/ui dev server on port ${ uiDevPort }...` );
	const uiServer = spawnCommand( 'npx', [ 'vite', '--port', String( uiDevPort ), '--strictPort' ], {
		cwd: resolve( root, 'apps/ui' ),
	} );
	let electronVite;

	uiServer.on( 'close', ( code ) => {
		if ( ! electronVite ) {
			process.exit( code ?? 0 );
		}
		if ( code ) {
			stopProcess( electronVite );
			process.exit( code );
		}
	} );

	await new Promise( ( resolvePromise ) => setTimeout( resolvePromise, 3000 ) );

	function startElectronVite( extraEnv = {} ) {
		electronVite = spawnCommand(
			'npx',
			[
				'electron-vite',
				'dev',
				'--config',
				'./electron.vite.config.ts',
				'--outDir=dist',
				'--watch',
			],
			{
				cwd: resolve( root, 'apps/studio' ),
				env: {
					...process.env,
					ELECTRON_UI_RENDERER_URL: `http://localhost:${ uiDevPort }`,
					STUDIO_DEV_RELAUNCHER: '1',
					...extraEnv,
				},
			}
		);

		electronVite.on( 'close', ( code ) => {
			// The app writes this handoff file before quitting when the new-user
			// simulation is toggled; respawn Electron with the requested env.
			const handoff = consumeRelaunchHandoff();
			if ( handoff ) {
				console.log(
					`=> Relaunching Studio ${ handoff.simulate ? 'into' : 'out of' } new-user simulation...`
				);
				startElectronVite( {
					...handoff.env,
					...( handoff.simulate ? { STUDIO_SIMULATE_NEW_USER: '1' } : {} ),
				} );
				return;
			}
			stopProcess( uiServer );
			process.exit( code ?? 0 );
		} );
	}

	console.log( '=> Starting Electron...' );
	startElectronVite();

	process.on( 'SIGINT', () => {
		stopProcess( electronVite );
		stopProcess( uiServer );
		process.exit( 0 );
	} );

	process.on( 'SIGTERM', () => {
		stopProcess( electronVite );
		stopProcess( uiServer );
		process.exit( 0 );
	} );
}

main().catch( ( error ) => {
	console.error( error );
	process.exit( 1 );
} );
