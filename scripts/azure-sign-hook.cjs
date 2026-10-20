// Custom signing hook for @electron/windows-sign.
// Azure Trusted Signing only supports SHA256; the default dual-sign
// (sha1 + sha256) fails because there's no local cert for sha1.
// This hook calls signtool directly with SHA256-only parameters.

const { execFileSync } = require( 'child_process' );
const fs = require( 'fs' );
const path = require( 'path' );
const {
	assertAzureSigningEnv,
	getAzureSignArgs,
	getAzureSigningConfig,
} = require( './azure-signing.cjs' );

// @electron/windows-sign includes .ps1 shim scripts from node_modules/.bin
// in its file list. These are text files that don't need code signing.
const SKIP_EXTENSIONS = new Set( [ '.ps1', '.vbs', '.wsf' ] );

// Extensions @electron/windows-sign treats as Portable Executables.
const PE_EXTENSIONS = new Set( [ '.exe', '.dll', '.sys', '.efi', '.scr', '.node' ] );

// Some packages ship prebuilt .node binaries for every platform in one package
// (e.g. pi-tui's darwin prebuilds), which signtool rejects. Windows PE files
// start with the "MZ" DOS header.
function isPortableExecutable( filePath ) {
	const fd = fs.openSync( filePath, 'r' );
	try {
		const header = Buffer.alloc( 2 );
		return fs.readSync( fd, header, 0, 2, 0 ) === 2 && header.toString( 'latin1' ) === 'MZ';
	} finally {
		fs.closeSync( fd );
	}
}

module.exports = function ( fileToSign ) {
	const extension = path.extname( fileToSign ).toLowerCase();
	if ( SKIP_EXTENSIONS.has( extension ) ) {
		return;
	}
	if ( PE_EXTENSIONS.has( extension ) && ! isPortableExecutable( fileToSign ) ) {
		console.log( `Skipping non-PE file: ${ fileToSign }` );
		return;
	}
	assertAzureSigningEnv();
	const { signtoolPath } = getAzureSigningConfig();

	execFileSync( signtoolPath, getAzureSignArgs( fileToSign ), { stdio: 'inherit' } );
};
