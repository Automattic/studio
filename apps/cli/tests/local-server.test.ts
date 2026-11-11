/**
 * @vitest-environment node
 */
import crypto from 'node:crypto';
import EventEmitter from 'node:events';
import { InvalidAiProviderCredentialsError } from '@studio/agent/node/settings-store';
import { createCliRunner } from '@studio/common/lib/cli-process';
import { listSites } from '@studio/common/sites/list';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer } from '../../local/src/index';
import type { LocalServer } from '../../local/src/index';

const mocks = vi.hoisted( () => ( {
	execute: vi.fn(),
	killAll: vi.fn(),
	readSitePath: vi.fn(),
	readAiSettings: vi.fn(),
	saveAiProviderApiKey: vi.fn(),
	setAiProvider: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/cli-process', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/cli-process') >() ),
	killChild: vi.fn( ( child: { kill: () => void } ) => child.kill() ),
	createCliRunner: vi.fn( () => ( {
		executeCliCommand: mocks.execute,
		killAll: mocks.killAll,
	} ) ),
} ) );
vi.mock( '@studio/common/sites/list', () => ( { listSites: vi.fn() } ) );
vi.mock( '@studio/common/sites/site-path', () => ( { readSitePath: mocks.readSitePath } ) );
vi.mock( '@studio/agent/node/settings-store', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/agent/node/settings-store') >() ),
	readAiSettings: mocks.readAiSettings,
	saveAiProviderApiKey: mocks.saveAiProviderApiKey,
	setAiProvider: mocks.setAiProvider,
} ) );
vi.mock( '@studio/agent/node/run-manager', () => ( {
	createAgentRunManager: vi.fn( () => ( {
		startAgentRun: vi.fn(),
		listActiveAgentRuns: vi.fn( () => [] ),
		interruptAgentRun: vi.fn(),
		answerAgentRun: vi.fn(),
	} ) ),
} ) );
vi.mock( '@studio/common/sites/snapshots', () => ( {
	publishPreviewSite: vi.fn(),
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
		mocks.readSitePath.mockImplementation( async ( siteId: string ) =>
			siteId === 'local-a' ? '/sites/local-a' : null
		);
		mocks.execute.mockImplementation( () => {
			const emitter = new EventEmitter();
			queueMicrotask( () => emitter.emit( 'success' ) );
			return [ emitter, {} ];
		} );
		mocks.readAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			connections: {
				wpcom: { connected: false, apiKeyPreview: null },
				'anthropic-api-key': { connected: false, apiKeyPreview: null },
				'gemini-api-key': { connected: false, apiKeyPreview: null },
			},
		} );
		mocks.saveAiProviderApiKey.mockImplementation(
			async ( _provider: string, key: string | null ) => ( {
				provider: 'wpcom',
				connections: {
					wpcom: { connected: false, apiKeyPreview: null },
					'anthropic-api-key': {
						connected: key !== null,
						apiKeyPreview: key === null ? null : key.trim().slice( -4 ),
					},
					'gemini-api-key': { connected: false, apiKeyPreview: null },
				},
			} )
		);
		mocks.setAiProvider.mockImplementation( async ( provider: string ) => ( {
			provider,
			connections: {
				wpcom: { connected: false, apiKeyPreview: null },
				'anthropic-api-key': { connected: true, apiKeyPreview: '1234' },
				'gemini-api-key': { connected: false, apiKeyPreview: null },
			},
		} ) );
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

	it( 'reports the AI provider settings without the key itself', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings`
		);

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toEqual( {
			provider: 'wpcom',
			connections: {
				wpcom: { connected: false, apiKeyPreview: null },
				'anthropic-api-key': { connected: false, apiKeyPreview: null },
				'gemini-api-key': { connected: false, apiKeyPreview: null },
			},
		} );
	} );

	it( 'passes the Anthropic API key to the settings store untouched', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings/api-key`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { provider: 'anthropic-api-key', apiKey: '  sk-ant-test-1234  ' } ),
			}
		);

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toMatchObject( {
			connections: { 'anthropic-api-key': { connected: true, apiKeyPreview: '1234' } },
		} );
		expect( mocks.saveAiProviderApiKey ).toHaveBeenCalledWith(
			'anthropic-api-key',
			'  sk-ant-test-1234  '
		);
	} );

	it( 'clears the Anthropic API key', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings/api-key`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { provider: 'anthropic-api-key', apiKey: null } ),
			}
		);

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toMatchObject( {
			connections: { 'anthropic-api-key': { connected: false } },
		} );
		expect( mocks.saveAiProviderApiKey ).toHaveBeenCalledWith( 'anthropic-api-key', null );
	} );

	it( 'returns 400 with the message when Anthropic rejects a key being saved', async () => {
		mocks.saveAiProviderApiKey.mockRejectedValueOnce(
			new InvalidAiProviderCredentialsError(
				'Anthropic rejected this API key. Check the key and try again.'
			)
		);

		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings/api-key`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { provider: 'anthropic-api-key', apiKey: 'sk-ant-rejected' } ),
			}
		);

		expect( response.status ).toBe( 400 );
		await expect( response.json() ).resolves.toEqual( {
			error: 'Anthropic rejected this API key. Check the key and try again.',
		} );
	} );

	it( 'rejects a non-string Anthropic API key', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings/api-key`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { provider: 'anthropic-api-key', apiKey: 42 } ),
			}
		);

		expect( response.status ).toBe( 400 );
		expect( mocks.saveAiProviderApiKey ).not.toHaveBeenCalled();
	} );

	it.each( [ 'unknown-provider', null, 42 ] )(
		'rejects an invalid API key provider (%s) before calling the settings store',
		async ( provider ) => {
			const response = await fetch(
				`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings/api-key`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify( { provider, apiKey: 'sk-ant-test-1234' } ),
				}
			);

			expect( response.status ).toBe( 400 );
			await expect( response.json() ).resolves.toEqual( {
				error: 'provider must be a known AI provider id',
			} );
			expect( mocks.readAiSettings ).not.toHaveBeenCalled();
			expect( mocks.saveAiProviderApiKey ).not.toHaveBeenCalled();
		}
	);

	it( 'switches the AI provider', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings/provider`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { provider: 'anthropic-api-key' } ),
			}
		);

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toMatchObject( { provider: 'anthropic-api-key' } );
		expect( mocks.setAiProvider ).toHaveBeenCalledWith( 'anthropic-api-key' );
	} );

	it( 'returns 400 with the message when Anthropic rejects the saved key', async () => {
		mocks.setAiProvider.mockRejectedValueOnce(
			new InvalidAiProviderCredentialsError(
				'Anthropic rejected this API key. Check the key and try again.'
			)
		);

		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings/provider`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { provider: 'anthropic-api-key' } ),
			}
		);

		expect( response.status ).toBe( 400 );
		await expect( response.json() ).resolves.toEqual( {
			error: 'Anthropic rejected this API key. Check the key and try again.',
		} );
	} );

	it( 'rejects an unknown AI provider', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings/provider`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { provider: 'claude-code' } ),
			}
		);

		expect( response.status ).toBe( 400 );
		expect( mocks.setAiProvider ).not.toHaveBeenCalled();
	} );

	it( 'rejects pinning a session to an unknown AI provider', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/sessions/session-1/provider`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { provider: 'claude-code', model: 'claude-sonnet-5' } ),
			}
		);

		expect( response.status ).toBe( 400 );
		await expect( response.json() ).resolves.toEqual( {
			error: 'Unknown AI provider: claude-code',
		} );
	} );

	it( 'rejects pinning a session to a model its provider cannot serve', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/sessions/session-1/provider`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { provider: 'anthropic-api-key', model: 'balanced' } ),
			}
		);

		expect( response.status ).toBe( 400 );
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
		mocks.execute.mockImplementationOnce( () => {
			const emitter = new EventEmitter();
			queueMicrotask( () => {
				emitter.emit( 'data', {
					data: {
						action: 'result',
						value: {
							id: siteId,
							name: 'Remote site',
							path: '/sites/remote-site',
							port: 8882,
							url: 'http://localhost:8882',
							phpVersion: '8.4',
							running: false,
						},
					},
				} );
				emitter.emit( 'success' );
			} );
			return [ emitter, {} ];
		} );

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
			expect( mocks.execute.mock.calls.some( ( [ args ] ) => args.includes( '--no-start' ) ) ).toBe(
				true
			);
		} finally {
			randomUuid.mockRestore();
		}
	} );

	it( 'streams the sync activity the CLI publishes', async () => {
		const eventsCall = mocks.execute.mock.calls.findIndex(
			( [ args ] ) => args[ 0 ] === '_events'
		);
		const [ cliEvents ] = mocks.execute.mock.results[ eventsCall ].value;
		const baseUrl = server.url.replace( 'localhost', '127.0.0.1' );
		const eventsResponse = await fetch( `${ baseUrl }/api/events` );
		const reader = eventsResponse.body!.getReader();
		await reader.read();

		const event = { siteId: 'local-a', activity: { kind: 'pending', direction: 'pull' } };
		cliEvents.emit( 'data', {
			data: { action: 'keyValuePair', key: 'sync-event', value: JSON.stringify( event ) },
		} );
		const eventChunk = new TextDecoder().decode( ( await reader.read() ).value );
		await reader.cancel();

		expect( eventChunk ).toContain(
			JSON.stringify( { channel: 'sync-activity', payload: event } )
		);
	} );

	// A user cancel is reported as an outcome, not a 500 — the browser connector
	// turns it back into a cancelled error.
	it( 'reports a cancelled pull instead of failing the request', async () => {
		// The CLI never finishes on its own here, so the request only settles if the
		// cancel lands — which means we must not race it: wait until the pull has
		// actually started before asking for it to stop.
		let pullStarted: () => void = () => undefined;
		const started = new Promise< void >( ( resolve ) => {
			pullStarted = resolve;
		} );
		mocks.execute.mockImplementationOnce( () => {
			const emitter = new EventEmitter();
			queueMicrotask( pullStarted );
			// Exits when asked to stop, as a pull still safe to cancel does.
			const kill = () => emitter.emit( 'failure', { error: new Error( 'exited' ) } );
			return [ emitter, { kill } ];
		} );
		const baseUrl = server.url.replace( 'localhost', '127.0.0.1' );

		const pulling = fetch( `${ baseUrl }/api/sites/local-a/pull`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { remoteSiteId: 42 } ),
		} );
		await started;
		const cancelled = await fetch( `${ baseUrl }/api/sites/local-a/sync/cancel`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { remoteSiteId: 42 } ),
		} );

		expect( cancelled.status ).toBe( 204 );
		const response = await pulling;
		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toEqual( { cancelled: true } );
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
