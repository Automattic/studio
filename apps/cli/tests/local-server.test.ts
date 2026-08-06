/**
 * @vitest-environment node
 */
import crypto from 'node:crypto';
import EventEmitter from 'node:events';
import { createCliRunner } from '@studio/common/lib/cli-process';
import { listSites } from '@studio/common/sites/list';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer } from '../../local/src/index';
import type { LocalServer } from '../../local/src/index';

const mocks = vi.hoisted( () => ( {
	execute: vi.fn(),
	killAll: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/cli-process', () => ( {
	createCliRunner: vi.fn( () => ( {
		executeCliCommand: mocks.execute,
		killAll: mocks.killAll,
	} ) ),
} ) );
vi.mock( '@studio/common/sites/list', () => ( { listSites: vi.fn() } ) );
// Only the desktop's persisted copy is stubbed out (it reads the real
// `~/.studio/app.json`); resolving theme details through the CLI runs for real.
vi.mock( '@studio/common/sites/theme-details', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	readPersistedThemeDetails: vi.fn( async () => ( {} ) ),
} ) );
vi.mock( '@studio/common/ai/run-manager', () => ( {
	createAgentRunManager: vi.fn( () => ( {
		startAgentRun: vi.fn(),
		listActiveAgentRuns: vi.fn( () => [] ),
		interruptAgentRun: vi.fn(),
		answerAgentRun: vi.fn(),
	} ) ),
} ) );
vi.mock( '@studio/common/sites/snapshots', () => ( {
	createSnapshotManager: vi.fn( () => ( {
		createSnapshot: vi.fn(),
		updateSnapshot: vi.fn(),
		deleteSnapshot: vi.fn(),
	} ) ),
	fetchSnapshots: vi.fn( async () => [] ),
} ) );

describe( 'local web server Connect contracts', () => {
	let server: LocalServer;

	beforeEach( async () => {
		vi.clearAllMocks();
		nock.enableNetConnect( /^(localhost|127\.0\.0\.1)/ );
		vi.mocked( createCliRunner ).mockReturnValue( {
			executeCliCommand: mocks.execute,
			killAll: mocks.killAll,
		} as never );
		vi.mocked( listSites ).mockResolvedValue( [
			{
				id: 'local-a',
				name: 'Local A',
				path: '/sites/local-a',
				port: 8881,
				url: 'http://localhost:8881',
				phpVersion: '8.4',
				running: false,
			},
		] );
		mocks.execute.mockImplementation( () => {
			const emitter = new EventEmitter();
			queueMicrotask( () => emitter.emit( 'success' ) );
			return [ emitter, {} ];
		} );
		server = await startLocalServer( {
			cliBinary: '/mock/cli.mjs',
			sessionsRoot: '/sessions',
			sitesRoot: '/sites',
			port: 0,
			host: '127.0.0.1',
		} );
	} );

	afterEach( async () => {
		await server.close();
		nock.disableNetConnect();
	} );

	it( 'resolves theme details through the CLI and reuses them for the site list', async () => {
		const themeDetails = {
			name: 'Twenty Twenty-Six',
			path: '/wp-content/themes/twentytwentysix',
			slug: 'twentytwentysix',
			isBlockTheme: true,
			supportsWidgets: false,
			supportsMenus: false,
		};
		mocks.execute.mockImplementationOnce( () => {
			const emitter = new EventEmitter();
			queueMicrotask( () =>
				emitter.emit( 'success', {
					result: { stdout: JSON.stringify( themeDetails ), stderr: '' },
				} )
			);
			return [ emitter, { kill: vi.fn() } ];
		} );
		const origin = server.url.replace( 'localhost', '127.0.0.1' );

		const response = await fetch( `${ origin }/api/sites/local-a/theme-details` );

		expect( response.status ).toBe( 200 );
		expect( await response.json() ).toEqual( { themeDetails } );
		expect( mocks.execute ).toHaveBeenCalledWith(
			[ 'wp', '--path', '/sites/local-a', 'studio', 'get-theme-details' ],
			{ output: 'capture' }
		);

		mocks.execute.mockClear();
		const sites = await ( await fetch( `${ origin }/api/sites` ) ).json();
		expect( sites[ 0 ].themeDetails ).toEqual( themeDetails );
		expect( mocks.execute ).not.toHaveBeenCalled();
	} );

	it( 'reports unknown theme details rather than failing the request', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/sites/local-a/theme-details`
		);

		expect( response.status ).toBe( 200 );
		expect( await response.json() ).toEqual( { themeDetails: null } );
	} );

	it( 'delegates deletion to the CLI cascade', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/sites/local-a`,
			{ method: 'DELETE' }
		);

		expect( response.status ).toBe( 204 );
		expect( mocks.execute ).toHaveBeenCalledWith(
			[ 'site', 'delete', '--path', '/sites/local-a', '--files' ],
			{ output: 'capture' }
		);
	} );

	it( 'reports when the CLI cannot delete the local site', async () => {
		mocks.execute.mockImplementationOnce( () => {
			const emitter = new EventEmitter();
			queueMicrotask( () => emitter.emit( 'failure', { error: new Error( 'delete failed' ) } ) );
			return [ emitter, {} ];
		} );

		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/sites/local-a`,
			{ method: 'DELETE' }
		);

		expect( response.status ).toBe( 500 );
	} );

	it( 'creates the Connect shell with --no-start', async () => {
		const siteId = '00000000-0000-4000-8000-000000000001';
		const randomUuid = vi.spyOn( crypto, 'randomUUID' ).mockReturnValue( siteId as never );
		vi.mocked( listSites ).mockResolvedValueOnce( [
			{
				id: siteId,
				name: 'Remote site',
				path: '/sites/remote-site',
				port: 8882,
				url: 'http://localhost:8882',
				phpVersion: '8.4',
				running: false,
			},
		] );

		try {
			const response = await fetch(
				`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/sites`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify( {
						name: 'Remote site',
						path: '/sites/remote-site',
						skipStart: true,
					} ),
				}
			);

			expect( response.status ).toBe( 200 );
			expect( mocks.execute.mock.calls[ 0 ][ 0 ] ).toContain( '--no-start' );
		} finally {
			randomUuid.mockRestore();
		}
	} );

	it( 'streams CLI pull progress over the local event channel', async () => {
		mocks.execute.mockImplementationOnce( () => {
			const emitter = new EventEmitter();
			queueMicrotask( () => {
				emitter.emit( 'data', {
					data: {
						status: 'inprogress',
						message: 'Creating remote backup… (18%)',
					},
				} );
				emitter.emit( 'success' );
			} );
			return [ emitter, {} ];
		} );
		const baseUrl = server.url.replace( 'localhost', '127.0.0.1' );
		const eventsResponse = await fetch( `${ baseUrl }/api/events` );
		const reader = eventsResponse.body!.getReader();
		await reader.read();

		const response = await fetch( `${ baseUrl }/api/sites/local-a/pull`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { remoteSiteId: 42 } ),
		} );
		const eventChunk = new TextDecoder().decode( ( await reader.read() ).value );
		await reader.cancel();

		expect( response.status ).toBe( 204 );
		expect( eventChunk ).toContain( '"channel":"sync-pull"' );
		expect( eventChunk ).toContain( '"siteId":"local-a"' );
		expect( eventChunk ).toContain( 'Creating remote backup… (18%)' );
	} );

	it( 'returns a signup URL that comes back through the local callback', async () => {
		const redirectUri = 'http://localhost:8081/auth/callback';
		const response = await fetch(
			`${ server.url.replace(
				'localhost',
				'127.0.0.1'
			) }/api/auth/login-url?signup=1&redirect_uri=${ encodeURIComponent( redirectUri ) }`
		);
		const { url } = ( await response.json() ) as { url: string };
		const signupUrl = new URL( url );
		const oauthUrl = new URL( signupUrl.searchParams.get( 'oauth2_redirect' ) ?? '' );

		expect( signupUrl.pathname ).toBe( '/start/wpcc/oauth2-user' );
		expect( oauthUrl.searchParams.get( 'redirect_uri' ) ).toBe( redirectUri );
	} );
} );
