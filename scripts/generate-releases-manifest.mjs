// This script creates a manifest file that gets uploaded to the CDN so the update API can check for new versions.
// The file is uploaded to `https://cdn.a8c-ci.services/studio/releases.json` and looks like
//
// {
//   "dev": {
//     "darwin": {
//       "arm64": {
//         "sha": "abcdef1234567890",
//         "url": "https://cdn.a8c-ci.services/studio/studio-darwin-arm64-abcdef1234567890.app.zip"
//       },
//       "x64": {
//         "sha": "abcdef1234567890",
//         "url": "https://cdn.a8c-ci.services/studio/studio-darwin-x64-abcdef1234567890.app.zip"
//       }
//     },
//     "win32": {
//       "x64": {
//         "sha": "abcdef1234567890",
//         "url": "https://cdn.a8c-ci.services/studio/studio-win32-x64-abcdef1234567890.exe.zip"
//       }
//     }
//   },
//   "1.0.0": {
//     "darwin": {
//       "universal": {
//         "sha": "abcdef1234567890",
//         "url": "https://cdn.a8c-ci.services/studio/studio-darwin-universal-v1.0.0.app.zip"
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
import packageJson from '../package.json' assert { type: 'json' };
import * as child_process from 'child_process';

const currentCommit = child_process.execSync('git rev-parse --short HEAD').toString().trim()
const { version } = packageJson;
const isDevBuild = version.includes( '-dev.' );

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

console.log( `Version: ${ version }` );
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
	https.get( 'https://cdn.a8c-ci.services/studio/releases.json', ( response ) => {
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

	const devVersionZipFilename_mac = `https://cdn.a8c-ci.services/studio/studio-darwin-${ currentCommit }.app.zip`;
	const devVersionZipFilename_x64 = `https://cdn.a8c-ci.services/studio/studio-darwin-x64-${ currentCommit }.app.zip`;
	const devVersionZipFilename_arm64 = `https://cdn.a8c-ci.services/studio/studio-darwin-arm64-${ currentCommit }.app.zip`;
	const devVersionZipFilename_win32 = `https://cdn.a8c-ci.services/studio/studio-win32-${ currentCommit }.exe`;

	releasesData[ 'dev' ] = releasesData[ 'dev' ] ?? {};

	// macOS
	releasesData[ 'dev' ][ 'darwin' ] = releasesData[ 'dev' ][ 'darwin' ] ?? {};
	releasesData[ 'dev' ][ 'darwin' ][ 'universal' ] = {
		sha: currentCommit,
		url: devVersionZipFilename_mac,
	};
	releasesData[ 'dev' ][ 'darwin' ][ 'x64' ] = {
		sha: currentCommit,
		url: devVersionZipFilename_x64,
	};
	releasesData[ 'dev' ][ 'darwin' ][ 'arm64' ] = {
		sha: currentCommit,
		url: devVersionZipFilename_arm64,
	};

	// Windows
	releasesData[ 'dev' ][ 'win32' ] = {
		sha: currentCommit,
		url: devVersionZipFilename_win32
	}

	await fs.writeFile( releasesPath, JSON.stringify( releasesData, null, 2 ) );
	console.log( 'Overwrote latest dev release' );
} else {
	console.log( 'Adding latest release ...' );

	const releaseVersionZipFilename_x64 = `https://cdn.a8c-ci.services/studio/studio-${ process.platform }-x64-v${ version }.app.zip`;
	const releaseVersionZipFilename_arm64 = `https://cdn.a8c-ci.services/studio/studio-${ process.platform }-arm64-v${ version }.app.zip`;
	const releaseVersionZipFilename_win32 = `https://cdn.a8c-ci.services/studio/studio-${ process.platform }-arm64-v${ version }.app.zip`;

	releasesData[ version ] = releasesData[ version ] ?? {};
	releasesData[ version ][ process.platform ] = releasesData[ version ][ process.platform ] ?? {};
	releasesData[ version ][ process.platform ][ 'x64' ] = {
		sha: currentCommit,
		url: releaseVersionZipFilename_x64,
	};
	releasesData[ version ][ process.platform ][ 'arm64' ] = {
		sha: currentCommit,
		url: releaseVersionZipFilename_arm64,
	};

	await fs.writeFile( releasesPath, JSON.stringify( releasesData, null, 2 ) );
	console.log( 'Added latest release' );
}

console.log( 'Done generating releases manifest.' );
process.exit( 0 );
