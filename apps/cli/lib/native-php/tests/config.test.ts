import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultPhpArgs, getNativePhpIniContents } from 'cli/lib/native-php/config';

const ASCII_PHP_BINARY_PATH = '/Users/studio/.studio/php-bin/8.4/php';
const spawnSyncMock = vi.hoisted( () => vi.fn() );
const phpBinary = vi.hoisted( () => ( { path: '' } ) );

vi.mock( 'node:child_process', () => {
	const mockedModule = { spawnSync: spawnSyncMock };
	return { ...mockedModule, default: mockedModule };
} );

vi.mock( 'cli/lib/dependency-management/paths', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/dependency-management/paths') >() ),
	getPhpBinaryPath: () => phpBinary.path,
} ) );

const originalPlatform = process.platform;

function setPlatform( platform: NodeJS.Platform ) {
	Object.defineProperty( process, 'platform', { value: platform } );
}

beforeEach( () => {
	phpBinary.path = ASCII_PHP_BINARY_PATH;
} );

afterEach( () => {
	setPlatform( originalPlatform );
	vi.resetAllMocks();
} );

describe( 'getNativePhpIniContents', () => {
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

	it( 'points php.ini and extension_dir at the short name of a non-ASCII Windows path', () => {
		setPlatform( 'win32' );
		phpBinary.path = '/Users/José/.studio/php-bin/8.4/php';
		spawnSyncMock.mockReturnValue( { stdout: '/Users/JOS~1/.studio/php-bin/8.4\r\n' } );

		const contents = getNativePhpIniContents( '8.4' );
		const args = getDefaultPhpArgs( '8.4' );

		expect( contents.split( /\r?\n/ ) ).toContain(
			'extension_dir="/Users/JOS~1/.studio/php-bin/8.4/ext"'
		);
		expect( args.slice( 0, 2 ) ).toEqual( [
			'-c',
			path.join( '/Users/JOS~1/.studio/php-bin/8.4', 'php.ini' ),
		] );
	} );

	it( 'keeps an ASCII Windows extension_dir as is', () => {
		setPlatform( 'win32' );

		const contents = getNativePhpIniContents( '8.4' );

		expect( contents ).toContain( 'extension_dir="/Users/studio/.studio/php-bin/8.4/ext"' );
		expect( spawnSyncMock ).not.toHaveBeenCalled();
	} );
} );

describe( 'getDefaultPhpArgs', () => {
	function getOpcacheDirectives( args: string[] ): string[] {
		return args.filter( ( arg ) => arg.startsWith( 'opcache.' ) );
	}

	it.each( [ 'darwin', 'linux', 'win32' ] as const )(
		'writes no opcache file cache on %s',
		( platform ) => {
			setPlatform( platform );
			const args = [ getDefaultPhpArgs( '8.4', { workerIndex: 0 } ), getDefaultPhpArgs( '8.4' ) ];

			expect( args.flat().join( ' ' ) ).not.toContain( 'opcache.file_cache' );
		}
	);

	it( 'gives every Windows server worker spawn its own opcache segment', () => {
		setPlatform( 'win32' );
		const ids = [ 0, 1, 0 ].map( ( workerIndex ) =>
			getOpcacheDirectives( getDefaultPhpArgs( '8.4', { workerIndex } ) )
		);

		expect( ids.flat() ).toHaveLength( 3 );
		expect( new Set( ids.flat() ).size ).toBe( 3 );
		expect( getOpcacheDirectives( getDefaultPhpArgs( '8.4' ) ) ).toEqual( [] );
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
