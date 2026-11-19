import { describe, expect, it } from 'vitest';
import { formatMysqlHost, parseMysqlHost } from 'cli/lib/database/mysql';

describe( 'parseMysqlHost', () => {
	it( 'reads the host and port of a DB_HOST value', () => {
		expect( parseMysqlHost( '127.0.0.1:3307' ) ).toEqual( { host: '127.0.0.1', port: 3307 } );
		expect( parseMysqlHost( 'db.local' ) ).toEqual( { host: 'db.local', port: 3306 } );
	} );

	it( 'rejects a socket, which Studio can’t connect through', () => {
		expect( () => parseMysqlHost( 'localhost:/tmp/mysql.sock' ) ).toThrow( 'socket' );
	} );
} );

describe( 'formatMysqlHost', () => {
	it( 'leaves out the default port', () => {
		expect( formatMysqlHost( { host: '127.0.0.1', port: 3306 } ) ).toBe( '127.0.0.1' );
		expect( formatMysqlHost( { host: '127.0.0.1', port: 3307 } ) ).toBe( '127.0.0.1:3307' );
	} );
} );
