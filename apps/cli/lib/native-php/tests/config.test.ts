import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultPhpArgs, getNativePhpIniContents } from 'cli/lib/native-php/config';

describe( 'getNativePhpIniContents', () => {
	const originalPlatform = process.platform;

	function setPlatform( platform: NodeJS.Platform ) {
		Object.defineProperty( process, 'platform', { value: platform } );
	}

	afterEach( () => {
		setPlatform( originalPlatform );
	} );

	it( 'disables the request time limit so the cli-server SAPI 30s default does not apply', () => {
		const contents = getNativePhpIniContents( '8.4' );

		expect( contents.split( /\r?\n/ ) ).toContain( 'max_execution_time=0' );
	} );

	it( 'leaves extension loading to the statically linked binary on macOS and Linux', () => {
		setPlatform( 'darwin' );

		const contents = getNativePhpIniContents( '8.4' );

		expect( contents ).not.toContain( 'extension=soap' );
	} );

	it( 'loads SOAP from the DLL that ships in the Windows package', () => {
		setPlatform( 'win32' );

		const contents = getNativePhpIniContents( '8.4' );

		expect( contents.split( /\r?\n/ ) ).toContain( 'extension=soap' );
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
