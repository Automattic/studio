/**
 * @vitest-environment node
 */
import crypto from 'node:crypto';
import EventEmitter from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InvalidAnthropicApiKeyError } from '@studio/common/ai/settings-store';
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
	readSitePath: vi.fn(),
	readAiSettings: vi.fn(),
	saveAnthropicApiKey: vi.fn(),
	setAiProvider: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/cli-process', () => ( {
	killChild: vi.fn(),
	createCliRunner: vi.fn( () => ( {
		executeCliCommand: mocks.execute,
		killAll: mocks.killAll,
	} ) ),
} ) );
vi.mock( '@studio/common/sites/list', () => ( { listSites: vi.fn() } ) );
vi.mock( '@studio/common/sites/storage-usage', () => ( {
	measureSiteStorage: mocks.measureSiteStorage,
} ) );
vi.mock( '@studio/common/sites/site-path', () => ( { readSitePath: mocks.readSitePath } ) );
vi.mock( '@studio/common/ai/settings-store', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/ai/settings-store') >() ),
	readAiSettings: mocks.readAiSettings,
	saveAnthropicApiKey: mocks.saveAnthropicApiKey,
	setAiProvider: mocks.setAiProvider,
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
		mocks.readSitePath.mockImplementation( async ( siteId: string ) =>
			siteId === 'local-a' ? '/sites/local-a' : null
		);
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
			anthropicApiKeyPreview: null,
		} );
		mocks.saveAnthropicApiKey.mockImplementation( async ( key: string | null ) => ( {
			provider: 'wpcom',
			hasAnthropicApiKey: key !== null,
			anthropicApiKeyPreview: key === null ? null : key.trim().slice( -4 ),
		} ) );
		mocks.setAiProvider.mockImplementation( async ( provider: string ) => ( {
			provider,
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: '1234',
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
		expect( mocks.measureSiteStorage ).toHaveBeenCalledWith( '/sites/local-a', {
			signal: expect.any( AbortSignal ),
		} );
		// The UI asks for this on every site switch, so it must not cost a CLI fork.
		expect( listSites ).not.toHaveBeenCalled();
	} );

	it( '404s a storage request for a site that is not in the config', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/sites/missing/storage`
		);

		expect( response.status ).toBe( 404 );
		expect( mocks.measureSiteStorage ).not.toHaveBeenCalled();
	} );

	it( 'reports the active theme through the site CLI', async () => {
		const theme = {
			name: 'Twenty Twenty-Five',
			path: '/sites/local-a/wp-content/themes/twentytwentyfive',
			slug: 'twentytwentyfive',
			isBlockTheme: true,
		};
		mocks.execute.mockImplementationOnce( () => {
			const emitter = new EventEmitter();
			queueMicrotask( () =>
				emitter.emit( 'success', { result: { stdout: JSON.stringify( theme ) } } )
			);
			return [ emitter, {} ];
		} );

		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/sites/local-a/theme`
		);

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toEqual( theme );
		expect( mocks.execute ).toHaveBeenCalledWith(
			[ 'wp', 'studio', 'get-theme-details', '--path', '/sites/local-a' ],
			{ output: 'capture' }
		);
	} );

	it( 'serves the cached desktop thumbnail when one exists', async () => {
		const appDataRoot = await mkdtemp( path.join( os.tmpdir(), 'studio-thumbnail-test-' ) );
		const previousE2E = process.env.E2E;
		const previousAppDataPath = process.env.E2E_APP_DATA_PATH;
		process.env.E2E = '1';
		process.env.E2E_APP_DATA_PATH = appDataRoot;
		try {
			const thumbnailsPath = path.join( appDataRoot, 'Studio', 'thumbnails' );
			await mkdir( thumbnailsPath, { recursive: true } );
			await writeFile( path.join( thumbnailsPath, 'local-a.png' ), Buffer.from( [ 1, 2, 3 ] ) );

			const response = await fetch(
				`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/sites/local-a/thumbnail`
			);

			expect( response.status ).toBe( 200 );
			expect( response.headers.get( 'content-type' ) ).toBe( 'image/png' );
			expect( Buffer.from( await response.arrayBuffer() ) ).toEqual( Buffer.from( [ 1, 2, 3 ] ) );
		} finally {
			if ( previousE2E === undefined ) {
				delete process.env.E2E;
			} else {
				process.env.E2E = previousE2E;
			}
			if ( previousAppDataPath === undefined ) {
				delete process.env.E2E_APP_DATA_PATH;
			} else {
				process.env.E2E_APP_DATA_PATH = previousAppDataPath;
			}
			await rm( appDataRoot, { recursive: true, force: true } );
		}
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
			anthropicApiKeyPreview: null,
		} );
	} );

	it( 'passes the Anthropic API key to the settings store untouched', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { anthropicApiKey: '  sk-ant-test-1234  ' } ),
			}
		);

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toMatchObject( {
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: '1234',
		} );
		expect( mocks.saveAnthropicApiKey ).toHaveBeenCalledWith( '  sk-ant-test-1234  ' );
	} );

	it( 'clears the Anthropic API key', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { anthropicApiKey: null } ),
			}
		);

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toMatchObject( { hasAnthropicApiKey: false } );
		expect( mocks.saveAnthropicApiKey ).toHaveBeenCalledWith( null );
	} );

	it( 'returns 400 with the message when Anthropic rejects a key being saved', async () => {
		mocks.saveAnthropicApiKey.mockRejectedValueOnce(
			new InvalidAnthropicApiKeyError(
				'Anthropic rejected this API key. Check the key and try again.'
			)
		);

		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { anthropicApiKey: 'sk-ant-rejected' } ),
			}
		);

		expect( response.status ).toBe( 400 );
		await expect( response.json() ).resolves.toEqual( {
			error: 'Anthropic rejected this API key. Check the key and try again.',
		} );
	} );

	it( 'rejects a non-string Anthropic API key', async () => {
		const response = await fetch(
			`${ server.url.replace( 'localhost', '127.0.0.1' ) }/api/ai-settings`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { anthropicApiKey: 42 } ),
			}
		);

		expect( response.status ).toBe( 400 );
		expect( mocks.saveAnthropicApiKey ).not.toHaveBeenCalled();
	} );

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
			new InvalidAnthropicApiKeyError(
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
				body: JSON.stringify( { provider: 'anthropic-api-key', model: 'gpt-5.6-sol' } ),
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

		expect( response.status ).toBe( 200 );
		await expect( response.json() ).resolves.toEqual( { cancelled: false } );
		expect( eventChunk ).toContain( '"channel":"sync-pull"' );
		expect( eventChunk ).toContain( '"siteId":"local-a"' );
		expect( eventChunk ).toContain( 'Creating remote backup… (18%)' );
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
			return [ emitter, { kill: () => undefined } ];
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
