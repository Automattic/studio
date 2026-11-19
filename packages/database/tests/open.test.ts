import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createMysqlDatabase, openDatabase } from '../open';
import type { DatabaseConnection, MysqlConnection } from '../connection';

// Set STUDIO_TEST_MYSQL_URL, e.g. mysql://root:secret@127.0.0.1:3307, to run against MySQL too.
const mysqlUrl = process.env.STUDIO_TEST_MYSQL_URL
	? new URL( process.env.STUDIO_TEST_MYSQL_URL )
	: null;
const mysql: MysqlConnection | null = mysqlUrl && {
	engine: 'mysql',
	host: mysqlUrl.hostname,
	port: Number( mysqlUrl.port || 3306 ),
	user: decodeURIComponent( mysqlUrl.username ),
	password: decodeURIComponent( mysqlUrl.password ),
	database: `studio_database_test_${ process.pid }`,
};

const directory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-database-' ) );
const sqlite: DatabaseConnection = {
	engine: 'sqlite',
	path: path.join( directory, 'test.sqlite' ),
};

afterAll( async () => {
	fs.rmSync( directory, { recursive: true, force: true } );
	if ( mysql ) {
		await using server = await openDatabase( { ...mysql, database: '' } );
		await server.query( `DROP DATABASE IF EXISTS \`${ mysql.database }\`` );
	}
} );

const engines: { name: string; connection: DatabaseConnection; setUp: () => Promise< void > }[] = [
	{ name: 'SQLite', connection: sqlite, setUp: async () => {} },
	...( mysql
		? [ { name: 'MySQL', connection: mysql, setUp: () => createMysqlDatabase( mysql ) } ]
		: [] ),
];

describe.each( engines )( 'openDatabase on $name', ( { connection, setUp } ) => {
	it( 'runs statements with placeholders and returns the rows they select', async () => {
		await setUp();
		await using database = await openDatabase( connection );
		await database.query( 'CREATE TABLE options ( name VARCHAR(64), value TEXT )' );
		await database.query( 'INSERT INTO options VALUES ( ?, ? ), ( ?, ? )', [
			'stylesheet',
			'twentytwentyfive',
			'template',
			'twentytwentyfive',
		] );

		expect(
			await database.query( 'SELECT value FROM options WHERE name = ?', [ 'stylesheet' ] )
		).toEqual( [ { value: 'twentytwentyfive' } ] );

		const names: unknown[] = [];
		for await ( const row of database.rows( 'SELECT name FROM options ORDER BY name' ) ) {
			names.push( row.name );
		}
		expect( names ).toEqual( [ 'stylesheet', 'template' ] );
	} );

	it( 'reports a failed query', async () => {
		await using database = await openDatabase( connection );
		await expect( database.query( 'SELECT * FROM missing_table' ) ).rejects.toMatchObject( {
			code: 'query_failed',
		} );
	} );
} );

describe( 'openDatabase', () => {
	it( 'reports a database it can’t open', async () => {
		await expect(
			openDatabase(
				{ engine: 'sqlite', path: path.join( directory, 'missing.sqlite' ) },
				{ readOnly: true }
			)
		).rejects.toMatchObject( { code: 'connection_failed' } );
	} );

	it.runIf( mysql )( 'reports wrong MySQL credentials', async () => {
		await expect(
			openDatabase( { ...( mysql as MysqlConnection ), password: 'wrong' } )
		).rejects.toMatchObject( { code: 'connection_failed' } );
	} );
} );
