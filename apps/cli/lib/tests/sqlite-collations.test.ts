import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { replaceMysql8OnlyCollations } from '../sqlite-collations';

describe( 'replaceMysql8OnlyCollations', () => {
	let sitePath: string;
	let dbPath: string;

	beforeEach( () => {
		sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'replace-collations-' ) );
		dbPath = path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' );
		fs.mkdirSync( path.dirname( dbPath ), { recursive: true } );
	} );

	afterEach( () => {
		fs.rmSync( sitePath, { recursive: true, force: true } );
	} );

	it( 'replaces MySQL 8-only collations and keeps the others', async () => {
		const database = new DatabaseSync( dbPath );
		database.exec( `
			CREATE TABLE _wp_sqlite_mysql_information_schema_schemata ( DEFAULT_COLLATION_NAME TEXT );
			CREATE TABLE _wp_sqlite_mysql_information_schema_tables ( TABLE_NAME TEXT, TABLE_COLLATION TEXT );
			CREATE TABLE _wp_sqlite_mysql_information_schema_columns ( COLUMN_NAME TEXT, COLLATION_NAME TEXT );
			INSERT INTO _wp_sqlite_mysql_information_schema_schemata VALUES ( 'utf8mb4_0900_ai_ci' );
			INSERT INTO _wp_sqlite_mysql_information_schema_tables VALUES
				( 'local', 'utf8mb4_0900_ai_ci' ),
				( 'pulled', 'utf8mb4_unicode_ci' ),
				( 'legacy', 'latin1_swedish_ci' );
			INSERT INTO _wp_sqlite_mysql_information_schema_columns VALUES
				( 'a', 'utf8mb4_0900_as_cs' ),
				( 'b', 'utf8mb4_0900_bin' ),
				( 'c', NULL );
		` );
		database.close();

		await replaceMysql8OnlyCollations( sitePath );

		const result = new DatabaseSync( dbPath );
		try {
			expect(
				result.prepare( 'SELECT * FROM _wp_sqlite_mysql_information_schema_schemata' ).all()
			).toEqual( [ { DEFAULT_COLLATION_NAME: 'utf8mb4_unicode_520_ci' } ] );
			expect(
				result.prepare( 'SELECT * FROM _wp_sqlite_mysql_information_schema_tables' ).all()
			).toEqual( [
				{ TABLE_NAME: 'local', TABLE_COLLATION: 'utf8mb4_unicode_520_ci' },
				{ TABLE_NAME: 'pulled', TABLE_COLLATION: 'utf8mb4_unicode_ci' },
				{ TABLE_NAME: 'legacy', TABLE_COLLATION: 'latin1_swedish_ci' },
			] );
			expect(
				result.prepare( 'SELECT * FROM _wp_sqlite_mysql_information_schema_columns' ).all()
			).toEqual( [
				{ COLUMN_NAME: 'a', COLLATION_NAME: 'utf8mb4_unicode_520_ci' },
				{ COLUMN_NAME: 'b', COLLATION_NAME: 'utf8mb4_bin' },
				{ COLUMN_NAME: 'c', COLLATION_NAME: null },
			] );
		} finally {
			result.close();
		}
	} );

	it( 'is a no-op when the information schema tables do not exist', async () => {
		const database = new DatabaseSync( dbPath );
		database.exec( 'CREATE TABLE wp_options ( option_name TEXT )' );
		database.close();

		await expect( replaceMysql8OnlyCollations( sitePath ) ).resolves.toBeUndefined();
	} );

	it( 'is a no-op when the database file does not exist', async () => {
		fs.rmSync( path.dirname( dbPath ), { recursive: true, force: true } );
		await expect( replaceMysql8OnlyCollations( sitePath ) ).resolves.toBeUndefined();
	} );
} );
