import { describe, expect, it } from 'vitest';
import { formatDbHost, parseDbHost } from '../connection';

describe( 'parseDbHost', () => {
	it( 'reads the host and port of a DB_HOST value', () => {
		expect( parseDbHost( '127.0.0.1:3307' ) ).toEqual( { host: '127.0.0.1', port: 3307 } );
		expect( parseDbHost( 'db.local' ) ).toEqual( { host: 'db.local', port: 3306 } );
	} );

	it( 'rejects what PHP would reach through a socket', () => {
		expect( () => parseDbHost( 'localhost:/tmp/mysql.sock' ) ).toThrow( 'over TCP' );
		expect( () => parseDbHost( 'localhost:3306' ) ).toThrow( 'Use 127.0.0.1' );
	} );
} );

describe( 'formatDbHost', () => {
	it( 'leaves out the default port', () => {
		expect( formatDbHost( { host: '127.0.0.1', port: 3306 } ) ).toBe( '127.0.0.1' );
		expect( formatDbHost( { host: '127.0.0.1', port: 3307 } ) ).toBe( '127.0.0.1:3307' );
	} );
} );
