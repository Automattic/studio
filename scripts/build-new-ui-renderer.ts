import { spawnSync, type SpawnSyncOptions } from 'child_process';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve( __dirname, '..' );
const studioRoot = path.join( repoRoot, 'apps', 'studio' );
const uiRoot = path.join( repoRoot, 'apps', 'ui' );
const rendererOut = path.join( studioRoot, 'dist', 'renderer' );

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
	fs.copyFileSync(
		path.join( aboutMenuDir, 'studio-app-icon.png' ),
		path.join( rendererOut, 'studio-app-icon.png' )
	);
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
