// This script creates a manifest file that gets uploaded to the CDN so the update API can check for new versions.
// The file is uploaded to `https://cdn.a8c-ci.services/wp-build/releases.json` and looks like
//
// {
//   "dev": {
//     "darwin": {
//       "arm64": {
//         "sha": "abcdef1234567890",
//         "url": "https://cdn.a8c-ci.services/wp-build/wp-build-darwin-arm64-abcdef1234567890.app.zip"
//       },
//       "x64": {
//         "sha": "abcdef1234567890",
//         "url": "https://cdn.a8c-ci.services/wp-build/wp-build-darwin-x64-abcdef1234567890.app.zip"
//       }
//     },
//     "win32": {
//       "x64": {
//         "sha": "abcdef1234567890",
//         "url": "https://cdn.a8c-ci.services/wp-build/wp-build-win32-x64-abcdef1234567890.exe.zip"
//       }
//     }
//   },
//   "1.0.0": {
//     "darwin": {
//       "universal": {
//         "sha": "abcdef1234567890",
//         "url": "https://cdn.a8c-ci.services/wp-build/wp-build-darwin-universal-1.0.0.app.zip"
//       }
//     },
//     ... etc.
//   },
//   "1.0.1-beta.1": { ... },
//   "1.2.1-rc.3": { ... },
// }
//
// The "dev" entry will be replaced with the latest build from trunk.

import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const currentCommit = process.env.GITHUB_SHA ?? process.env.BUILDKITE_COMMIT;
const isDevBuild = process.argv.includes( '--dev-build' );

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

if ( process.platform !== 'darwin' ) {
	console.log(
		'Skipping manifest generation on this platform; for now we only store release info for Mac builds'
	);
	process.exit( 0 );
}

console.log( `Is dev build: ${ isDevBuild }` );
console.log( `Current commit: ${ currentCommit }` );

console.log( 'Downloading current manifest ...' );

const releasesPath = path.join( __dirname, '..', 'out', 'releases.json' );
try {
	await fs.mkdir( path.dirname( releasesPath ) );
} catch ( err ) {
	if ( err.code !== 'EEXIST' ) throw err;
}

const releasesFile = createWriteStream( releasesPath, { flags: 'w' } ); // 'w', we want to override any existing file

const downloaded = await new Promise( ( resolve, reject ) => {
	https.get( 'https://cdn.a8c-ci.services/wp-build/releases.json', ( response ) => {
		if ( response.statusCode === 404 || response.statusCode === 403 ) {
			resolve( false );
			return;
		}

		response.pipe( releasesFile );
		response.on( 'end', () => {
			console.log( '\nDownload complete' );
			releasesFile.close( () => resolve( true ) );
		} );
		response.on( 'error', ( err ) => reject( err ) );
	} );
} );

if ( ! downloaded ) {
	console.log( 'Creating releases.json for the first time ...' );
	await releasesFile.write( '{}\n' );
	await new Promise( ( resolve ) => {
		releasesFile.close( resolve );
	} );
	console.log( 'Done' );
}

console.log( 'Parsing current release info ...' );
const releasesData = JSON.parse( await fs.readFile( releasesPath, 'utf8' ) );

if ( isDevBuild ) {
	console.log( 'Overriding latest dev release ...' );

	if ( ! currentCommit ) {
		// Without the latest commit hash we can't determine what the zip filename will be.
		// Are you sure you're running this script in a CI environment?
		// You can develop locally by setting the GITHUB_SHA envvar before running this script.
		throw new Error( 'Missing latest commit hash' );
	}

	// We're only building universal binaries on macOS for now
	const arch = process.platform === 'darwin' ? 'universal' : process.arch;

	const devVersionZipFilename = `https://cdn.a8c-ci.services/wp-build/wp-build-${ process.platform }-${ arch }-${ currentCommit }.app.zip`;

	releasesData[ 'dev' ] = releasesData[ 'dev' ] ?? {};
	releasesData[ 'dev' ][ process.platform ] = releasesData[ 'dev' ][ process.platform ] ?? {};
	releasesData[ 'dev' ][ process.platform ][ arch ] = {
		sha: currentCommit,
		url: devVersionZipFilename,
	};

	await fs.writeFile( releasesPath, JSON.stringify( releasesData, null, 2 ) );
	console.log( 'Overwrote latest dev release' );
}

// TODO: handle the case where the changeset is tagged as a release version.

console.log( 'Done generating releases manifest.' );
process.exit( 0 );
