import { __, sprintf } from '@wordpress/i18n';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import * as tar from 'tar';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { SiteData } from 'cli/lib/appdata';
import { Logger } from 'cli/logger';

const EXCLUDED_PATHS = [
	'database',
	'db.php',
	'debug.log',
	'sqlite-database-integration',
	'.DS_Store',
	'Thumbs.db',
	'.git',
	'node_modules',
	'cache',
];

export async function exportSiteToTarGz(
	site: SiteData,
	archivePath: string,
	options: {
		includeDatabase?: boolean;
		includeWpContent?: boolean;
		specificPaths?: string[];
	},
	logger: Logger
): Promise< void > {
	const tempDir = path.join( path.dirname( archivePath ), 'temp-export-' + Date.now() );

	try {
		await fsPromises.mkdir( tempDir, { recursive: true } );

		const filesToArchive: string[] = [];

		// Export database if requested
		if ( options.includeDatabase !== false ) {
			logger.reportProgress( __( 'Exporting database…' ) );

			const sqlDir = path.join( tempDir, 'sql' );
			await fsPromises.mkdir( sqlDir, { recursive: true } );

			// Get list of tables
			const [ tablesResponse, exitTablesPhp ] = await runWpCliCommand( site.path, site.phpVersion, [
				'db',
				'tables',
				'--format=csv',
			] );

			const tablesText = await tablesResponse.text;
			exitTablesPhp();

			const tables = tablesText
				.trim()
				.split( '\n' )
				.slice( 1 ) // Skip header
				.map( ( line ) => line.trim() )
				.filter( Boolean );

			// Export each table
			for ( const table of tables ) {
				const tableSqlPath = path.join( sqlDir, `${ table }.sql` );

				try {
					const [ exportResponse, exitExportPhp ] = await runWpCliCommand(
						site.path,
						site.phpVersion,
						[ 'db', 'export', '-', `--tables=${ table }`, '--no-tablespaces' ]
					);

					const sqlContent = await exportResponse.text;
					await fsPromises.writeFile( tableSqlPath, sqlContent );
					exitExportPhp();
				} catch ( error ) {
					console.warn( sprintf( __( 'Warning: Failed to export table %s' ), table ) );
				}
			}

			filesToArchive.push( 'sql' );
		}

		// Copy wp-content if requested
		if ( options.includeWpContent !== false ) {
			logger.reportProgress( __( 'Copying wp-content…' ) );

			const wpContentSrc = path.join( site.path, 'wp-content' );
			const wpContentDest = path.join( tempDir, 'wp-content' );

			if ( fs.existsSync( wpContentSrc ) ) {
				await copyDirectoryFiltered( wpContentSrc, wpContentDest, options.specificPaths );
				filesToArchive.push( 'wp-content' );
			}
		}

		// Copy wp-config.php
		const wpConfigSrc = path.join( site.path, 'wp-config.php' );
		if ( fs.existsSync( wpConfigSrc ) ) {
			await fsPromises.copyFile( wpConfigSrc, path.join( tempDir, 'wp-config.php' ) );
			filesToArchive.push( 'wp-config.php' );
		}

		// Create meta.json
		const meta = {
			version: 1,
			created: new Date().toISOString(),
			site: {
				name: site.name,
				path: site.path,
			},
		};
		await fsPromises.writeFile( path.join( tempDir, 'meta.json' ), JSON.stringify( meta, null, 2 ) );
		filesToArchive.push( 'meta.json' );

		// Create tar.gz archive
		logger.reportProgress( __( 'Creating archive…' ) );

		await tar.create(
			{
				gzip: true,
				file: archivePath,
				cwd: tempDir,
			},
			filesToArchive
		);
	} finally {
		// Cleanup temp directory
		if ( fs.existsSync( tempDir ) ) {
			await fsPromises.rm( tempDir, { recursive: true, force: true } ).catch( () => {} );
		}
	}
}

async function copyDirectoryFiltered(
	src: string,
	dest: string,
	specificPaths?: string[]
): Promise< void > {
	await fsPromises.mkdir( dest, { recursive: true } );

	const entries = await fsPromises.readdir( src, { withFileTypes: true } );

	for ( const entry of entries ) {
		// Skip excluded paths
		if ( EXCLUDED_PATHS.includes( entry.name ) ) {
			continue;
		}

		// Check if this path is in specific paths (if specified)
		if ( specificPaths && specificPaths.length > 0 ) {
			const relativePath = path.relative( src, path.join( src, entry.name ) );
			const isIncluded = specificPaths.some( ( p ) => relativePath.startsWith( p ) );
			if ( ! isIncluded ) {
				continue;
			}
		}

		const srcPath = path.join( src, entry.name );
		const destPath = path.join( dest, entry.name );

		if ( entry.isDirectory() ) {
			// Skip .git and node_modules
			if ( entry.name === '.git' || entry.name === 'node_modules' ) {
				continue;
			}
			await copyDirectoryFiltered( srcPath, destPath, specificPaths );
		} else {
			await fsPromises.copyFile( srcPath, destPath );
		}
	}
}
