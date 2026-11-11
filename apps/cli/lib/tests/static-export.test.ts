import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWpCliCommand, WpCliResponse } from 'cli/lib/run-wp-cli-command';
import { exportStaticSite } from '../static-export';
import type { SiteData } from 'cli/lib/cli-config/core';

const bundle = vi.hoisted( () => ( { dir: '' } ) );

vi.mock( 'cli/lib/dependency-management/paths', () => ( {
	getBundledSimplyStaticPath: () => path.join( bundle.dir, 'simply-static' ),
	getBundledStaticExportScriptPath: () => path.join( bundle.dir, 'static-export.php' ),
} ) );

vi.mock( 'cli/lib/run-wp-cli-command', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/run-wp-cli-command') >() ),
	runWpCliCommand: vi.fn(),
} ) );

const roots: string[] = [];

function tempDir(): string {
	const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-static-export-' ) );
	roots.push( dir );
	return dir;
}

function createSite(): SiteData {
	bundle.dir = tempDir();
	fs.mkdirSync( path.join( bundle.dir, 'simply-static' ) );
	fs.writeFileSync( path.join( bundle.dir, 'simply-static', 'simply-static.php' ), '<?php' );
	fs.writeFileSync( path.join( bundle.dir, 'static-export.php' ), '<?php' );

	const sitePath = tempDir();
	fs.mkdirSync( path.join( sitePath, 'wp-content', 'database' ), { recursive: true } );
	const database = new DatabaseSync(
		path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' )
	);
	database.exec( 'CREATE TABLE wp_options (option_name TEXT)' );
	database.close();

	return { id: 'site-id', name: 'Site', path: sitePath, port: 8881 } as SiteData;
}

// Stands in for the PHP driver: writes the export where Simply Static would.
function mockWpCli( exitCode = 0 ) {
	vi.mocked( runWpCliCommand ).mockImplementation( async ( site ) => {
		const stagingDir = path.join( site.path, '.studio-static-export' );
		const config = JSON.parse( fs.readFileSync( path.join( stagingDir, 'config.json' ), 'utf8' ) );
		const snapshot = new DatabaseSync( path.join( stagingDir, config.databaseFile ) );
		snapshot.exec( "INSERT INTO wp_options VALUES ('simply-static')" );
		snapshot.close();
		fs.mkdirSync( path.join( stagingDir, 'output' ) );
		fs.writeFileSync( path.join( stagingDir, 'output', 'index.html' ), config.sourceUrl );

		return {
			response: new WpCliResponse(
				Readable.from( [ 'Fetched 3 of 3 pages/files\n' ] ),
				Readable.from( [ exitCode ? 'Error: boom' : '' ] ),
				Promise.resolve( exitCode )
			),
			[ Symbol.dispose ]() {},
		};
	} );
}

afterEach( () => {
	vi.clearAllMocks();
	for ( const root of roots.splice( 0 ) ) {
		fs.rmSync( root, { recursive: true, force: true } );
	}
} );

describe( 'exportStaticSite', () => {
	it( 'exports through the staged driver without touching the site database', async () => {
		const site = createSite();
		const outputDir = path.join( tempDir(), 'out' );
		const progress: string[] = [];
		mockWpCli();

		await exportStaticSite( {
			site,
			sourceUrl: 'http://localhost:8881',
			outputDir,
			onProgress: ( message ) => progress.push( message ),
		} );

		expect( runWpCliCommand ).toHaveBeenCalledWith( site, [
			'--no-color',
			'--require=.studio-static-export/static-export.php',
			'studio-static-export',
		] );
		expect( fs.readFileSync( path.join( outputDir, 'index.html' ), 'utf8' ) ).toBe(
			'http://localhost:8881'
		);
		expect( progress ).toEqual( [ 'Fetched 3 of 3 pages/files' ] );
		expect( fs.existsSync( path.join( site.path, '.studio-static-export' ) ) ).toBe( false );

		const database = new DatabaseSync(
			path.join( site.path, 'wp-content', 'database', '.ht.sqlite' )
		);
		expect( database.prepare( 'SELECT COUNT(*) AS count FROM wp_options' ).get() ).toEqual( {
			count: 0,
		} );
		database.close();
	} );

	it( 'reports a failed export and cleans up the staging directory', async () => {
		const site = createSite();
		mockWpCli( 1 );

		await expect(
			exportStaticSite( {
				site,
				sourceUrl: 'http://localhost:8881',
				outputDir: path.join( tempDir(), 'out' ),
			} )
		).rejects.toThrow( 'Static export failed: Error: boom' );
		expect( fs.existsSync( path.join( site.path, '.studio-static-export' ) ) ).toBe( false );
	} );

	it( 'refuses output directories that overlap the site or are not empty', async () => {
		const site = createSite();
		const nonEmpty = tempDir();
		fs.writeFileSync( path.join( nonEmpty, 'keep.txt' ), '' );

		for ( const outputDir of [ site.path, path.dirname( site.path ), nonEmpty ] ) {
			await expect(
				exportStaticSite( { site, sourceUrl: 'http://localhost:8881', outputDir } )
			).rejects.toThrow();
		}
		expect( runWpCliCommand ).not.toHaveBeenCalled();
		expect( fs.existsSync( path.join( nonEmpty, 'keep.txt' ) ) ).toBe( true );
	} );
} );
