/**
 * Starts the Electron app with the new UI (@studio/ui) as the renderer.
 *
 * This script:
 * 1. Builds the CLI
 * 2. Starts the @studio/ui Vite dev server on a fixed port
 * 3. Launches electron-vite dev (main + preload only, no renderer) with
 *    ELECTRON_RENDERER_URL pointing at the @studio/ui dev server
 */

import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname( fileURLToPath( import.meta.url ) );
const root = resolve( scriptDir, '..' );

const UI_DEV_PORT = 5200;

function run( cmd, args, options = {} ) {
	return new Promise( ( resolvePromise, reject ) => {
		const proc = spawn( cmd, args, {
			stdio: 'inherit',
			cwd: root,
			...options,
		} );
		proc.on( 'close', ( code ) => {
			if ( code === 0 ) {
				resolvePromise();
			} else {
				reject( new Error( `${ cmd } ${ args.join( ' ' ) } exited with code ${ code }` ) );
			}
		} );
		proc.on( 'error', reject );
	} );
}

async function main() {
	console.log( '=> Building CLI...' );
	await run( 'npm', [ '-w', 'wp-studio', 'run', 'build' ] );

	console.log( `=> Starting @studio/ui dev server on port ${ UI_DEV_PORT }...` );
	const uiServer = spawn( 'npx', [ 'vite', '--port', String( UI_DEV_PORT ), '--strictPort' ], {
		stdio: 'inherit',
		cwd: resolve( root, 'apps/ui' ),
	} );

	// Give the dev server a moment to start
	await new Promise( ( resolvePromise ) => setTimeout( resolvePromise, 3000 ) );

	console.log( '=> Starting Electron (main + preload) with new UI renderer...' );
	const electronVite = spawn(
		'npx',
		[
			'electron-vite',
			'dev',
			'--config',
			'./electron.vite.config.new-ui.ts',
			'--outDir=dist',
			'--watch',
		],
		{
			stdio: 'inherit',
			cwd: resolve( root, 'apps/studio' ),
			env: {
				...process.env,
				ELECTRON_RENDERER_URL: `http://localhost:${ UI_DEV_PORT }`,
			},
		}
	);

	electronVite.on( 'close', () => {
		uiServer.kill();
		process.exit( 0 );
	} );

	process.on( 'SIGINT', () => {
		electronVite.kill();
		uiServer.kill();
		process.exit( 0 );
	} );

	process.on( 'SIGTERM', () => {
		electronVite.kill();
		uiServer.kill();
		process.exit( 0 );
	} );
}

main().catch( ( err ) => {
	console.error( err );
	process.exit( 1 );
} );
