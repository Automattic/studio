import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../database';
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
const engines: DatabaseConnection[] = [
	{ engine: 'sqlite', path: path.join( directory, 'database', 'test.sqlite' ) },
	...( mysql ? [ mysql ] : [] ),
];

afterAll( async () => {
	fs.rmSync( directory, { recursive: true, force: true } );
	if ( mysql ) {
		await using server = await createDatabase( { ...mysql, database: '' } ).open();
		await server.query( `DROP DATABASE IF EXISTS \`${ mysql.database }\`` );
	}
} );

describe.each( engines )( 'createDatabase on $engine', ( connection ) => {
	const database = createDatabase( connection );

	it( 'creates the database, then works on it', async () => {
		await database.create();
		await using session = await database.open();
		await session.query( 'CREATE TABLE options ( id INT PRIMARY KEY, name VARCHAR(64) )' );
		await session.query( 'INSERT INTO options VALUES ( ?, ? ), ( ?, ? )', [
			2,
			'template',
			1,
			'stylesheet',
		] );

		expect( await database.exists() ).toBe( true );
		expect( await session.query( 'SELECT name FROM options WHERE id = ?', [ 1 ] ) ).toEqual( [
			{ name: 'stylesheet' },
		] );
		expect( await session.tables() ).toContain( 'options' );

		const names: unknown[] = [];
		for await ( const row of session.tableRows( 'options' ) ) {
			names.push( row.name );
		}
		expect( names.sort() ).toEqual( [ 'stylesheet', 'template' ] );
	} );

	it( 'reports a failed query', async () => {
		await using session = await database.open();
		await expect( session.query( 'SELECT * FROM missing_table' ) ).rejects.toMatchObject( {
			code: 'query_failed',
		} );
	} );
} );

describe( 'createDatabase', () => {
	it( 'reports a database it can’t open', async () => {
		const missing = createDatabase( { engine: 'sqlite', path: path.join( directory, 'missing' ) } );
		expect( await missing.exists() ).toBe( false );
		await expect( missing.open( { readOnly: true } ) ).rejects.toMatchObject( {
			code: 'connection_failed',
		} );
	} );

	it.runIf( mysql )( 'reports wrong MySQL credentials', async () => {
		await expect(
			createDatabase( { ...( mysql as MysqlConnection ), password: 'wrong' } ).open()
		).rejects.toMatchObject( { code: 'connection_failed' } );
	} );
} );
