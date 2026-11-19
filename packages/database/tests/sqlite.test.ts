import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
import { copySqliteDatabase } from '../sqlite';

let directory: string;
let databasePath: string;

beforeEach( () => {
	directory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-database-' ) );
	databasePath = path.join( directory, '.ht.sqlite' );
} );

afterEach( () => {
	fs.rmSync( directory, { recursive: true, force: true } );
} );

function withSqlite< T >( file: string, run: ( database: DatabaseSync ) => T ): T {
	const database = new DatabaseSync( file );
	try {
		return run( database );
	} finally {
		database.close();
	}
}

const journalMode = ( file: string ) =>
	withSqlite(
		file,
		( database ) =>
			( database.prepare( 'PRAGMA journal_mode' ).get() as { journal_mode: string } ).journal_mode
	);

const sqlite = () => createDatabase( { engine: 'sqlite', path: databasePath } );

describe( 'prepareForSharing', () => {
	it( 'switches a WAL database to rollback mode', async () => {
		withSqlite( databasePath, ( database ) => {
			database.exec( 'PRAGMA journal_mode = WAL' );
			database.exec( 'CREATE TABLE t ( id INTEGER )' );
		} );

		await sqlite().prepareForSharing();

		expect( journalMode( databasePath ) ).toBe( 'delete' );
	} );

	it( 'leaves a missing database alone', async () => {
		await sqlite().prepareForSharing();
		expect( fs.existsSync( databasePath ) ).toBe( false );
	} );
} );

describe( 'repair', () => {
	it( 'replaces MySQL 8-only collations and keeps the others', async () => {
		withSqlite( databasePath, ( database ) =>
			database.exec( `
				CREATE TABLE _wp_sqlite_mysql_information_schema_schemata ( DEFAULT_COLLATION_NAME TEXT );
				CREATE TABLE _wp_sqlite_mysql_information_schema_tables ( TABLE_NAME TEXT, TABLE_COLLATION TEXT );
				CREATE TABLE _wp_sqlite_mysql_information_schema_columns ( COLUMN_NAME TEXT, COLLATION_NAME TEXT );
				INSERT INTO _wp_sqlite_mysql_information_schema_schemata VALUES ( 'utf8mb4_0900_ai_ci' );
				INSERT INTO _wp_sqlite_mysql_information_schema_tables VALUES
					( 'local', 'utf8mb4_0900_ai_ci' ),
					( 'pulled', 'utf8mb4_unicode_520_ci' );
				INSERT INTO _wp_sqlite_mysql_information_schema_columns VALUES
					( 'a', 'utf8mb4_0900_as_cs' ),
					( 'b', 'utf8mb4_0900_bin' ),
					( 'c', NULL );
			` )
		);

		await sqlite().repair();

		withSqlite( databasePath, ( database ) => {
			expect(
				database.prepare( 'SELECT * FROM _wp_sqlite_mysql_information_schema_schemata' ).all()
			).toEqual( [ { DEFAULT_COLLATION_NAME: 'utf8mb4_unicode_ci' } ] );
			expect(
				database.prepare( 'SELECT * FROM _wp_sqlite_mysql_information_schema_tables' ).all()
			).toEqual( [
				{ TABLE_NAME: 'local', TABLE_COLLATION: 'utf8mb4_unicode_ci' },
				{ TABLE_NAME: 'pulled', TABLE_COLLATION: 'utf8mb4_unicode_520_ci' },
			] );
			expect(
				database.prepare( 'SELECT * FROM _wp_sqlite_mysql_information_schema_columns' ).all()
			).toEqual( [
				{ COLUMN_NAME: 'a', COLLATION_NAME: 'utf8mb4_unicode_ci' },
				{ COLUMN_NAME: 'b', COLLATION_NAME: 'utf8mb4_bin' },
				{ COLUMN_NAME: 'c', COLLATION_NAME: null },
			] );
		} );
	} );

	it( 'leaves a database without the driver’s information schema alone', async () => {
		withSqlite( databasePath, ( database ) =>
			database.exec( 'CREATE TABLE wp_options ( option_name TEXT )' )
		);
		await expect( sqlite().repair() ).resolves.toBeUndefined();
	} );
} );

describe( 'copySqliteDatabase', () => {
	it( 'copies a WAL database into one file in rollback mode', async () => {
		withSqlite( databasePath, ( database ) => {
			database.exec( 'PRAGMA journal_mode = WAL' );
			database.exec( "CREATE TABLE t ( name TEXT ); INSERT INTO t VALUES ( 'kept' )" );
		} );
		const copyPath = path.join( directory, 'copy.sqlite' );

		await copySqliteDatabase( databasePath, copyPath );

		expect( journalMode( copyPath ) ).toBe( 'delete' );
		expect(
			withSqlite( copyPath, ( database ) => database.prepare( 'SELECT name FROM t' ).all() )
		).toEqual( [ { name: 'kept' } ] );
	} );
} );
