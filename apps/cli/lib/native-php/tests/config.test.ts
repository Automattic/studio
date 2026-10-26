import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
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

it.skipIf( process.platform === 'win32' ).each( [ 'SIGTERM', 'SIGINT' ] as const )(
	'removes opcache on %s without changing signal handling',
	async ( signal ) => {
		const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'opcache-signal-test-' ) );
		try {
			await build( {
				configFile: false,
				logLevel: 'silent',
				ssr: { noExternal: true },
				build: {
					ssr: true,
					rollupOptions: { output: { entryFileNames: 'config.mjs' } },
					outDir: dir,
					lib: {
						entry: path.resolve( 'apps/cli/lib/native-php/config.ts' ),
						formats: [ 'es' ],
						fileName: () => 'config.mjs',
					},
				},
			} );
			for ( const handled of [ false, true ] ) {
				const child = spawn(
					process.execPath,
					[
						'--input-type=module',
						'-e',
						`
					import { getDefaultPhpArgs } from ${ JSON.stringify( path.join( dir, 'config.mjs' ) ) };
					${ handled ? `process.on('${ signal }', () => process.exit(42));` : '' }
					const args = getDefaultPhpArgs('8.4');
					console.log(args.find(arg => arg.startsWith('opcache.file_cache=')));
					setInterval(() => {}, 1000);
				`,
					],
					{ stdio: [ 'ignore', 'pipe', 'inherit' ] }
				);
				try {
					const [ output ] = await once( child.stdout, 'data' );
					const cache = path.dirname( output.toString().match( /="(.*)"/ )[ 1 ] );
					expect( fs.existsSync( cache ) ).toBe( true );
					const exited = once( child, 'exit' );
					child.kill( signal );
					expect( await exited ).toEqual( handled ? [ 42, null ] : [ null, signal ] );
					expect( fs.existsSync( cache ) ).toBe( false );
				} finally {
					child.kill( 'SIGKILL' );
				}
			}
		} finally {
			fs.rmSync( dir, { recursive: true, force: true } );
		}
	}
);

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
