import os from 'os';
import path from 'path';
import unzipper from 'unzipper';
import fs from 'fs-extra';

// Constants
const SQLITE_DATABASE_INTEGRATION_VERSION = 'v2.2.14';
const SQLITE_DATABASE_INTEGRATION_RELEASE_URL = `https://github.com/WordPress/sqlite-database-integration/archive/refs/tags/${ SQLITE_DATABASE_INTEGRATION_VERSION }.zip`;
const WP_SERVER_FILES_PATH = path.join( import.meta.dirname, '..', 'wp-files' );

/**
 * Get the latest SQLite command release from GitHub
 */
async function getLatestSQLiteCommandRelease() {
	const url = 'https://api.github.com/repos/automattic/wp-cli-sqlite-command/releases/latest';

	const headers = {
		Accept: 'application/vnd.github.v3+json',
		'User-Agent': 'wp-now-cli',
	};

	// GitHub API has rate limits:
	// - 60 requests/hour for unauthenticated requests
	// - 5,000 requests/hour with token authentication
	// In CI environments, the IP-based rate limit is shared across runners,
	// so we authenticate with GITHUB_TOKEN when available.
	if ( process.env.GITHUB_TOKEN ) {
		headers.Authorization = `token ${ process.env.GITHUB_TOKEN }`;
	}

	const response = await fetch( url, { headers } );

	if ( ! response.ok ) {
		throw new Error( `GitHub API request failed: ${ response.status } ${ response.statusText }` );
	}

	return await response.json();
}

const FILES_TO_DOWNLOAD = [
	{
		name: 'wordpress',
		description: 'latest WordPress version',
		getUrl: () => 'https://wordpress.org/latest.zip',
		destinationPath: path.join( WP_SERVER_FILES_PATH, 'latest' ),
	},
	{
		name: 'sqlite',
		description: 'SQLite files',
		getUrl: () => SQLITE_DATABASE_INTEGRATION_RELEASE_URL,
	},
	{
		name: 'wp-cli',
		description: 'WP-CLI phar file',
		getUrl: () => 'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar',
		destinationPath: path.join( WP_SERVER_FILES_PATH, 'wp-cli' ),
	},
	{
		name: 'sqlite-command',
		description: 'SQLite command',
		getUrl: async () => {
			const latestRelease = await getLatestSQLiteCommandRelease();
			return latestRelease.assets?.[ 0 ].browser_download_url ?? '';
		},
		destinationPath: path.join( WP_SERVER_FILES_PATH, 'sqlite-command' ),
	},
];

async function downloadFile( file ) {
	console.log( `[${ file.name }] Downloading ${ file.description } ...` );
	const zipPath = path.join( os.tmpdir(), `${ file.name }.zip` );
	const extractedPath = file.destinationPath ?? WP_SERVER_FILES_PATH;

	try {
		fs.ensureDirSync( extractedPath );
	} catch ( err ) {
		if ( err.code !== 'EEXIST' ) throw err;
	}

	const url = await file.getUrl();
	const response = await fetch( url );
	if ( ! response.ok ) {
		throw new Error( `Request failed with status code: ${ response.status }` );
	}
	const buffer = Buffer.from( await response.arrayBuffer() );
	await fs.writeFile( zipPath, buffer );

	if ( file.name === 'wp-cli' ) {
		console.log( `[${ file.name }] Moving WP-CLI to destination ...` );
		fs.moveSync( zipPath, path.join( extractedPath, 'wp-cli.phar' ), { overwrite: true } );
	} else if ( file.name === 'sqlite' ) {
		/**
		 * The SQLite database integration plugin is extracted
		 * into a folder with the version number like sqlite-database-integration-1.0.0
		 * We need to move the contents of that folder to the sqlite-database-integration folder
		 */
		console.log( `[${ file.name }] Extracting files from zip ...` );
		await fs
			.createReadStream( zipPath )
			.pipe( unzipper.Extract( { path: extractedPath } ) )
			.promise();

		const files = fs.readdirSync( extractedPath );
		const sqliteFolder = files.find( ( file ) =>
			file.startsWith( 'sqlite-database-integration-' )
		);

		if ( sqliteFolder ) {
			const sourcePath = path.join( extractedPath, sqliteFolder );
			const targetPath = path.join( extractedPath, 'sqlite-database-integration' );
			if ( fs.existsSync( targetPath ) ) {
				fs.rmSync( targetPath, { recursive: true, force: true } );
			}
			fs.renameSync( sourcePath, targetPath );
		}
	} else {
		console.log( `[${ file.name }] Extracting files from zip ...` );
		await fs
			.createReadStream( zipPath )
			.pipe( unzipper.Extract( { path: extractedPath } ) )
			.promise();
	}

	console.log( `[${ file.name }] Files extracted` );
}

for ( const file of FILES_TO_DOWNLOAD ) {
	try {
		await downloadFile( file );
	} catch ( err ) {
		console.error( err );
		process.exit( 1 );
	}
}
