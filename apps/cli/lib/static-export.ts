import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { __, sprintf } from '@wordpress/i18n';
import {
	getBundledSimplyStaticPath,
	getBundledStaticExportScriptPath,
} from 'cli/lib/dependency-management/paths';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { LoggerError } from 'cli/logger';
import type { SiteData } from 'cli/lib/cli-config/core';

// Staged inside the site so the PHP-wasm runtime, which only mounts the site folder, can
// reach the driver, the plugin, the database copy and the output. Removed afterwards.
const STAGING_SUBDIR = '.studio-static-export';
const DATABASE_FILE = '.ht.sqlite';

export type StaticExportOptions = {
	site: SiteData;
	// URL the running site is served on. Pages are crawled from it.
	sourceUrl: string;
	outputDir: string;
	// Absolute URL the export will be hosted at. Without it, links are root-relative.
	destinationUrl?: string;
	// Replace a non-empty output directory instead of refusing to write to it.
	overwrite?: boolean;
	onProgress?: ( message: string ) => void;
};

export async function exportStaticSite( {
	site,
	sourceUrl,
	outputDir,
	destinationUrl,
	overwrite = false,
	onProgress,
}: StaticExportOptions ): Promise< void > {
	if ( isSameOrInside( outputDir, site.path ) || isSameOrInside( site.path, outputDir ) ) {
		throw new LoggerError(
			__( 'The output directory cannot be inside the site folder or contain it.' ),
			undefined,
			'static_export_output_overlaps_site'
		);
	}

	const existing = await fs.promises.readdir( outputDir ).catch( () => [] );
	if ( existing.length && ! overwrite ) {
		throw new LoggerError(
			sprintf( __( 'The output directory %s is not empty.' ), outputDir ),
			undefined,
			'static_export_output_not_empty'
		);
	}

	const stagingDir = path.join( site.path, STAGING_SUBDIR );
	await fs.promises.rm( stagingDir, { recursive: true, force: true } );
	await fs.promises.mkdir( stagingDir, { recursive: true } );

	try {
		await snapshotDatabase( site.path, path.join( stagingDir, DATABASE_FILE ) );
		await fs.promises.cp( getBundledSimplyStaticPath(), path.join( stagingDir, 'simply-static' ), {
			recursive: true,
		} );
		await fs.promises.copyFile(
			getBundledStaticExportScriptPath(),
			path.join( stagingDir, 'static-export.php' )
		);
		await fs.promises.writeFile(
			path.join( stagingDir, 'config.json' ),
			JSON.stringify( { sourceUrl, destinationUrl, databaseFile: DATABASE_FILE } )
		);

		await using command = await runWpCliCommand( site, [
			'--no-color',
			`--require=${ STAGING_SUBDIR }/static-export.php`,
			'studio-static-export',
		] );

		const stderr = command.response.stderrText;
		for await ( const line of readline.createInterface( { input: command.response.stdout } ) ) {
			if ( line.trim() ) {
				onProgress?.( line.trim() );
			}
		}

		if ( ( await command.response.exitCode ) !== 0 ) {
			throw new LoggerError(
				sprintf( __( 'Static export failed: %s' ), ( await stderr ).trim() ),
				undefined,
				'static_export'
			);
		}

		await fs.promises.rm( outputDir, { recursive: true, force: true } );
		await fs.promises.mkdir( path.dirname( outputDir ), { recursive: true } );
		await fs.promises.cp( path.join( stagingDir, 'output' ), outputDir, { recursive: true } );
	} finally {
		await fs.promises.rm( stagingDir, { recursive: true, force: true } );
	}
}

function isSameOrInside( child: string, parent: string ): boolean {
	const relative = path.relative( path.resolve( parent ), path.resolve( child ) );
	return ! relative.startsWith( '..' ) && ! path.isAbsolute( relative );
}

// Simply Static keeps its settings and crawl state in the database. A consistent snapshot
// (the site may be serving requests, possibly in WAL mode) keeps those writes out of the site.
async function snapshotDatabase( sitePath: string, destination: string ): Promise< void > {
	const { DatabaseSync } = await import( 'node:sqlite' );
	const source = new DatabaseSync( path.join( sitePath, 'wp-content', 'database', DATABASE_FILE ), {
		readOnly: true,
	} );
	try {
		source.prepare( 'VACUUM INTO ?' ).run( destination );
	} finally {
		source.close();
	}
	const copy = new DatabaseSync( destination );
	try {
		copy.exec( 'PRAGMA journal_mode = DELETE' );
	} finally {
		copy.close();
	}
}
