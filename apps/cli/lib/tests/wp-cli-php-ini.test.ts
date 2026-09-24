import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setPhpIniEntries } from '@php-wasm/universal';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildWpCliPhpArgv,
	getWpCliPhpIniArgs,
	WP_CLI_PHP_INI_ENTRIES,
} from 'cli/lib/wp-cli-php-ini';
import type { SiteData } from 'cli/lib/cli-config/core';

const spawnMock = vi.fn();

vi.mock( 'node:child_process', () => {
	const mockedModule = { spawn: spawnMock, spawnSync: vi.fn() };
	return { ...mockedModule, default: mockedModule };
} );

vi.mock( '@php-wasm/universal', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@php-wasm/universal') >();
	return {
		...actual,
		setPhpIniEntries: vi.fn().mockResolvedValue( undefined ),
		PHP: class {
			setSapiName = vi.fn().mockResolvedValue( undefined );
			defineConstant = vi.fn();
			mkdir = vi.fn();
			chdir = vi.fn();
			writeFile = vi.fn();
			mount = vi.fn().mockResolvedValue( undefined );
			exit = vi.fn();
			// Stops the launcher right after the ini entries are applied, so the test
			// never has to stand up a real WordPress mount to observe them.
			setSpawnHandler = vi.fn().mockRejectedValue( new Error( 'stop after ini' ) );
		},
	};
} );

vi.mock( '@php-wasm/node', () => ( {
	loadNodeRuntime: vi.fn().mockResolvedValue( 1 ),
	createNodeFsMountHandler: vi.fn(),
} ) );

vi.mock( 'cli/lib/dependency-management/paths', () => ( {
	getPhpBinaryPath: () => '/fake/php',
	getWpCliPharPath: () => '/fake/wp-cli.phar',
	getSqliteCommandPath: () => '/fake/sqlite-command',
} ) );

vi.mock( 'cli/lib/dependency-management/php-binary', () => ( {
	ensurePhpBinaryAvailable: vi.fn().mockResolvedValue( undefined ),
} ) );

vi.mock( 'cli/lib/native-php/config', () => ( {
	getDefaultPhpArgs: () => [ '-c', '/fake/php.ini' ],
} ) );

vi.mock( 'cli/lib/native-php/php-process', () => ( {
	DETACH_FOR_GROUP_KILL: false,
	killPhpProcessTree: vi.fn(),
	reapPhpTreeOnInterrupt: () => () => {},
} ) );

vi.mock( 'cli/lib/pull/runtime-start-options', () => ( {
	loadImportedRuntimeStartOptionsNative: () => undefined,
} ) );

vi.mock( '@studio/common/lib/mu-plugins', () => ( {
	writeStudioMuPluginsForNativePhpRuntime: vi.fn().mockResolvedValue( undefined ),
	cleanupLegacyMuPlugins: vi.fn().mockResolvedValue( undefined ),
	getMuPlugins: vi.fn().mockResolvedValue( [ '/fake/mu', '/fake/loader.php' ] ),
} ) );

const site: SiteData = {
	id: 'site-1',
	name: 'Site',
	path: '/fake/site',
	port: 8881,
	runtime: 'native-php',
	fileAccess: 'site-directory',
	phpVersion: '8.5',
};

function fakeChild() {
	const child = new EventEmitter() as EventEmitter & Record< string, unknown >;
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.exitCode = null;
	child.signalCode = null;
	child.killed = false;
	queueMicrotask( () => child.emit( 'spawn' ) );
	return child;
}

beforeEach( () => {
	vi.clearAllMocks();
	spawnMock.mockImplementation( () => fakeChild() );
} );

describe( 'WP-CLI PHP ini policy', () => {
	it( 'pins the policy values', () => {
		// Literals on purpose: deriving them from the module under test would make
		// this assertion pass for any value.
		expect( WP_CLI_PHP_INI_ENTRIES ).toEqual( {
			error_reporting: '32767',
			display_errors: 'stderr',
			log_errors: 0,
		} );
	} );

	it( 'reports deprecations rather than suppressing them', () => {
		const E_DEPRECATED = 8192;
		const E_USER_DEPRECATED = 16384;
		const level = Number( WP_CLI_PHP_INI_ENTRIES.error_reporting );

		// #4686 asks for diagnostics on stderr, not for diagnostics to disappear.
		expect( level & E_DEPRECATED ).toBe( E_DEPRECATED );
		expect( level & E_USER_DEPRECATED ).toBe( E_USER_DEPRECATED );
	} );

	it( 'formats the policy as PHP CLI -d arguments', () => {
		expect( getWpCliPhpIniArgs() ).toEqual( [
			'-d',
			'error_reporting=32767',
			'-d',
			'display_errors=stderr',
			'-d',
			'log_errors=0',
		] );
	} );
} );

describe( 'WP-CLI launchers apply the PHP ini policy', () => {
	it( 'passes the -d arguments to the native PHP binary', async () => {
		const { runWpCliCommand } = await import( 'cli/lib/run-wp-cli-command' );

		using command = await runWpCliCommand( site, [ 'plugin', 'list' ] );
		void command;

		expect( spawnMock ).toHaveBeenCalledOnce();
		const [ , argv ] = spawnMock.mock.calls[ 0 ];
		expect( argv ).toEqual(
			expect.arrayContaining( [
				'-d',
				'error_reporting=32767',
				'-d',
				'display_errors=stderr',
				'-d',
				'log_errors=0',
			] )
		);
		// The phar must come after the -d flags, or PHP treats them as script arguments.
		expect( argv.indexOf( '/fake/wp-cli.phar' ) ).toBeGreaterThan(
			argv.lastIndexOf( 'display_errors=stderr' )
		);
	} );

	it( 'sets the policy on a fresh Playground instance', async () => {
		const { runWpCliCommand } = await import( 'cli/lib/run-wp-cli-command' );

		await expect(
			runWpCliCommand( { ...site, runtime: 'playground' }, [ 'plugin', 'list' ] )
		).rejects.toThrow();

		expect( setPhpIniEntries ).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining( {
				error_reporting: '32767',
				display_errors: 'stderr',
				log_errors: 0,
			} )
		);
	} );

	// The running Playground server reaches WP-CLI through `server.playground.cli()`
	// (playground-server-child.ts). That module rewires `console` and `process.stdout` at
	// import time, so it cannot be imported here; `buildWpCliPhpArgv` is the argv it passes.
	it( 'passes the -d arguments to the running Playground server', () => {
		expect( buildWpCliPhpArgv( '/tmp/wp-cli.phar', '/wordpress', [ 'plugin', 'list' ] ) ).toEqual( [
			'php',
			'-d',
			'error_reporting=32767',
			'-d',
			'display_errors=stderr',
			'-d',
			'log_errors=0',
			'/tmp/wp-cli.phar',
			'--path=/wordpress',
			'plugin',
			'list',
		] );
	} );
} );
