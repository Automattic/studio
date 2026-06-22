import { spawn } from 'child_process';
import { resolve } from 'path';

const root = resolve( import.meta.dirname, '..' );
const uiDevPort = 5200;

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

	console.log( '=> Starting Electron...' );
	electronVite = spawnCommand(
		'npx',
		[ 'electron-vite', 'dev', '--config', './electron.vite.config.ts', '--outDir=dist', '--watch' ],
		{
			cwd: resolve( root, 'apps/studio' ),
			env: {
				...process.env,
				ELECTRON_UI_RENDERER_URL: `http://localhost:${ uiDevPort }`,
			},
		}
	);

	electronVite.on( 'close', ( code ) => {
		stopProcess( uiServer );
		process.exit( code ?? 0 );
	} );

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
