/** @vitest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { Readable } from 'node:stream';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { extractZip } from '@studio/common/lib/extract-zip';
import {
	extractBlueprintBundle,
	cleanupBlueprintTempDir,
} from '@studio/common/sites/blueprint-extract';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runWpCliCommand, WpCliResponse } from 'cli/lib/run-wp-cli-command';
import { BlueprintExporter } from '../blueprint-exporter';
import type { ExportOptions } from '../../types';

vi.mock( 'cli/lib/run-wp-cli-command', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/run-wp-cli-command') >() ),
	runWpCliCommand: vi.fn(),
} ) );
vi.mock( 'cli/lib/native-php/php-process', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/native-php/php-process') >() ),
	runPhpCommand: vi.fn( async ( args: string[] ) => {
		const source = new DatabaseSync( args[ 2 ], { readOnly: true } );
		try {
			await backup( source, args[ 3 ] );
		} finally {
			source.close();
		}
	} ),
} ) );

vi.mock( 'cli/lib/dependency-management/wordpress', () => ( {
	getWordPressVersionFromInstallation: async () => '6.8',
} ) );

let root: string;
let database: DatabaseSync;
let options: ExportOptions;

function commandResult( multisite: boolean ) {
	return {
		response: new WpCliResponse(
			Readable.from( [ JSON.stringify( { tablePrefix: 'custom_', multisite } ) ] ),
			Readable.from( [] ),
			Promise.resolve( 0 )
		),
		[ Symbol.dispose ]: () => {},
	};
}

beforeEach( () => {
	root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-blueprint-test-' ) );
	const sitePath = path.join( root, 'source' );
	fs.mkdirSync( path.join( sitePath, 'wp-content/database' ), { recursive: true } );
	fs.mkdirSync( path.join( sitePath, 'wp-content/plugins/example/.git' ), { recursive: true } );
	fs.writeFileSync( path.join( sitePath, 'wp-content/plugins/example/.git/config' ), 'git data' );
	fs.writeFileSync(
		path.join( sitePath, 'wp-content/plugins/example/plugin.php' ),
		'custom plugin'
	);
	fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), 'source credentials' );
	fs.writeFileSync( path.join( sitePath, 'wp-config-sample.php' ), "<?php $table_prefix = 'wp_';" );
	database = new DatabaseSync( path.join( sitePath, 'wp-content/database/.ht.sqlite' ) );
	database.exec(
		"PRAGMA journal_mode=WAL; CREATE TABLE example (value TEXT); INSERT INTO example VALUES ('committed in WAL');"
	);
	options = {
		site: {
			id: 'source',
			name: 'Example',
			path: sitePath,
			phpVersion: '8.4',
		} as ExportOptions[ 'site' ],
		backupFile: path.join( root, 'example-blueprint.zip' ),
		phpVersion: '8.4',
		includes: { database: true, wpContent: true },
	};
	vi.mocked( runWpCliCommand ).mockResolvedValue( commandResult( false ) );
} );

afterEach( () => {
	database.close();
	fs.rmSync( root, { recursive: true, force: true } );
} );

it( 'bundles a valid Blueprint with a consistent SQLite snapshot and custom files', async () => {
	await new BlueprintExporter( options ).export();
	const bundle = await extractBlueprintBundle( options.backupFile );
	try {
		expect( ( await validateBlueprintData( bundle.blueprintJson ) ).valid ).toBe( true );
		const snapshotDir = path.join( root, 'snapshot' );
		await extractZip( path.join( bundle.tempDir, 'site.zip' ), snapshotDir );
		const snapshot = new DatabaseSync( path.join( snapshotDir, 'wp-content/database/.ht.sqlite' ) );
		try {
			expect( snapshot.prepare( 'SELECT value FROM example' ).get()?.value ).toBe(
				'committed in WAL'
			);
		} finally {
			snapshot.close();
		}
		expect( fs.readFileSync( path.join( snapshotDir, 'wp-config.php' ), 'utf8' ) ).toBe(
			"<?php $table_prefix = 'custom_';"
		);
		expect( fs.readFileSync( path.join( options.site.path, 'wp-config.php' ), 'utf8' ) ).toBe(
			'source credentials'
		);
		expect(
			fs.readFileSync( path.join( snapshotDir, 'wp-content/plugins/example/plugin.php' ), 'utf8' )
		).toBe( 'custom plugin' );
		expect(
			fs.existsSync( path.join( snapshotDir, 'wp-content/plugins/example/.git/config' ) )
		).toBe( false );
		expect( fs.existsSync( path.join( snapshotDir, 'wp-content/database/.ht.sqlite-wal' ) ) ).toBe(
			false
		);
	} finally {
		await cleanupBlueprintTempDir( bundle.tempDir );
	}
} );

it( 'preserves an existing destination if export fails', async () => {
	fs.writeFileSync( options.backupFile, 'previous export' );
	vi.mocked( runWpCliCommand ).mockRejectedValue( new Error( 'Source unavailable' ) );
	await expect( new BlueprintExporter( options ).export() ).rejects.toThrow( 'Source unavailable' );
	expect( fs.readFileSync( options.backupFile, 'utf8' ) ).toBe( 'previous export' );
	expect( fs.readdirSync( root ).filter( ( file ) => file.endsWith( '.tmp' ) ) ).toEqual( [] );
} );

it( 'requires a ZIP destination', async () => {
	expect(
		await new BlueprintExporter( { ...options, backupFile: 'example.tar.gz' } ).canHandle()
	).toBe( false );
} );

it( 'rejects multisite before creating a partial Blueprint', async () => {
	vi.mocked( runWpCliCommand ).mockResolvedValueOnce( commandResult( true ) );
	await expect( new BlueprintExporter( options ).export() ).rejects.toThrow( 'multisite' );
	expect( fs.existsSync( options.backupFile ) ).toBe( false );
} );
