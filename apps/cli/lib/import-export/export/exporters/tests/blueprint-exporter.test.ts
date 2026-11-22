/** @vitest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { Readable } from 'node:stream';
import { openBlueprint } from '@studio/blueprints/node';
import { extractZip } from '@studio/common/lib/extract-zip';
import { ZipArchive } from 'archiver';
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
	await using bundle = await openBlueprint( options.backupFile );
	{
		expect( bundle.blueprint.steps ).toEqual( [
			expect.objectContaining( { step: 'importWordPressFiles' } ),
		] );
		const snapshotDir = path.join( root, 'snapshot' );
		await extractZip( path.join( path.dirname( bundle.path ), 'site.zip' ), snapshotDir );
		const snapshot = new DatabaseSync( path.join( snapshotDir, 'wp-content/database/.ht.sqlite' ) );
		try {
			expect( snapshot.prepare( 'SELECT value FROM example' ).get()?.value ).toBe(
				'committed in WAL'
			);
		} finally {
			snapshot.close();
		}
		const config = fs.readFileSync( path.join( snapshotDir, 'wp-config.php' ), 'utf8' );
		expect( config ).toContain( "$table_prefix = 'custom_'" );
		expect( config ).toContain( "require_once ABSPATH . 'wp-settings.php';" );
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
	}
} );

it( 'exports a site without a sample configuration file', async () => {
	fs.unlinkSync( path.join( options.site.path, 'wp-config-sample.php' ) );
	await new BlueprintExporter( options ).export();
	await using bundle = await openBlueprint( options.backupFile );
	const snapshotDir = path.join( root, 'without-sample' );
	await extractZip( path.join( path.dirname( bundle.path ), 'site.zip' ), snapshotDir );
	expect( fs.readFileSync( path.join( snapshotDir, 'wp-config.php' ), 'utf8' ) ).toContain(
		"$table_prefix = 'custom_'"
	);
} );

it( 'does not copy source sample configuration code or secrets', async () => {
	fs.writeFileSync(
		path.join( options.site.path, 'wp-config-sample.php' ),
		'<?php $table_prefix = "wp_"; define( "SOURCE_SAMPLE_SECRET", "synthetic-secret" );'
	);
	await new BlueprintExporter( options ).export();
	await using bundle = await openBlueprint( options.backupFile );
	const snapshotDir = path.join( root, 'modified-sample' );
	await extractZip( path.join( path.dirname( bundle.path ), 'site.zip' ), snapshotDir );
	const config = fs.readFileSync( path.join( snapshotDir, 'wp-config.php' ), 'utf8' );
	expect( config ).toContain( "$table_prefix = 'custom_'" );
	expect( config ).not.toContain( 'synthetic-secret' );
} );

it( 'preserves an existing destination if export fails', async () => {
	fs.writeFileSync( options.backupFile, 'previous export' );
	vi.mocked( runWpCliCommand ).mockRejectedValue( new Error( 'Source unavailable' ) );
	await expect( new BlueprintExporter( options ).export() ).rejects.toThrow( 'Source unavailable' );
	expect( fs.readFileSync( options.backupFile, 'utf8' ) ).toBe( 'previous export' );
	expect( fs.readdirSync( root ).filter( ( file ) => file.endsWith( '.tmp' ) ) ).toEqual( [] );
} );

it.each( [ 'blueprint.zip', 'plugins/example/blueprint.zip' ] )(
	'does not include a previous Blueprint export from wp-content/%s',
	async ( relativePath ) => {
		options.backupFile = path.join( options.site.path, 'wp-content', relativePath );
		fs.writeFileSync( options.backupFile, 'previous export' );
		await new BlueprintExporter( options ).export();
		await using bundle = await openBlueprint( options.backupFile );
		const snapshotDir = path.join( root, 'without-previous-export' );
		await extractZip( path.join( path.dirname( bundle.path ), 'site.zip' ), snapshotDir );
		expect( fs.existsSync( path.join( snapshotDir, 'wp-content', relativePath ) ) ).toBe( false );
	}
);

it( 'excludes the destination if it appears during export', async () => {
	options.backupFile = path.join( options.site.path, 'wp-content/plugins/example/Blueprint.zip' );
	const newFileName = process.platform === 'win32' ? 'blueprint.zip' : 'Blueprint.zip';
	const newFilePath = path.join( path.dirname( options.backupFile ), newFileName );
	const originalAppend = ZipArchive.prototype.append;
	let created = false;
	const appendSpy = vi.spyOn( ZipArchive.prototype, 'append' ).mockImplementation( function (
		this: ZipArchive,
		source,
		data
	) {
		if ( data?.name === 'wp-config.php' ) {
			fs.writeFileSync( newFilePath, 'concurrent export' );
			created = true;
		}
		return originalAppend.call( this, source, data );
	} );
	try {
		await new BlueprintExporter( options ).export();
		expect( created ).toBe( true );
		await using bundle = await openBlueprint( options.backupFile );
		const snapshotDir = path.join( root, 'without-concurrent-export' );
		await extractZip( path.join( path.dirname( bundle.path ), 'site.zip' ), snapshotDir );
		expect(
			fs.existsSync( path.join( snapshotDir, 'wp-content/plugins/example', newFileName ) )
		).toBe( false );
	} finally {
		appendSpy.mockRestore();
	}
} );

it.skipIf( process.platform === 'win32' )(
	'does not include a previous Blueprint through a symlinked directory',
	async () => {
		const pluginDir = path.join( options.site.path, 'wp-content/plugins/example' );
		options.backupFile = path.join( pluginDir, 'blueprint.zip' );
		fs.writeFileSync( options.backupFile, 'previous export' );
		fs.symlinkSync( pluginDir, path.join( options.site.path, 'wp-content/alias' ), 'dir' );
		await new BlueprintExporter( options ).export();
		await using bundle = await openBlueprint( options.backupFile );
		const snapshotDir = path.join( root, 'without-previous-alias' );
		await extractZip( path.join( path.dirname( bundle.path ), 'site.zip' ), snapshotDir );
		expect( fs.existsSync( path.join( snapshotDir, 'wp-content/alias/plugin.php' ) ) ).toBe( true );
		expect( fs.existsSync( path.join( snapshotDir, 'wp-content/alias/blueprint.zip' ) ) ).toBe(
			false
		);
	}
);

it.skipIf( process.platform === 'win32' )(
	'replaces the destination symlink target without replacing the symlink',
	async () => {
		const target = path.join( options.site.path, 'wp-content/plugins/example/old-blueprint.zip' );
		options.backupFile = path.join( options.site.path, 'wp-content/blueprint.zip' );
		fs.writeFileSync( target, 'previous export' );
		fs.symlinkSync( target, options.backupFile );
		await new BlueprintExporter( options ).export();
		expect( fs.lstatSync( options.backupFile ).isSymbolicLink() ).toBe( true );
		await using bundle = await openBlueprint( options.backupFile );
		const snapshotDir = path.join( root, 'without-symlink-target' );
		await extractZip( path.join( path.dirname( bundle.path ), 'site.zip' ), snapshotDir );
		expect( fs.existsSync( path.join( snapshotDir, 'wp-content/blueprint.zip' ) ) ).toBe( false );
		expect(
			fs.existsSync( path.join( snapshotDir, 'wp-content/plugins/example/old-blueprint.zip' ) )
		).toBe( false );
	}
);

it.skipIf( process.platform === 'win32' )(
	'leaves a dangling destination symlink in place when export fails',
	async () => {
		fs.symlinkSync( path.join( root, 'missing-target.zip' ), options.backupFile );
		await expect( new BlueprintExporter( options ).export() ).rejects.toThrow( /ENOENT/ );
		expect( fs.lstatSync( options.backupFile ).isSymbolicLink() ).toBe( true );
	}
);

it( 'preserves an existing Blueprint if a source file disappears during export', async () => {
	const source = fs.realpathSync.native(
		path.join( options.site.path, 'wp-content/plugins/example/plugin.php' )
	);
	const originalFile = ZipArchive.prototype.file;
	const fileSpy = vi.spyOn( ZipArchive.prototype, 'file' ).mockImplementation( function (
		this: ZipArchive,
		file,
		data
	) {
		const result = originalFile.call( this, file, data );
		if ( file === source ) fs.unlinkSync( source );
		return result;
	} );
	fs.writeFileSync( options.backupFile, 'previous export' );
	try {
		await expect( new BlueprintExporter( options ).export() ).rejects.toThrow( /ENOENT/ );
		expect( fs.existsSync( source ) ).toBe( false );
		expect( fs.readFileSync( options.backupFile, 'utf8' ) ).toBe( 'previous export' );
	} finally {
		fileSpy.mockRestore();
	}
} );

it( 'preserves an existing Blueprint if a discovered file disappears before it is queued', async () => {
	const source = path.join( options.site.path, 'wp-content/plugins/example/plugin.php' );
	const originalRealpath = fs.realpathSync.native;
	const realpathSpy = vi
		.spyOn( fs.realpathSync, 'native' )
		.mockImplementation( ( file, ...args ) => {
			if ( file === source ) fs.unlinkSync( source );
			return originalRealpath( file, ...args );
		} );
	fs.writeFileSync( options.backupFile, 'previous export' );
	try {
		await expect( new BlueprintExporter( options ).export() ).rejects.toThrow( /ENOENT/ );
		expect( fs.existsSync( source ) ).toBe( false );
		expect( fs.readFileSync( options.backupFile, 'utf8' ) ).toBe( 'previous export' );
	} finally {
		realpathSpy.mockRestore();
	}
} );

it( 'preserves an existing Blueprint if the generated snapshot disappears', async () => {
	const originalFile = ZipArchive.prototype.file;
	let snapshotPath = '';
	const fileSpy = vi.spyOn( ZipArchive.prototype, 'file' ).mockImplementation( function (
		this: ZipArchive,
		file,
		data
	) {
		const result = originalFile.call( this, file, data );
		if ( data?.name === 'site.zip' ) {
			snapshotPath = file;
			fs.unlinkSync( file );
		}
		return result;
	} );
	fs.writeFileSync( options.backupFile, 'previous export' );
	try {
		await expect( new BlueprintExporter( options ).export() ).rejects.toThrow( /ENOENT/ );
		expect( snapshotPath ).not.toBe( '' );
		expect( fs.readFileSync( options.backupFile, 'utf8' ) ).toBe( 'previous export' );
	} finally {
		fileSpy.mockRestore();
	}
} );

it( 'preserves an existing Blueprint if the snapshot cannot be written', async () => {
	const originalCreateWriteStream = fs.createWriteStream;
	const streamSpy = vi
		.spyOn( fs, 'createWriteStream' )
		.mockImplementation( ( file, streamOptions ) => {
			if ( path.basename( String( file ) ) === 'site.zip' ) fs.mkdirSync( file );
			return originalCreateWriteStream( file, streamOptions );
		} );
	fs.writeFileSync( options.backupFile, 'previous export' );
	try {
		await expect( new BlueprintExporter( options ).export() ).rejects.toThrow(
			/EISDIR|EACCES|EPERM/
		);
		expect( fs.readFileSync( options.backupFile, 'utf8' ) ).toBe( 'previous export' );
	} finally {
		streamSpy.mockRestore();
	}
} );

it.skipIf( process.platform === 'win32' )(
	'skips a dangling symlink without failing the Blueprint export',
	async () => {
		fs.symlinkSync(
			path.join( root, 'missing' ),
			path.join( options.site.path, 'wp-content/broken' )
		);
		await expect( new BlueprintExporter( options ).export() ).resolves.toBeUndefined();
	}
);

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
