/**
 * @vitest-environment node
 */
import crypto from 'node:crypto';
import EventEmitter from 'node:events';
import { createCliRunner } from '@studio/common/lib/cli-process';
import { listSites } from '@studio/common/sites/list';
import { InvalidCredentialError } from '@studio/providers';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer } from '../../local/src/index';
import type { LocalServer } from '../../local/src/index';

const mocks = vi.hoisted( () => ( {
	execute: vi.fn(),
	killAll: vi.fn(),
	readSitePath: vi.fn(),
	readAiSettings: vi.fn(),
	connectProvider: vi.fn(),
	disconnectProvider: vi.fn(),
	setAiProvider: vi.fn(),
} ) );

const settings = ( provider: string, anthropicSummary: string | null ) => ( {
	provider,
	accounts: {
		wpcom: { connected: false, summary: null },
		anthropic: { connected: anthropicSummary !== null, summary: anthropicSummary },
	},
} );

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
vi.mock( '@studio/common/lib/ai-settings', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/ai-settings') >() ),
	readAiSettings: mocks.readAiSettings,
	connectProvider: mocks.connectProvider,
	disconnectProvider: mocks.disconnectProvider,
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
		mocks.readAiSettings.mockResolvedValue( settings( 'wpcom', null ) );
		mocks.connectProvider.mockResolvedValue( settings( 'wpcom', '1234' ) );
		mocks.disconnectProvider.mockResolvedValue( settings( 'wpcom', null ) );
		mocks.setAiProvider.mockImplementation( async ( provider: string ) =>
			settings( provider, '1234' )
		);
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

	const settingsUrl = ( path: string ) =>
		`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings${ path }`;
	const putInput = ( input: unknown ) =>
		fetch( settingsUrl( '/providers/anthropic' ), {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { input } ),
		} );

	it( 'reports the AI provider settings without the key itself', async () => {
		const response = await fetch( settingsUrl( '' ) );

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toEqual( settings( 'wpcom', null ) );
	} );

	it( 'passes the form values to the provider untouched', async () => {
		const response = await putInput( { apiKey: '  sk-ant-test-1234  ' } );

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toMatchObject( {
			accounts: { anthropic: { connected: true, summary: '1234' } },
		} );
		expect( mocks.connectProvider ).toHaveBeenCalledWith(
			expect.objectContaining( { descriptor: expect.objectContaining( { id: 'anthropic' } ) } ),
			{ apiKey: '  sk-ant-test-1234  ' },
			{ openUrl: expect.any( Function ) }
		);
	} );

	it( 'disconnects a provider', async () => {
		const response = await fetch( settingsUrl( '/providers/anthropic' ), { method: 'DELETE' } );

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toMatchObject( {
			accounts: { anthropic: { connected: false } },
		} );
		expect( mocks.disconnectProvider ).toHaveBeenCalledOnce();
	} );

	it( 'returns 400 with the message when the provider rejects the values', async () => {
		mocks.connectProvider.mockRejectedValueOnce(
			new InvalidCredentialError( 'Anthropic rejected this API key. Check the key and try again.' )
		);

		const response = await putInput( { apiKey: 'sk-ant-rejected' } );

		expect( response.status ).toBe( 400 );
		await expect( response.json() ).resolves.toEqual( {
			error: 'Anthropic rejected this API key. Check the key and try again.',
		} );
	} );

	it( 'rejects values that are not strings, and unknown providers', async () => {
		expect( ( await putInput( { apiKey: 42 } ) ).status ).toBe( 400 );
		expect(
			(
				await fetch( settingsUrl( '/providers/claude-code' ), {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify( { input: {} } ),
				} )
			).status
		).toBe( 400 );
		expect( mocks.connectProvider ).not.toHaveBeenCalled();
	} );

	it( 'switches the AI provider', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings/provider`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { provider: 'anthropic' } ),
			}
		);

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toMatchObject( { provider: 'anthropic' } );
		expect( mocks.setAiProvider ).toHaveBeenCalledWith( 'anthropic' );
	} );

	it( 'returns 400 with the message when the provider is not connected', async () => {
		mocks.setAiProvider.mockRejectedValueOnce(
			new InvalidCredentialError( 'Connect Anthropic API first.' )
		);

		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings/provider`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { provider: 'anthropic' } ),
			}
		);

		expect( response.status ).toBe( 400 );
		await expect( response.json() ).resolves.toEqual( {
			error: 'Connect Anthropic API first.',
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
				body: JSON.stringify( { provider: 'claude-code', model: 'claude-sonnet-5-5' } ),
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
				body: JSON.stringify( { provider: 'anthropic', model: 'balanced' } ),
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

		const pulling = fetch( `${ baseUrl }/api/sites/local-a/remote-sites/wpcom/42/pull`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( {} ),
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
