import { describe, expect, it } from 'vitest';
import { getDefaultPhpArgs, getNativePhpIniContents } from 'cli/lib/native-php/config';

describe( 'getNativePhpIniContents', () => {
	it( 'disables the request time limit so the cli-server SAPI 30s default does not apply', () => {
		const contents = getNativePhpIniContents( '8.4' );

		expect( contents.split( /\r?\n/ ) ).toContain( 'max_execution_time=0' );
	} );

	it( 'enables the packaged zstd extension on Windows', () => {
		const originalPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: 'win32', configurable: true } );

		try {
			const contents = getNativePhpIniContents( '8.4' );

			expect( contents.split( /\r?\n/ ) ).toContain( 'extension=zstd' );
		} finally {
			Object.defineProperty( process, 'platform', {
				value: originalPlatform,
				configurable: true,
			} );
		}
	} );
} );

describe( 'getDefaultPhpArgs', () => {
	it( 'omits Xdebug directives by default', () => {
		const args = getDefaultPhpArgs( '8.4' );

		expect( args.join( ' ' ) ).not.toContain( 'xdebug' );
	} );

	it( 'starts an Xdebug session on every request when enabled', () => {
		const args = getDefaultPhpArgs( '8.4', { enableXdebug: true } );

		expect( args ).toContain( 'xdebug.mode=debug' );
		expect( args ).toContain( 'xdebug.start_with_request=yes' );
	} );
} );
