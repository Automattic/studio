import { describe, expect, it } from 'vitest';
import { getDefaultPhpArgs, getNativePhpIniContents } from 'cli/lib/native-php';

describe( 'native PHP helpers', () => {
	if ( process.platform === 'win32' ) {
		it( 'passes `-c <php.ini path>` so php.exe is isolated from host installs', () => {
			const args = getDefaultPhpArgs( '8.4' );

			const cIndex = args.indexOf( '-c' );
			expect( cIndex ).toBeGreaterThanOrEqual( 0 );

			const cValue = args[ cIndex + 1 ];
			expect( cValue.endsWith( 'php.ini' ) ).toBe( true );

			// `-n` would short-circuit `-c` and skip our php.ini entirely.
			expect( args ).not.toContain( '-n' );

			// Static config now lives in php.ini, not in argv.
			expect( args.every( ( arg ) => ! arg.startsWith( 'extension=' ) ) ).toBe( true );
			expect( args.every( ( arg ) => ! arg.startsWith( 'extension_dir=' ) ) ).toBe( true );
			expect( args.every( ( arg ) => ! arg.startsWith( 'memory_limit=' ) ) ).toBe( true );
		} );

		it( 'generates Windows php.ini contents with extensions and CA bundle', () => {
			const contents = getNativePhpIniContents( '8.4' );

			expect( contents ).toContain( 'memory_limit=512M' );
			expect( contents ).toContain( 'extension_dir="' );
			expect( contents ).toContain( 'zend_extension=opcache' );
			expect( contents ).toContain( 'extension=pdo_sqlite' );
			expect( contents ).toContain( 'extension=sqlite3' );
			expect( contents ).toContain( 'openssl.cafile="' );
			expect( contents ).toContain( 'curl.cainfo="' );
			// Paths inside php.ini values use forward slashes — backslashes are
			// interpreted as escape characters by PHP's INI parser on Windows.
			expect( contents ).not.toMatch( /=\\?"[^"]*\\[^"]*"/ );
		} );
	} else {
		it( 'keeps `-n` + explicit `-d` on macOS/Linux where no php.ini ships', () => {
			const args = getDefaultPhpArgs( '8.4' );

			expect( args ).toContain( '-n' );
			expect( args ).toContain( 'memory_limit=512M' );
			expect( args ).not.toContain( '-c' );
		} );

		it( 'refuses to generate php.ini contents off Windows', () => {
			expect( () => getNativePhpIniContents( '8.4' ) ).toThrow();
		} );
	}
} );
