import { spawnSync, type SpawnSyncOptions } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname( fileURLToPath( import.meta.url ) );
const repoRoot = path.resolve( scriptDir, '..' );
const studioRoot = path.join( repoRoot, 'apps', 'studio' );
const uiRoot = path.join( repoRoot, 'apps', 'ui' );

function getRendererOut() {
	const outDirArg = process.argv.find( ( arg ) => arg.startsWith( '--outDir=' ) );
	const outDir = outDirArg?.split( '=' )[ 1 ] ?? path.join( 'dist', 'renderer-ui' );
	return path.isAbsolute( outDir ) ? outDir : path.join( studioRoot, outDir );
}

const rendererOut = getRendererOut();

function runOrFail( command: string, args: string[], cwd: string ) {
	const options: SpawnSyncOptions = {
		cwd,
		stdio: 'inherit',
		shell: process.platform === 'win32',
	};

	const result = spawnSync( command, args, options );
	if ( result.status !== 0 ) {
		process.exit( result.status ?? 1 );
	}
}

function copyAboutMenuAssets() {
	const aboutMenuDir = path.join( studioRoot, 'src', 'about-menu' );
	fs.copyFileSync(
		path.join( aboutMenuDir, 'about-menu.html' ),
		path.join( rendererOut, 'about-menu.html' )
	);
	for ( const icon of [ 'studio-app-icon.png', 'studio-app-icon-dark.png' ] ) {
		fs.copyFileSync( path.join( aboutMenuDir, icon ), path.join( rendererOut, icon ) );
	}
}

fs.rmSync( rendererOut, { recursive: true, force: true } );

runOrFail(
	'npx',
	[
		'vite',
		'build',
		'--config',
		'vite.config.ts',
		'--base',
		'./',
		'--outDir',
		path.relative( uiRoot, rendererOut ),
		'--emptyOutDir',
	],
	uiRoot
);

copyAboutMenuAssets();
