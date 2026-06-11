import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const patchDir = process.argv[ 2 ];

if ( ! patchDir ) {
	throw new Error( 'Usage: node scripts/apply-available-patches.mjs <patch-dir>' );
}

const cwd = process.cwd();
const repoRoot = path.resolve( import.meta.dirname, '..' );
const sourcePatchDir = path.resolve( cwd, patchDir );
const patchFiles = fs
	.readdirSync( sourcePatchDir )
	.filter( ( file ) => file.endsWith( '.patch' ) )
	.sort();

function getPackageName( patchFile ) {
	const parts = patchFile.replace( /\.patch$/, '' ).split( '+' );
	return parts[ 0 ].startsWith( '@' ) ? `${ parts[ 0 ] }/${ parts[ 1 ] }` : parts[ 0 ];
}

function hasPackage( packageName ) {
	return fs.existsSync( path.join( cwd, 'node_modules', ...packageName.split( '/' ) ) );
}

const availablePatchFiles = patchFiles.filter( ( patchFile ) =>
	hasPackage( getPackageName( patchFile ) )
);
const skippedPatchFiles = patchFiles.filter(
	( patchFile ) => ! availablePatchFiles.includes( patchFile )
);

for ( const patchFile of skippedPatchFiles ) {
	console.log( `Skipping patch for missing package: ${ getPackageName( patchFile ) }` );
}

if ( availablePatchFiles.length === 0 ) {
	console.log( 'No applicable patches found.' );
	process.exit( 0 );
}

const tempPatchDir = fs.mkdtempSync( path.join( cwd, '.studio-patches-' ) );
const relativeTempPatchDir = path.relative( cwd, tempPatchDir );

try {
	for ( const patchFile of availablePatchFiles ) {
		fs.copyFileSync( path.join( sourcePatchDir, patchFile ), path.join( tempPatchDir, patchFile ) );
	}

	const patchPackage = path.join(
		repoRoot,
		'node_modules',
		'.bin',
		process.platform === 'win32' ? 'patch-package.cmd' : 'patch-package'
	);
	const result = spawnSync( patchPackage, [ '--patch-dir', relativeTempPatchDir ], {
		cwd,
		stdio: 'inherit',
		shell: process.platform === 'win32',
	} );

	if ( result.status !== 0 ) {
		process.exitCode = result.status ?? 1;
		throw new Error( `Command failed: ${ patchPackage } --patch-dir ${ relativeTempPatchDir }` );
	}
} finally {
	fs.rmSync( tempPatchDir, { recursive: true, force: true } );
}
