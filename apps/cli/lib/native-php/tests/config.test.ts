import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultPhpArgs, getNativePhpIniContents } from 'cli/lib/native-php/config';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';

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

	it( 'only caches server workers, partitioned stably by site, PHP version and worker', () => {
		const dataDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-config-test-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', dataDir );
		try {
			const cases: [ string | undefined, SupportedPHPVersion, number | undefined ][] = [
				[ undefined, '8.4', undefined ],
				[ 'site-a', '8.4', undefined ],
				[ 'site-a', '8.4', 0 ],
				[ 'site-a', '8.4', 0 ],
				[ 'site-a', '8.4', 1 ],
				[ 'site-a', '8.3', 0 ],
				[ 'site-b', '8.4', 0 ],
			];
			for ( const [ siteId, phpVersion, workerIndex ] of cases ) {
				const args = getDefaultPhpArgs( phpVersion, { siteId, workerIndex } );
				const cacheDirectory = getFileCacheDirectory( args );
				if ( workerIndex === undefined ) {
					expect( args.some( ( arg ) => arg.startsWith( 'opcache.file_cache=' ) ) ).toBe( false );
					expect( fs.readdirSync( dataDir ) ).toEqual( [] );
				} else {
					expect( cacheDirectory ).toBe(
						path.join(
							dataDir,
							'opcache',
							siteId!,
							`php${ phpVersion }`,
							`worker-${ workerIndex }`
						)
					);
					expect( fs.statSync( cacheDirectory ).isDirectory() ).toBe( true );
				}
			}
		} finally {
			vi.unstubAllEnvs();
			fs.rmSync( dataDir, { recursive: true, force: true } );
		}
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
