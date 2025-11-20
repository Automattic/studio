import os from 'os';
import path from 'path';
import unzipper from 'unzipper';
import fs from 'fs-extra';
import { getLatestSQLiteCommandRelease } from '../src/lib/sqlite-command-release';
import { SQLITE_DATABASE_INTEGRATION_RELEASE_URL } from '../src/constants';

const WP_SERVER_FILES_PATH = path.join( __dirname, '..', 'wp-files' );

type MaybePromise< T > = T | Promise< T >;
type FileToDownload = {
	name: string;
	description: string;
	getUrl: () => MaybePromise< string >;
	destinationPath?: string;
};

const FILES_TO_DOWNLOAD: FileToDownload[] = [
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

async function downloadFile( file: FileToDownload ): Promise< void > {
	const { name, description, destinationPath } = file;
	console.log( `[${ name }] Downloading ${ description } ...` );
	const zipPath = path.join( os.tmpdir(), `${ name }.zip` );
	const extractedPath = destinationPath ?? WP_SERVER_FILES_PATH;

	try {
		fs.ensureDirSync( extractedPath );
	} catch ( error ) {
		const fsError = error as { code: string };
		if ( fsError.code !== 'EEXIST' ) throw error;
	}

	const url = await file.getUrl();
	const response = await fetch( url );
	if ( ! response.ok ) {
		throw new Error( `Request failed with status code: ${ response.status }` );
	}
	const buffer = Buffer.from( await response.arrayBuffer() );
	await fs.writeFile( zipPath, buffer );

	if ( name === 'wp-cli' ) {
		console.log( `[${ name }] Moving WP-CLI to destination ...` );
		fs.moveSync( zipPath, path.join( extractedPath, 'wp-cli.phar' ), { overwrite: true } );
	} else if ( name === 'sqlite' ) {
		/**
		 * The SQLite database integration plugin is extracted
		 * into a folder with the version number like sqlite-database-integration-1.0.0
		 * We need to move the contents of that folder to the sqlite-database-integration folder
		 */
		console.log( `[${ name }] Extracting files from zip ...` );
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
		console.log( `[${ name }] Extracting files from zip ...` );
		await fs
			.createReadStream( zipPath )
			.pipe( unzipper.Extract( { path: extractedPath } ) )
			.promise();
	}

	console.log( `[${ name }] Files extracted` );
}

async function downloadFiles() {
	for ( const file of FILES_TO_DOWNLOAD ) {
		try {
			await downloadFile( file );
		} catch ( err ) {
			console.error( err );
			process.exit( 1 );
		}
	}
}

downloadFiles();
