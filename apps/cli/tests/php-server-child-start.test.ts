import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { requestSetAdminCredentials } from 'cli/lib/admin-credentials';
import { runBlueprint } from 'cli/lib/native-php/blueprints';
import { runPhpCommand } from 'cli/lib/native-php/php-process';
import { getSiteDatabasePath } from 'cli/lib/sqlite-collations';
import { childMessageFromProcessManagerSchema } from 'cli/lib/types/wordpress-server-ipc';

vi.mock( 'cli/lib/native-php/php-process', () => ( {
	runPhpCommand: vi.fn( async () => ( { stdout: '0' } ) ),
	spawnPhpProcess: vi.fn( () => new EventEmitter() ),
	waitForChildSpawn: vi.fn(),
	killAllLivePhpProcesses: vi.fn(),
	stopPhpChild: vi.fn(),
} ) );
vi.mock( 'cli/lib/native-php/site-setup', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/native-php/site-setup') >() ),
	ensureWpConfig: vi.fn(),
	writeSiteUrlPrependFile: vi.fn( () => '/tmp/prepend.php' ),
} ) );
vi.mock( '@studio/common/lib/mu-plugins', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/mu-plugins') >() ),
	writeStudioMuPlugins: vi.fn(),
} ) );
vi.mock( 'cli/lib/native-php/phpmyadmin', () => ( {
	writeNativePhpMyAdminWpEnv: vi.fn(),
	getPhpMyAdminSessionPath: vi.fn( () => '/tmp/session' ),
} ) );
vi.mock( 'cli/lib/native-php/worker-ports', () => ( {
	getAvailablePorts: vi.fn( async () => [ 9001, 9002, 9003, 9004 ] ),
} ) );
vi.mock( 'cli/lib/native-php/blueprints', () => ( { runBlueprint: vi.fn() } ) );
vi.mock( 'cli/lib/admin-credentials', () => ( { requestSetAdminCredentials: vi.fn() } ) );
vi.mock( '@studio/common/sites/site-email', () => ( {
	getSiteEmailDirectory: () => os.tmpdir(),
} ) );

afterEach( () => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
} );

it.each( [
	{ database: true, redirect: undefined, check: false, install: false },
	{ database: true, redirect: '/wp-admin/install.php?step=1', check: false, install: true },
	{
		database: true,
		redirect: 'http://localhost/wp-admin/install.php',
		check: false,
		install: true,
	},
	{ database: true, redirect: '/wp-login.php', check: false, install: false },
	{ database: false, redirect: undefined, check: true, install: true },
	{ database: true, blueprint: true, redirect: undefined, check: true, install: true },
	{
		database: true,
		imported: true,
		redirect: '/wp-admin/install.php',
		check: false,
		install: false,
	},
] )(
	'starts with $database database, $redirect redirect, blueprint=$blueprint, imported=$imported',
	async ( scenario ) => {
		vi.resetModules();
		const sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-start-test-' ) );
		let handleMessage: ( message: object ) => Promise< void >;
		const events = [ 'message', 'disconnect', 'SIGTERM', 'SIGINT', 'exit' ] as const;
		const emitter: EventEmitter = process;
		const listeners = new Map( events.map( ( event ) => [ event, emitter.listeners( event ) ] ) );
		const originalSend = process.send;
		process.send = vi.fn();
		let probes = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => {
				// Only one worker needs to observe the installer redirect.
				const redirect = probes++ === 2 ? scenario.redirect : undefined;
				return new Response( null, {
					status: redirect ? 302 : 200,
					headers: redirect ? { location: redirect } : {},
				} );
			} )
		);
		try {
			if ( scenario.database ) {
				const databasePath = getSiteDatabasePath( sitePath );
				fs.mkdirSync( path.dirname( databasePath ), { recursive: true } );
				fs.writeFileSync( databasePath, '' );
			}
			await import( 'cli/php-server-child' );
			handleMessage = emitter.listeners( 'message' ).at( -1 ) as typeof handleMessage;
			await handleMessage( {
				messageId: 'test-start',
				topic: 'start-server',
				data: {
					config: {
						siteId: 'test',
						sitePath,
						port: 0,
						fileAccess: 'all-files',
						...( scenario.blueprint ? { blueprint: { contents: {}, uri: 'test' } } : {} ),
						...( scenario.imported ? { autoPrependFile: '/tmp/imported.php' } : {} ),
					},
				},
			} );
			const phases = vi
				.mocked( process.send! )
				.mock.calls.map( ( [ message ] ) => message )
				.map( ( message ) =>
					childMessageFromProcessManagerSchema.safeParse( {
						process: { name: 'test', pm_id: 1 },
						raw: message,
					} )
				)
				.flatMap( ( result ) =>
					result.success && result.data.raw.topic === 'start-phase' ? [ result.data.raw.data ] : []
				);
			const firstWorker = phases.filter( ( { phase } ) => phase === 'php_first_worker' );
			const allWorkers = phases.find( ( { phase } ) => phase === 'php_workers' );
			expect( firstWorker ).toHaveLength( 1 );
			expect( firstWorker[ 0 ].ms ).toBeLessThanOrEqual( allWorkers!.ms );
			const commands = vi.mocked( runPhpCommand ).mock.calls.map( ( [ args ] ) => args );
			expect(
				commands.some(
					( args ) => args[ 0 ] === '-r' && String( args[ 1 ] ).includes( 'is_blog_installed' )
				)
			).toBe( scenario.check );
			expect( commands.some( ( args ) => args[ 1 ] === 'core' && args[ 2 ] === 'install' ) ).toBe(
				scenario.install
			);
			expect( runBlueprint ).toHaveBeenCalledTimes( scenario.blueprint ? 1 : 0 );
			expect( requestSetAdminCredentials ).toHaveBeenCalledTimes(
				scenario.install && ! scenario.blueprint ? 0 : 1
			);
		} finally {
			process.send = originalSend;
			for ( const event of events ) {
				for ( const listener of emitter.listeners( event ) ) {
					if ( ! listeners.get( event )?.includes( listener ) ) {
						if ( event === 'exit' && listener.name === 'killPhpProcess' ) {
							listener();
						}
						emitter.removeListener( event, listener as ( ...args: unknown[] ) => void );
					}
				}
			}
			fs.rmSync( sitePath, { recursive: true, force: true } );
		}
	}
);
