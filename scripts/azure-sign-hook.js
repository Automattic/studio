// Custom signing hook for @electron/windows-sign.
// Azure Trusted Signing only supports SHA256; the default dual-sign
// (sha1 + sha256) fails because there's no local cert for sha1.
// This hook calls signtool directly with SHA256-only parameters.

const { execFileSync } = require( 'child_process' );

module.exports = function ( fileToSign ) {
	const signtoolPath = process.env.SIGNTOOL_PATH;
	const dlib = process.env.AZURE_CODE_SIGNING_DLIB;
	const metadata = process.env.AZURE_METADATA_JSON;

	if ( ! signtoolPath || ! dlib || ! metadata ) {
		throw new Error(
			'Azure Trusted Signing env vars not set: SIGNTOOL_PATH, AZURE_CODE_SIGNING_DLIB, AZURE_METADATA_JSON'
		);
	}

	execFileSync( signtoolPath, [
		'sign',
		'/v',
		'/fd', 'SHA256',
		'/tr', 'http://timestamp.acs.microsoft.com',
		'/td', 'SHA256',
		'/dlib', dlib,
		'/dmdf', metadata,
		fileToSign,
	], { stdio: 'inherit' } );
};
