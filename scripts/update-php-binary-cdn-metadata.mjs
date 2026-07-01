#!/usr/bin/env node

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import phpVersionsMetadata from '../packages/common/lib/php-binary-cdn-metadata.mjs';

const DEFAULT_METADATA_PATH = path.join(
	process.cwd(),
	'packages/common/lib/php-binary-cdn-metadata.mjs'
);

const ARTIFACT_PLATFORM_MAP = {
	linux: 'linux',
	macos: 'darwin',
	windows: 'win32',
};

const ARTIFACT_ARCH_MAP = {
	aarch64: 'arm64',
	x86_64: 'x64',
};

const ARTIFACT_ORDER = [ 'darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-arm64', 'linux-x64' ];

function parseArgs() {
	const args = process.argv.slice( 2 );
	const options = {};

	for ( let i = 0; i < args.length; i += 2 ) {
		const key = args[ i ];
		const value = args[ i + 1 ];
		if ( ! key?.startsWith( '--' ) || ! value ) {
			throw new Error(
				`Invalid arguments. Usage: ${ path.basename(
					process.argv[ 1 ]
				) } --version 8.4.20 --upload-results out/php-binaries/apps-cdn-upload-results.json`
			);
		}
		options[ key.slice( 2 ) ] = value;
	}

	if ( ! options.version || ! options[ 'upload-results' ] ) {
		throw new Error( 'Missing required --version or --upload-results argument.' );
	}

	return options;
}

function minorVersionFor( version ) {
	const match = version.match( /^(\d+\.\d+)\.\d+$/ );
	if ( ! match ) {
		throw new Error( `Expected a PHP patch version like 8.4.20. Received: ${ version }` );
	}
	return match[ 1 ];
}

function comparePatchVersions( a, b ) {
	const aParts = a.split( '.' ).map( Number );
	const bParts = b.split( '.' ).map( Number );

	for ( let i = 0; i < Math.max( aParts.length, bParts.length ); i += 1 ) {
		const diff = ( aParts[ i ] || 0 ) - ( bParts[ i ] || 0 );
		if ( diff !== 0 ) {
			return diff;
		}
	}

	return 0;
}

function artifactKeyFor( fileName, version ) {
	const match = fileName.match(
		/^php-(\d+\.\d+\.\d+)-cli-(linux|macos|windows)-(aarch64|x86_64)\.zip$/
	);
	if ( ! match ) {
		throw new Error( `Unexpected PHP binary artifact filename: ${ fileName }` );
	}

	const [ , artifactVersion, platform, arch ] = match;
	if ( artifactVersion !== version ) {
		throw new Error( `Artifact ${ fileName } does not match requested PHP version ${ version }.` );
	}

	return `${ ARTIFACT_PLATFORM_MAP[ platform ] }-${ ARTIFACT_ARCH_MAP[ arch ] }`;
}

function normalizeMetadata( metadata ) {
	if ( ! metadata || typeof metadata !== 'object' || Array.isArray( metadata ) ) {
		throw new Error( 'PHP binary CDN metadata must be a JSON object.' );
	}

	metadata.versions = metadata.versions || {};
	return metadata;
}

function orderedObject( object, preferredOrder = [] ) {
	const ordered = {};
	const keys = Object.keys( object ).sort( ( a, b ) => {
		const aIndex = preferredOrder.indexOf( a );
		const bIndex = preferredOrder.indexOf( b );

		if ( aIndex !== -1 || bIndex !== -1 ) {
			return (
				( aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex ) -
				( bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex )
			);
		}

		return a.localeCompare( b );
	} );

	for ( const key of keys ) {
		ordered[ key ] = object[ key ];
	}

	return ordered;
}

function validateUploadResult( fileName, result ) {
	const url = result?.cdn_url;
	const sha = result?.sha?.toLowerCase();

	if ( ! url ) {
		throw new Error( `Upload result for ${ fileName } does not include cdn_url.` );
	}

	if ( ! /^https:\/\/.+/.test( url ) ) {
		throw new Error( `Upload result for ${ fileName } has an invalid cdn_url: ${ url }` );
	}

	if ( ! /^[a-f0-9]{64}$/.test( sha ) ) {
		throw new Error( `Upload result for ${ fileName } does not include a valid SHA-256 hash.` );
	}

	return { url, sha };
}

function formatMetadataFile() {
	const result = spawnSync(
		'npm',
		[ 'run', 'format', '--', path.relative( process.cwd(), DEFAULT_METADATA_PATH ) ],
		{
			cwd: process.cwd(),
			stdio: 'inherit',
			shell: process.platform === 'win32',
		}
	);
	if ( result.status !== 0 ) {
		throw new Error( `Failed to format ${ DEFAULT_METADATA_PATH }.` );
	}
}

function main() {
	const options = parseArgs();
	const version = options.version;
	const minorVersion = minorVersionFor( version );
	const metadata = normalizeMetadata( phpVersionsMetadata );
	const uploadResults = JSON.parse( fs.readFileSync( options[ 'upload-results' ], 'utf8' ) );
	const uploadEntries = Object.entries( uploadResults );
	const currentVersion = metadata.versions[ minorVersion ]?.version;

	if ( uploadEntries.length === 0 ) {
		throw new Error( 'Upload results do not include any PHP binary artifacts.' );
	}

	if ( currentVersion && comparePatchVersions( version, currentVersion ) < 0 ) {
		console.log(
			`Skipping PHP ${ version } metadata because PHP ${ currentVersion } is already tracked for ${ minorVersion }.`
		);
		return;
	}

	const isNewPatch = currentVersion !== version;
	const currentArtifacts = isNewPatch ? {} : metadata.versions[ minorVersion ]?.artifacts || {};
	const artifacts = { ...currentArtifacts };

	for ( const [ fileName, result ] of uploadEntries ) {
		const artifactKey = artifactKeyFor( fileName, version );
		const { url, sha } = validateUploadResult( fileName, result );

		artifacts[ artifactKey ] = {
			url,
			sha,
		};
	}

	metadata.versions[ minorVersion ] = {
		version,
		artifacts: orderedObject( artifacts, ARTIFACT_ORDER ),
	};
	metadata.versions = orderedObject(
		metadata.versions,
		Object.keys( metadata.versions ).sort( ( a, b ) => comparePatchVersions( b, a ) )
	);

	fs.writeFileSync(
		DEFAULT_METADATA_PATH,
		`const phpVersionsMetadata = ${ JSON.stringify(
			metadata,
			null,
			'\t'
		) };\n\nexport default phpVersionsMetadata;\n`
	);
	formatMetadataFile();
	console.log( `Updated PHP ${ minorVersion } CDN metadata to ${ version }.` );
}

try {
	main();
} catch ( error ) {
	console.error( error.message );
	process.exit( 1 );
}
