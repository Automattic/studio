import fs from 'fs';
import path from 'path';
import { __ } from '@wordpress/i18n';
import archiver, { EntryData } from 'archiver';
import { LoggerError } from 'cli/logger';

const ZIP_COMPRESSION_LEVEL = 9;

export async function archiveSiteContent(
	siteFolder: string,
	archivePath: string
): Promise< archiver.Archiver > {
	return new Promise( ( resolve, reject ) => {
		const output = fs.createWriteStream( archivePath );
		const archiveBuilder = archiver( 'zip', {
			zlib: { level: ZIP_COMPRESSION_LEVEL },
			followSymlinks: true,
		} );

		output.on( 'close', () => {
			resolve( archiveBuilder );
		} );
		archiveBuilder.on( 'error', ( error: Error ) => {
			reject( new LoggerError( __( 'Failed to create archive' ), error ) );
		} );

		archiveBuilder.pipe( output );
		archiveBuilder.directory(
			path.join( siteFolder, 'wp-content' ),
			'wp-content',
			( entry: EntryData ) => {
				if ( entry.name.includes( '.git' ) || entry.name.includes( 'node_modules' ) ) {
					return false;
				}
				return entry;
			}
		);

		const wpConfigPath = path.join( siteFolder, 'wp-config.php' );
		if ( fs.existsSync( wpConfigPath ) ) {
			archiveBuilder.file( wpConfigPath, { name: 'wp-config.php' } );
		}

		archiveBuilder.finalize().catch( reject );
	} );
}

export async function cleanup( archivePath: string ): Promise< void > {
	// Wrap the cleanup logic in a setTimeout to avoid race conditions
	return new Promise( ( resolve ) => {
		setTimeout( () => {
			if ( fs.existsSync( archivePath ) ) {
				fs.unlinkSync( archivePath );
			}
			resolve();
		}, 0 );
	} );
}
