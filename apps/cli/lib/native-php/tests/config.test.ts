import fs from 'node:fs';
import path from 'node:path';
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
	function getFileCacheDirectory( args: string[] ): string {
		const directive = args.find( ( arg ) => arg.startsWith( 'opcache.file_cache=' ) );
		return directive?.match( /^opcache\.file_cache="(.*)"$/ )?.[ 1 ] ?? '';
	}

	it( 'gives each server worker its own opcache file cache directory', () => {
		const first = getFileCacheDirectory( getDefaultPhpArgs( '8.4', { workerIndex: 0 } ) );
		const second = getFileCacheDirectory( getDefaultPhpArgs( '8.4', { workerIndex: 1 } ) );

		expect( first ).not.toBe( second );
		expect( path.basename( first ) ).toBe( 'worker-0' );
		expect( fs.existsSync( first ) ).toBe( true );
		expect( fs.existsSync( second ) ).toBe( true );
	} );

	it( 'partitions the opcache file cache by PHP version', () => {
		const cacheDirectory = getFileCacheDirectory( getDefaultPhpArgs( '8.4' ) );

		expect( path.basename( cacheDirectory ) ).toBe( 'php8.4' );
	} );

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
