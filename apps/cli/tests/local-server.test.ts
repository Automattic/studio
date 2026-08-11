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
	measureSiteStorage: vi.fn(),
	readAiSettings: vi.fn(),
	saveAnthropicApiKey: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/cli-process', () => ( {
	createCliRunner: vi.fn( () => ( {
		executeCliCommand: mocks.execute,
		killAll: mocks.killAll,
	} ) ),
} ) );
vi.mock( '@studio/common/sites/list', () => ( { listSites: vi.fn() } ) );
vi.mock( '@studio/common/sites/storage-usage', () => ( {
	measureSiteStorage: mocks.measureSiteStorage,
} ) );
vi.mock( '@studio/common/ai/settings-store', () => ( {
	readAiSettings: mocks.readAiSettings,
	saveAnthropicApiKey: mocks.saveAnthropicApiKey,
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
		mocks.measureSiteStorage.mockResolvedValue( {
			total: 800,
			uploads: 400,
			plugins: 200,
			themes: 100,
			database: 50,
			other: 50,
		} );
		mocks.execute.mockImplementation( () => {
			const emitter = new EventEmitter();
			queueMicrotask( () => emitter.emit( 'success' ) );
			return [ emitter, {} ];
		} );
		mocks.readAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeySuffix: null,
		} );
		mocks.saveAnthropicApiKey.mockImplementation( async ( key: string | null ) => ( {
			provider: key === null ? 'wpcom' : 'anthropic-api-key',
			hasAnthropicApiKey: key !== null,
			anthropicApiKeySuffix: key === null ? null : key.slice( -4 ),
		} ) );
		server = await startLocalServer( {
			cliBinary: '/mock/cli.mjs',
			sessionsRoot: '/sessions',
			sitesRoot: '/sites',
			port: 0,
			host: '127.0.0.1',
		} );
	} );

	it( 'reports a local site storage breakdown', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/sites/local-a/storage`
		);

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toEqual( {
			total: 800,
			uploads: 400,
			plugins: 200,
			themes: 100,
			database: 50,
			other: 50,
		} );
		expect( mocks.measureSiteStorage ).toHaveBeenCalledWith( '/sites/local-a' );
	} );

	afterEach( async () => {
		await server.close();
		nock.disableNetConnect();
	} );

	it( 'reports the AI provider settings without the key itself', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings`
		);

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toEqual( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeySuffix: null,
		} );
	} );

	it( 'saves a trimmed Anthropic API key and switches the provider', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { anthropicApiKey: '  sk-ant-test-1234  ' } ),
			}
		);

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toEqual( {
			provider: 'anthropic-api-key',
			hasAnthropicApiKey: true,
			anthropicApiKeySuffix: '1234',
		} );
		expect( mocks.saveAnthropicApiKey ).toHaveBeenCalledWith( 'sk-ant-test-1234' );
	} );

	it( 'clears the Anthropic API key and falls back to WordPress.com', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { anthropicApiKey: null } ),
			}
		);

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toEqual( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeySuffix: null,
		} );
		expect( mocks.saveAnthropicApiKey ).toHaveBeenCalledWith( null );
	} );

	it( 'rejects an empty or non-string Anthropic API key', async () => {
		for ( const anthropicApiKey of [ '', '   ', 42 ] ) {
			const response = await fetch(
				`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify( { anthropicApiKey } ),
				}
			);
			expect( response.status ).toBe( 400 );
		}
		expect( mocks.saveAnthropicApiKey ).not.toHaveBeenCalled();
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
