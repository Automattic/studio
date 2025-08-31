import os from 'os';
import path from 'path';
import extract from 'extract-zip';
import fs from 'fs-extra';
import { download } from 'common/lib/download';
import { SQLITE_DATABASE_INTEGRATION_RELEASE_URL } from '../constants';

export interface FileToDownload {
	name: string;
	description: string;
	url: string | ( () => Promise< string > );
	destinationPath?: string;
}

/**
 * Download and extract a file to the specified destination
 * @param file File configuration to download
 * @param basePath Base path for relative destinations
 * @param options Download options
 */
export async function downloadFile(
	file: FileToDownload,
	basePath: string,
	options: { silent?: boolean } = {}
): Promise< void > {
	const { name, description, destinationPath } = file;
	const url = await getUrl( file.url );
	if ( ! options.silent ) {
		console.log( `[${ name }] Downloading ${ description }...` );
	}

	const zipPath = path.join( os.tmpdir(), `${ name }.zip` );
	const extractedPath = destinationPath ?? basePath;

	try {
		fs.ensureDirSync( extractedPath );
	} catch ( err ) {
		const fsError = err as { code: string };
		if ( fsError.code !== 'EEXIST' ) throw err;
	}

	// Import download function dynamically to avoid circular imports
	await download( url, zipPath, true, name );

	if ( name === 'wp-cli' ) {
		if ( ! options.silent ) {
			console.log( `[${ name }] Moving WP-CLI to destination...` );
		}
		fs.moveSync( zipPath, path.join( extractedPath, 'wp-cli.phar' ), { overwrite: true } );
	} else if ( name === 'sqlite' ) {
		/**
		 * The SQLite database integration plugin is extracted
		 * into a folder with the version number like sqlite-database-integration-1.0.0
		 * We need to move the contents of that folder to the sqlite-database-integration folder
		 */
		await extract( zipPath, { dir: extractedPath } );

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
		if ( ! options.silent ) {
			console.log( `[${ name }] Extracting files from zip...` );
		}
		await extract( zipPath, { dir: extractedPath } );
	}
	if ( ! options.silent ) {
		console.log( `[${ name }] Files extracted` );
	}
}

/**
 * Download multiple files sequentially
 * @param files Array of files to download
 * @param basePath Base path for relative destinations
 * @param options Download options
 */
export async function downloadFiles(
	files: FileToDownload[],
	basePath: string,
	options: { silent?: boolean } = {}
): Promise< void > {
	for ( const file of files ) {
		await downloadFile( file, basePath, options );
	}
}

async function getUrl( url: string | ( () => Promise< string > ) ): Promise< string > {
	return typeof url === 'function' ? await url() : url;
}

/**
 * Get the standard WordPress resource files configuration
 * @param basePath Base path where files should be downloaded
 */
export function getWordPressResourceFiles( basePath: string ): FileToDownload[] {
	return [
		{
			name: 'wordpress',
			description: 'WordPress (latest version)',
			url: 'https://wordpress.org/latest.zip',
			destinationPath: path.join( basePath, 'latest' ),
		},
		{
			name: 'sqlite',
			description: 'SQLite Database Integration',
			url: SQLITE_DATABASE_INTEGRATION_RELEASE_URL,
		},
		{
			name: 'wp-cli',
			description: 'WP-CLI tools',
			url: 'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar',
		},
		{
			name: 'sqlite-command',
			description: 'SQLite command tools',
			url: async () => {
				const { getLatestSQLiteCommandRelease } = await import( 'src/lib/sqlite-command-release' );
				const latestRelease = await getLatestSQLiteCommandRelease();
				return latestRelease.assets?.[ 0 ].browser_download_url ?? '';
			},
			destinationPath: path.join( basePath, 'sqlite-command' ),
		},
	];
}
