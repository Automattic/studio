// Custom signing hook for @electron/windows-sign.
// Azure Trusted Signing only supports SHA256; the default dual-sign
// (sha1 + sha256) fails because there's no local cert for sha1.
// This hook calls signtool directly with SHA256-only parameters.

const { execFileSync } = require( 'child_process' );
const path = require( 'path' );
const {
	assertAzureSigningEnv,
	getAzureSignArgs,
	getAzureSigningConfig,
} = require( './azure-signing.cjs' );

// @electron/windows-sign includes .ps1 shim scripts from node_modules/.bin
// in its file list. These are text files that don't need code signing.
const SKIP_EXTENSIONS = new Set( [ '.ps1', '.vbs', '.wsf' ] );

module.exports = function ( fileToSign ) {
	if ( SKIP_EXTENSIONS.has( path.extname( fileToSign ).toLowerCase() ) ) {
		return;
	}
	assertAzureSigningEnv();
	const { signtoolPath } = getAzureSigningConfig();

	execFileSync( signtoolPath, getAzureSignArgs( fileToSign ), { stdio: 'inherit' } );
};
