import os from 'node:os';
import { getPrettyPath, normalizeHostname } from 'cli/lib/utils';

describe( 'normalizeHostname', () => {
	it( 'should normalize a basic hostname', () => {
		expect( normalizeHostname( 'example.com' ) ).toBe( 'example.com' );
	} );

	it( 'should remove http protocol', () => {
		expect( normalizeHostname( 'http://example.com' ) ).toBe( 'example.com' );
	} );

	it( 'should remove https protocol', () => {
		expect( normalizeHostname( 'https://example.com' ) ).toBe( 'example.com' );
	} );

	it( 'should remove trailing slash', () => {
		expect( normalizeHostname( 'example.com/' ) ).toBe( 'example.com' );
	} );

	it( 'should convert to lowercase', () => {
		expect( normalizeHostname( 'EXAMPLE.COM' ) ).toBe( 'example.com' );
	} );

	it( 'should trim whitespace', () => {
		expect( normalizeHostname( '  example.com  ' ) ).toBe( 'example.com' );
	} );

	it( 'should handle multiple transformations', () => {
		expect( normalizeHostname( '  HTTPS://EXAMPLE.COM/  ' ) ).toBe( 'example.com' );
	} );
} );

describe( 'getPrettyPath', () => {
	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should replace current working directory with a dot on Posix', () => {
		vi.spyOn( process, 'cwd' ).mockReturnValue( '/Users/george/Studio' );
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'darwin' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( '/Users/george' );

		expect( getPrettyPath( '/Users/george/Studio/my-site/index.php' ) ).toBe(
			'./my-site/index.php'
		);
	} );

	it( 'should not replace current working directory with a dot if at root', () => {
		vi.spyOn( process, 'cwd' ).mockReturnValue( '/' );
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'darwin' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( '/Users/george' );

		expect( getPrettyPath( '/Users/jenny/Studio/my-site/index.php' ) ).toBe(
			'/Users/jenny/Studio/my-site/index.php'
		);
	} );

	it( 'should replace current working directory with a dot on Windows', () => {
		vi.spyOn( process, 'cwd' ).mockReturnValue( 'C:\\Users\\george\\Studio' );
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'win32' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( 'C:\\Users\\george' );

		expect( getPrettyPath( 'C:\\Users\\george\\Studio\\index.php' ) ).toBe( '.\\index.php' );
	} );

	it( 'should replace home directory prefix with tilde on Posix', () => {
		vi.spyOn( process, 'cwd' ).mockReturnValue( '/etc' );
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'darwin' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( '/Users/george' );

		expect( getPrettyPath( '/Users/george/Studio/my-site/index.php' ) ).toBe(
			'~/Studio/my-site/index.php'
		);
	} );

	it( 'should not replace home directory prefix with tilde on Windows', () => {
		vi.spyOn( process, 'cwd' ).mockReturnValue( 'C:\\Windows' );
		vi.spyOn( process, 'platform', 'get' ).mockReturnValue( 'win32' );
		vi.spyOn( os, 'homedir' ).mockReturnValue( 'C:\\Users\\george' );

		expect( getPrettyPath( 'C:\\Users\\george\\Studio\\index.php' ) ).toBe(
			'C:\\Users\\george\\Studio\\index.php'
		);
	} );
} );
