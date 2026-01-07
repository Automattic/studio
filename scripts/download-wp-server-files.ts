import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { promisify } from 'util';
import yauzl from 'yauzl';
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

const openZip = promisify< string, yauzl.Options, yauzl.ZipFile >( yauzl.open );

async function extractZip( zipPath: string, extractedPath: string ): Promise< void > {
	const zipFile = await openZip( zipPath, { lazyEntries: true } );
	const openReadStream = promisify( zipFile.openReadStream.bind( zipFile ) );

	return new Promise( ( resolve, reject ) => {
		zipFile.on( 'entry', async ( entry: yauzl.Entry ) => {
			// Skip directory entries
			if ( entry.fileName.endsWith( '/' ) ) {
				zipFile.readEntry();
				return;
			}

			const fullPath = path.join( extractedPath, entry.fileName );
			const entryDir = path.dirname( fullPath );

			try {
				await fs.ensureDir( entryDir );

				const readStream = await openReadStream( entry );
				const writeStream = fs.createWriteStream( fullPath );

				function onError( error: Error ) {
					if ( ! readStream.destroyed ) {
						readStream.destroy();
					}
					if ( ! writeStream.destroyed ) {
						writeStream.destroy();
					}
					reject( error );
				}

				readStream.once( 'error', onError );
				writeStream.once( 'error', onError );

				writeStream.once( 'finish', () => {
					zipFile.readEntry();
				} );

				readStream.pipe( writeStream );
			} catch ( error ) {
				reject( error );
			}
		} );

		zipFile.on( 'end', () => {
			resolve();
		} );

		zipFile.on( 'error', reject );

		zipFile.readEntry();
	} );
}

async function downloadFile( file: FileToDownload ): Promise< void > {
	const { name, description, destinationPath } = file;
	console.log( `[${ name }] Downloading ${ description } ...` );
	const zipPath = path.join( os.tmpdir(), `${ name }.zip` );
	const extractedPath = destinationPath ?? WP_SERVER_FILES_PATH;

	try {
		await fs.ensureDir( extractedPath );
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
		await extractZip( zipPath, extractedPath );

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
		await extractZip( zipPath, extractedPath );
	}

	console.log( `[${ name }] Files extracted` );
	await fs.remove( zipPath );
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
