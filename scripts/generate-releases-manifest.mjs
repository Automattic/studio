// This script creates a manifest file that gets uploaded to the CDN so the update API can check for new versions.
// The file is uploaded to `https://cdn.a8c-ci.services/studio/releases.json` and looks like
//
// {
//   "dev": {
//     "darwin": {
//       "universal": {
//         "sha": "30a8251",
//         "url": "https://cdn.a8c-ci.services/studio/studio-darwin-universal-30a8251.app.zip"
//       },
//       "arm64": {
//         "sha": "30a8251",
//         "url": "https://cdn.a8c-ci.services/studio/studio-darwin-arm64-30a8251.app.zip"
//       },
//       "x64": {
//         "sha": "30a8251",
//         "url": "https://cdn.a8c-ci.services/studio/studio-darwin-x64-30a8251.app.zip"
//       }
//     },
//     "win32": {
//       "sha": "30a8251",
//       "url": "https://cdn.a8c-ci.services/studio/studio-win32-30a8251.exe.zip"
//     }
//   },
//   "1.0.0": {
//     "darwin": {
//       "universal": {
//         "sha": "abcdef1234567890",
//         "url": "https://cdn.a8c-ci.services/studio/studio-darwin-universal-v1.0.0.app.zip"
//       },
//       ... etc.
//     },
//     ... etc.
//   },
//   "1.0.1-beta1": { ... },
//   "1.2.1-rc3": { ... },
// }
//
// The "dev" entry will be replaced with the latest build from trunk.

import * as child_process from 'child_process';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import packageJson from '../package.json' assert { type: 'json' };

const cdnURL = 'https://cdn.a8c-ci.services/studio';
const baseName = 'studio';

const currentCommit = child_process.execSync( 'git rev-parse --short HEAD' ).toString().trim();
const { version } = packageJson;
const isDevBuild = process.env.IS_DEV_BUILD;

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

console.log( `Version: ${ version }` );
console.log( `Is dev build: ${ isDevBuild }` );
console.log( `Current commit: ${ currentCommit }` );

console.log( 'Downloading current manifest ...' );

const releasesPath = path.join( __dirname, '..', 'out', 'releases.json' );

async function getWindowsReleaseInfo() {
	let windowsReleaseInfo = {};
	try {
		windowsReleaseInfo = await fs.readFile(
			path.join( __dirname, '..', 'out', 'make', 'squirrel.windows', 'x64', 'RELEASES' ),
			'utf8'
		);
	} catch ( error ) {
		console.log(
			`Couldn't read RELEASES file of Windows build, please ensure that the file exists to generate the release manifest.`
		);
		process.exit( 1 );
	}

	const [ _, sha1, filename, size ] = windowsReleaseInfo.match(
		/([a-zA-Z\d]{40})\s(.*\.nupkg)\s(\d+)/
	);

	return { sha1, filename, size };
}

try {
	await fs.mkdir( path.dirname( releasesPath ) );
} catch ( err ) {
	if ( err.code !== 'EEXIST' ) throw err;
}

const releasesFile = createWriteStream( releasesPath, { flags: 'w' } ); // 'w', we want to override any existing file

const downloaded = await new Promise( ( resolve, reject ) => {
	https.get( `${ cdnURL }/releases.json`, ( response ) => {
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

	releasesData[ 'dev' ] = releasesData[ 'dev' ] ?? {};

	// macOS
	releasesData[ 'dev' ][ 'darwin' ] = releasesData[ 'dev' ][ 'darwin' ] ?? {};
	releasesData[ 'dev' ][ 'darwin' ][ 'universal' ] = {
		sha: currentCommit,
		url: `${ cdnURL }/${ baseName }-darwin-universal-${ currentCommit }.app.zip`,
	};
	releasesData[ 'dev' ][ 'darwin' ][ 'x64' ] = {
		sha: currentCommit,
		url: `${ cdnURL }/${ baseName }-darwin-x64-${ currentCommit }.app.zip`,
	};
	releasesData[ 'dev' ][ 'darwin' ][ 'arm64' ] = {
		sha: currentCommit,
		url: `${ cdnURL }/${ baseName }-darwin-arm64-${ currentCommit }.app.zip`,
	};

	// Windows
	const windowsReleaseInfo = await getWindowsReleaseInfo();
	releasesData[ 'dev' ][ 'win32' ] = {
		sha: windowsReleaseInfo.sha1,
		url: `${ cdnURL }/${ baseName }-win32-${ currentCommit }-full.nupkg`,
		size: windowsReleaseInfo.size,
	};

	await fs.writeFile( releasesPath, JSON.stringify( releasesData, null, 2 ) );
	console.log( 'Overwrote latest dev release' );
} else {
	console.log( 'Adding latest release ...' );

	releasesData[ version ] = releasesData[ version ] ?? {};

	// macOS
	releasesData[ version ][ 'darwin' ] = releasesData[ version ][ 'darwin' ] ?? {};
	releasesData[ version ][ 'darwin' ][ 'universal' ] = {
		sha: currentCommit,
		url: `${ cdnURL }/${ baseName }-darwin-universal-v${ version }.app.zip`,
	};
	releasesData[ version ][ 'darwin' ][ 'x64' ] = {
		sha: currentCommit,
		url: `${ cdnURL }/${ baseName }-darwin-x64-v${ version }.app.zip`,
	};
	releasesData[ version ][ 'darwin' ][ 'arm64' ] = {
		sha: currentCommit,
		url: `${ cdnURL }/${ baseName }-darwin-arm64-v${ version }.app.zip`,
	};

	// Windows
	const windowsRelease = await getWindowsReleaseInfo();
	releasesData[ version ][ 'win32' ] = {
		sha: windowsRelease.sha1,
		url: `${ cdnURL }/${ baseName }-win32-v${ version }-full.nupkg`,
		size: windowsRelease.size,
	};

	await fs.writeFile( releasesPath, JSON.stringify( releasesData, null, 2 ) );
	console.log( 'Added latest release' );
}

console.log( 'Done generating releases manifest.' );
process.exit( 0 );
