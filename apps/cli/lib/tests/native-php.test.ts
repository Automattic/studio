import { describe, expect, it } from 'vitest';
import { getDefaultPhpArgs, getNativePhpIniContents } from 'cli/lib/native-php';

describe( 'native PHP helpers', () => {
	it( 'passes `-c <php.ini path>` so the bundled binary is isolated from host installs', () => {
		const args = getDefaultPhpArgs( '8.4' );

		const cIndex = args.indexOf( '-c' );
		expect( cIndex ).toBeGreaterThanOrEqual( 0 );
		expect( args[ cIndex + 1 ].endsWith( 'php.ini' ) ).toBe( true );

		// `-n` would short-circuit `-c` and skip our php.ini entirely.
		expect( args ).not.toContain( '-n' );

		// Static config now lives in php.ini, not in argv.
		expect( args.every( ( arg ) => ! arg.startsWith( 'memory_limit=' ) ) ).toBe( true );
		expect( args.every( ( arg ) => ! arg.startsWith( 'opcache.cache_id=' ) ) ).toBe( true );
	} );

	it( 'always emits shared directives in php.ini regardless of platform', () => {
		const contents = getNativePhpIniContents( '8.4' );

		expect( contents ).toContain( 'memory_limit=512M' );
		expect( contents ).toContain( 'opcache.cache_id="studio-php8.4"' );
		expect( contents ).toContain( 'openssl.cafile="' );
		expect( contents ).toContain( 'curl.cainfo="' );
	} );

	if ( process.platform === 'win32' ) {
		it( 'loads bundled Windows DLLs from the ext/ directory', () => {
			const contents = getNativePhpIniContents( '8.4' );

			expect( contents ).toContain( 'extension_dir="' );
			expect( contents ).toContain( 'zend_extension=opcache' );
			expect( contents ).toContain( 'extension=pdo_sqlite' );
			expect( contents ).toContain( 'extension=sqlite3' );
			// Paths inside php.ini values use forward slashes — backslashes are
			// interpreted as escape characters by PHP's INI parser on Windows.
			expect( contents ).not.toMatch( /=\\?"[^"]*\\[^"]*"/ );
		} );
	} else {
		it( 'omits extension directives on macOS/Linux where extensions are statically linked', () => {
			const contents = getNativePhpIniContents( '8.4' );

			expect( contents ).not.toMatch( /^extension=/m );
			expect( contents ).not.toMatch( /^extension_dir=/m );
			expect( contents ).not.toMatch( /^zend_extension=/m );
		} );
	}
} );
