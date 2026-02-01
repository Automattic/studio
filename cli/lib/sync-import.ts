import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import * as tar from 'tar';
import { SiteData } from 'cli/lib/appdata';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { Logger } from 'cli/logger';

export async function importBackupFromFile(
	backupPath: string,
	site: SiteData,
	logger: Logger
): Promise< void > {
	const extractDir = path.join( path.dirname( backupPath ), 'extract-' + Date.now() );

	try {
		// Extract tar.gz
		logger.reportProgress( __( 'Extracting backup…' ) );
		await fsPromises.mkdir( extractDir, { recursive: true } );

		await tar.extract( {
			file: backupPath,
			cwd: extractDir,
		} );

		// Import wp-content
		const wpContentSrc = path.join( extractDir, 'wp-content' );
		const wpContentDest = path.join( site.path, 'wp-content' );

		if ( fs.existsSync( wpContentSrc ) ) {
			logger.reportProgress( __( 'Importing wp-content…' ) );

			// Copy wp-content files
			await copyDirectory( wpContentSrc, wpContentDest );
		}

		// Import SQL files
		const sqlDir = path.join( extractDir, 'sql' );
		if ( fs.existsSync( sqlDir ) ) {
			logger.reportProgress( __( 'Importing database…' ) );

			const sqlFiles = await fsPromises.readdir( sqlDir );

			for ( const sqlFile of sqlFiles ) {
				if ( ! sqlFile.endsWith( '.sql' ) ) {
					continue;
				}

				const sqlPath = path.join( sqlDir, sqlFile );
				const sqlContent = await fsPromises.readFile( sqlPath, 'utf-8' );

				// Copy SQL file to WordPress directory so WP-CLI can access it
				const tempSqlFileName = `.temp-import-${ Date.now() }.sql`;
				const tempSqlPath = path.join( site.path, tempSqlFileName );
				await fsPromises.writeFile( tempSqlPath, sqlContent );

				// Import via WP-CLI db import command
				try {
					const [ response, exitPhp ] = await runWpCliCommand( site.path, site.phpVersion, [
						'db',
						'import',
						tempSqlFileName,
					] );

					await response.text; // Ensure command completes
					exitPhp();
				} catch ( error ) {
					console.warn( sprintf( __( 'Warning: Failed to import %s' ), sqlFile ) );
				} finally {
					// Cleanup temp SQL file
					await fsPromises.unlink( tempSqlPath ).catch( () => {} );
				}
			}
		}

		logger.reportProgress( __( 'Import complete' ) );
	} finally {
		// Cleanup extraction directory
		if ( fs.existsSync( extractDir ) ) {
			await fsPromises.rm( extractDir, { recursive: true, force: true } ).catch( () => {} );
		}
	}
}

async function copyDirectory( src: string, dest: string ): Promise< void > {
	await fsPromises.mkdir( dest, { recursive: true } );

	const entries = await fsPromises.readdir( src, { withFileTypes: true } );

	for ( const entry of entries ) {
		const srcPath = path.join( src, entry.name );
		const destPath = path.join( dest, entry.name );

		if ( entry.isDirectory() ) {
			await copyDirectory( srcPath, destPath );
		} else {
			await fsPromises.copyFile( srcPath, destPath );
		}
	}
}
