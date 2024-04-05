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

const currentCommit = process.env.GITHUB_SHA ?? process.env.BUILDKITE_COMMIT;
const { version } = packageJson;
const isDevBuild = version.includes( '-dev.' );

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

if ( process.platform !== 'darwin' ) {
	console.log(
		'Skipping manifest generation on this platform; for now we only store release info for Mac builds'
	);
	process.exit( 0 );
}

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
// const releasesData = JSON.parse( await fs.readFile( releasesPath, 'utf8' ) );

// Temporary hack to fix paths to alphas
const releasesData = {
	dev: {
		darwin: {
			universal: {
				sha: '94dbc8a633e65a5f9ed7374c56acf5d802ec8f4c',
				url: 'https://cdn.a8c-ci.services/studio/studio-darwin-universal-94dbc8a633e65a5f9ed7374c56acf5d802ec8f4c.app.zip',
			},
		},
	},
	'0.1.0-alpha.1': {
		darwin: {
			universal: {
				sha: '83208ea71b81058bb686dd8bc71adafe5a78e9b1',
				url: 'https://cdn.a8c-ci.services/studio/studio-darwin-universal-v0.1.0-alpha.1.app.zip',
			},
		},
	},
	'0.1.0-alpha.2': {
		darwin: {
			universal: {
				sha: '98146f2b613b3a937a5d200daa0ed0b8a14dc4bd',
				url: 'https://cdn.a8c-ci.services/studio/studio-darwin-universal-v0.1.0-alpha.2.app.zip',
			},
		},
	},
	'0.1.0-alpha.4': {
		darwin: {
			universal: {
				sha: '80791eacd8bdb3a30043a059273843779eec5a6e',
				url: 'https://cdn.a8c-ci.services/studio/studio-darwin-universal-v0.1.0-alpha.4.app.zip',
			},
		},
	},
	'0.1.0-alpha.5': {
		darwin: {
			universal: {
				sha: 'a1c70f3a3be5d28922a48f7f298f6152d6001516',
				url: 'https://cdn.a8c-ci.services/studio/studio-darwin-universal-v0.1.0-alpha.5.app.zip',
			},
		},
	},
};

// We're only building universal binaries on macOS for now
const arch = process.platform === 'darwin' ? 'universal' : process.arch;

if ( isDevBuild ) {
	console.log( 'Overriding latest dev release ...' );

	if ( ! currentCommit ) {
		// Without the latest commit hash we can't determine what the zip filename will be.
		// Are you sure you're running this script in a CI environment?
		// You can develop locally by setting the GITHUB_SHA envvar before running this script.
		throw new Error( 'Missing latest commit hash' );
	}

	const devVersionZipFilename = `https://cdn.a8c-ci.services/studio/studio-${ process.platform }-${ arch }-${ currentCommit }.app.zip`;

	releasesData[ 'dev' ] = releasesData[ 'dev' ] ?? {};
	releasesData[ 'dev' ][ process.platform ] = releasesData[ 'dev' ][ process.platform ] ?? {};
	releasesData[ 'dev' ][ process.platform ][ arch ] = {
		sha: currentCommit,
		url: devVersionZipFilename,
	};

	await fs.writeFile( releasesPath, JSON.stringify( releasesData, null, 2 ) );
	console.log( 'Overwrote latest dev release' );
} else {
	console.log( 'Adding latest release ...' );

	const releaseVersionZipFilename = `https://cdn.a8c-ci.services/studio/studio-${ process.platform }-${ arch }-v${ version }.app.zip`;

	releasesData[ version ] = releasesData[ version ] ?? {};
	releasesData[ version ][ process.platform ] = releasesData[ version ][ process.platform ] ?? {};
	releasesData[ version ][ process.platform ][ arch ] = {
		sha: currentCommit,
		url: releaseVersionZipFilename,
	};

	await fs.writeFile( releasesPath, JSON.stringify( releasesData, null, 2 ) );
	console.log( 'Added latest release' );
}

console.log( 'Done generating releases manifest.' );
process.exit( 0 );
