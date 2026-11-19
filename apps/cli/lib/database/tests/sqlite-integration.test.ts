import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getSqliteDatabasePath,
	getSqliteIntegrationPath,
	installSqliteIntegration,
	isSqliteIntegrationAvailable,
	isSqliteIntegrationInstalled,
	needsSqliteIntegration,
	updateSqliteIntegration,
} from '../sqlite-integration';

// The plugin Studio ships, a copy of which each test puts in its own folder.
vi.mock( 'cli/lib/dependency-management/paths', () => ( { getWpFilesPath: () => root } ) );

const DB_COPY = "<?php\n$path = '{SQLITE_IMPLEMENTATION_FOLDER_PATH}';";
const CUSTOM_DROPIN = "<?php\ndefine( 'SQLITE_DB_DROPIN_VERSION', '1.8.0' );\n// custom";
const STOCK_DROPIN =
	"<?php\n/**\n * This file is auto-generated and copied from the sqlite plugin.\n */\ndefine( 'SQLITE_DB_DROPIN_VERSION', '1.8.0' );";

let root: string;
let pluginPath: string;
let sitePath: string;

const write = ( file: string, content = '' ) => {
	fs.mkdirSync( path.dirname( file ), { recursive: true } );
	fs.writeFileSync( file, content );
};
const dbPhpPath = () => path.join( sitePath, 'wp-content', 'db.php' );
const dbPathPhp = () => path.join( sitePath, 'wp-content', 'database', 'db-path.php' );

beforeEach( () => {
	root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-sqlite-integration-' ) );
	pluginPath = path.join( root, 'sqlite-database-integration' );
	sitePath = path.join( root, 'site' );
	write( path.join( pluginPath, 'db.copy' ), DB_COPY );
	write( path.join( pluginPath, 'load.php' ), '<?php' );
} );

afterEach( () => {
	fs.rmSync( root, { recursive: true, force: true } );
} );

describe( 'installSqliteIntegration', () => {
	it( 'writes a drop-in that loads the plugin and pins the database path', async () => {
		await installSqliteIntegration( sitePath );

		const dropin = fs.readFileSync( dbPhpPath(), 'utf8' );
		expect( dropin ).toMatch( /^<\?php\nif \( ! defined\( 'DB_PATH' \)/ );
		expect( dropin ).toContain( "define( 'DB_PATH', __DIR__ . '/database/.ht.sqlite' );" );
		expect( dropin ).toContain(
			"$path = realpath( __DIR__ . '/mu-plugins/sqlite-database-integration' );"
		);
		expect( fs.existsSync( path.join( getSqliteIntegrationPath( sitePath ), 'load.php' ) ) ).toBe(
			true
		);
		expect( fs.existsSync( path.dirname( getSqliteDatabasePath( sitePath ) ) ) ).toBe( true );
		expect( isSqliteIntegrationInstalled( sitePath ) ).toBe( true );
	} );

	it( 'removes a db-path.php, so the pin is the only database path', async () => {
		write( dbPathPhp(), '<?php' );
		await installSqliteIntegration( sitePath );
		expect( fs.existsSync( dbPathPhp() ) ).toBe( false );
	} );

	it( 'keeps a custom SQLite drop-in and its db-path.php, and still refreshes the plugin', async () => {
		write( dbPhpPath(), CUSTOM_DROPIN );
		write( dbPathPhp(), '<?php' );

		await installSqliteIntegration( sitePath );

		expect( fs.readFileSync( dbPhpPath(), 'utf8' ) ).toBe( CUSTOM_DROPIN );
		expect( fs.existsSync( dbPathPhp() ) ).toBe( true );
		expect( fs.existsSync( getSqliteIntegrationPath( sitePath ) ) ).toBe( true );
	} );

	it.each( [
		[ 'the stock drop-in', STOCK_DROPIN ],
		[ 'a db.php that is not a SQLite drop-in', "<?php\nrequire_once 'qm-db.php';" ],
	] )( 'replaces %s', async ( _description, content ) => {
		write( dbPhpPath(), content );
		await installSqliteIntegration( sitePath );
		expect( fs.readFileSync( dbPhpPath(), 'utf8' ) ).toContain( "define( 'DB_PATH'" );
	} );

	it( 'fails without the plugin’s files', async () => {
		fs.rmSync( pluginPath, { recursive: true } );
		expect( isSqliteIntegrationAvailable() ).toBe( false );
		await expect( installSqliteIntegration( sitePath ) ).rejects.toThrow(
			'SQLite integration files not found'
		);
	} );
} );

describe( 'needsSqliteIntegration', () => {
	it( 'is true for a fresh site without wp-config.php', () => {
		expect( needsSqliteIntegration( sitePath ) ).toBe( true );
	} );

	it.each( [
		[ 'db.php', () => dbPhpPath() ],
		[ 'the database', () => getSqliteDatabasePath( sitePath ) ],
		[ 'the plugin', () => path.join( getSqliteIntegrationPath( sitePath ), 'load.php' ) ],
	] )( 'is true while %s is left', ( _description, file ) => {
		write( path.join( sitePath, 'wp-config.php' ), '<?php' );
		write( file() );
		expect( needsSqliteIntegration( sitePath ) ).toBe( true );
	} );

	it( 'is false for a site on its own database server', () => {
		write( path.join( sitePath, 'wp-config.php' ), '<?php' );
		expect( needsSqliteIntegration( sitePath ) ).toBe( false );
	} );
} );

describe( 'updateSqliteIntegration', () => {
	it( 'restores a missing drop-in while the database is left', async () => {
		write( path.join( sitePath, 'wp-config.php' ), '<?php' );
		write( getSqliteDatabasePath( sitePath ) );

		await updateSqliteIntegration( sitePath );

		expect( isSqliteIntegrationInstalled( sitePath ) ).toBe( true );
	} );

	it( 'leaves a site on its own database server alone', async () => {
		write( path.join( sitePath, 'wp-config.php' ), '<?php' );

		await updateSqliteIntegration( sitePath );

		expect( fs.existsSync( dbPhpPath() ) ).toBe( false );
	} );
} );
