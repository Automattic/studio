const REQUIRED_ENV_VARS = [ 'AZURE_CODE_SIGNING_DLIB', 'AZURE_METADATA_JSON', 'SIGNTOOL_PATH' ];

const DEFAULTS = {
	fileDigestAlgorithm: 'SHA256',
	timestampDigestAlgorithm: 'SHA256',
	timestampServer: 'http://timestamp.acs.microsoft.com',
};

function getAzureSigningConfig() {
	return {
		signtoolPath: process.env.SIGNTOOL_PATH,
		dlib: process.env.AZURE_CODE_SIGNING_DLIB,
		metadata: process.env.AZURE_METADATA_JSON,
		fileDigestAlgorithm: process.env.AZURE_FILE_DIGEST || DEFAULTS.fileDigestAlgorithm,
		timestampDigestAlgorithm:
			process.env.AZURE_TIMESTAMP_DIGEST || DEFAULTS.timestampDigestAlgorithm,
		timestampServer: process.env.AZURE_TIMESTAMP_SERVER || DEFAULTS.timestampServer,
	};
}

function assertAzureSigningEnv() {
	for ( const envVar of REQUIRED_ENV_VARS ) {
		if ( ! process.env[ envVar ] ) {
			throw new Error( `Required env var ${ envVar } is not set!` );
		}
	}
}

function getAzureSignArgs( fileToSign, extraArgs = [] ) {
	const { dlib, metadata, fileDigestAlgorithm, timestampDigestAlgorithm, timestampServer } =
		getAzureSigningConfig();

	return [
		'sign',
		'/v',
		...extraArgs,
		'/fd',
		fileDigestAlgorithm,
		'/tr',
		timestampServer,
		'/td',
		timestampDigestAlgorithm,
		'/dlib',
		dlib,
		'/dmdf',
		metadata,
		fileToSign,
	];
}

module.exports = {
	assertAzureSigningEnv,
	getAzureSignArgs,
	getAzureSigningConfig,
};
