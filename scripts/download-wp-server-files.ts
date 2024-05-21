import https from 'https';
import os from 'os';
import path from 'path';
import extract from 'extract-zip';
import fs from 'fs-extra';

const WP_SERVER_FILES_PATH = path.join( __dirname, '..', 'wp-files' );
const FILES_TO_DOWNLOAD = [
	{
		name: 'wordpress',
		description: 'latest WordPress version',
		url: 'https://wordpress.org/latest.zip',
		destinationPath: path.join( WP_SERVER_FILES_PATH, 'latest' ),
	},
	{
		name: 'sqlite',
		description: 'SQLite files',
		url: 'https://downloads.wordpress.org/plugin/sqlite-database-integration.zip',
	},
];

const downloadFile = async ( {
	name,
	description,
	url,
	destinationPath,
}: {
	name: string;
	description: string;
	url: string;
	destinationPath?: string;
} ) => {
	console.log( `[${ name }] Downloading ${ description } ...` );

	const zipPath = path.join( os.tmpdir(), `${ name }.zip` );
	const extractedPath = destinationPath ?? WP_SERVER_FILES_PATH;
	try {
		fs.ensureDirSync( extractedPath );
	} catch ( err ) {
		const fsError = err as { code: string };
		if ( fsError.code !== 'EEXIST' ) throw err;
	}
	const zipFile = fs.createWriteStream( zipPath );

	await new Promise< void >( ( resolve, reject ) => {
		https.get( url, ( response ) => {
			if ( response.statusCode !== 200 ) {
				reject( new Error( `Request failed with status code: ${ response.statusCode }` ) );
				return;
			}

			const totalSize = parseInt( response.headers[ 'content-length' ] ?? '', 10 );
			let downloadedSize = 0;
			const showDownloadProgress =
				typeof process.stdout.clearLine === 'function' && ! isNaN( totalSize );

			if ( showDownloadProgress ) {
				response.on( 'data', ( chunk ) => {
					downloadedSize += chunk.length;
					const progress = ( ( downloadedSize / totalSize ) * 100 ).toFixed( 2 );
					process.stdout.clearLine( 0 );
					process.stdout.cursorTo( 0 );
					process.stdout.write( `[${ name }] ${ progress }%` );
				} );
			}

			response.pipe( zipFile );
			response.on( 'end', () => {
				if ( showDownloadProgress ) {
					console.log();
				}
				zipFile.close( () => resolve() );
			} );
			response.on( 'error', ( err ) => reject( err ) );
		} );
	} );

	console.log( `[${ name }] Extracting files from zip ...` );
	await extract( zipPath, { dir: extractedPath } );
	console.log( `[${ name }] Files extracted` );
};

const downloadFiles = async () => {
	for ( const file of FILES_TO_DOWNLOAD ) {
		try {
			await downloadFile( file );
		} catch ( err ) {
			console.error( err );
			process.exit( 1 );
		}
	}
};
downloadFiles();
