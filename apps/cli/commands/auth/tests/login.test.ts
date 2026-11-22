import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { confirm, input } from '@inquirer/prompts';
import { readAuthToken } from '@studio/common/lib/auth-token';
import { updateConfig } from '@studio/common/lib/config/store';
import { writeProviderConfig } from '@studio/common/lib/provider-config';
import { vi } from 'vitest';
import { openBrowser } from 'cli/lib/browser';
import { getAppLocale } from 'cli/lib/i18n';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { requireAuthToken } from 'cli/lib/wpcom-auth';
import { LoggerError } from 'cli/logger';
import {
	mockReportStart,
	mockReportSuccess,
	mockReportError,
	mockReportProgress,
	mockReportWarning,
	mockReportKeyValuePair,
} from 'cli/tests/test-utils';
import { runCommand } from '../login';

vi.mock( '@inquirer/prompts' );
vi.mock( '@studio/common/lib/provider-config', { spy: true } );
vi.mock( 'cli/lib/browser' );
vi.mock( 'cli/lib/daemon-client', () => ( {
	emitCliEvent: vi.fn(),
} ) );
vi.mock( 'cli/lib/i18n' );
vi.mock( 'cli/lib/tracks', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/tracks') >() ),
	recordTracksEvent: vi.fn( async () => undefined ),
	getTracksOrigin: () => ( { channel: 'studio-cli' } ),
} ) );
vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportStart = mockReportStart;
		reportSuccess = mockReportSuccess;
		reportError = mockReportError;
		reportProgress = mockReportProgress;
		reportWarning = mockReportWarning;
		reportKeyValuePair = mockReportKeyValuePair;
		spinner = {};
		currentAction = null;
	},
	LoggerError: class LoggerError extends Error {},
} ) );

async function withTerminal( isTTY: boolean, run: () => Promise< void > ) {
	const streams = [ process.stdin, process.stdout ];
	const descriptors = streams.map( ( stream ) =>
		Object.getOwnPropertyDescriptor( stream, 'isTTY' )
	);
	try {
		for ( const stream of streams )
			Object.defineProperty( stream, 'isTTY', { value: isTTY, configurable: true } );
		await run();
	} finally {
		streams.forEach( ( stream, index ) => {
			if ( descriptors[ index ] ) Object.defineProperty( stream, 'isTTY', descriptors[ index ]! );
			else Reflect.deleteProperty( stream, 'isTTY' );
		} );
	}
}

describe( 'Auth Login Command', () => {
	const mockAccessToken = 'mock-access-token-12345';
	const mockUserData = {
		ID: 12345,
		email: 'test@example.com',
		display_name: 'Test User',
	};
	// WordPress.com's `/me`, which checks the pasted token.
	const me = vi.fn();
	let directory: string;
	const authUrl = () => vi.mocked( openBrowser ).mock.calls[ 0 ][ 0 ];
	const signIn = () =>
		updateConfig( ( { providers } ) => {
			providers.configs.wpcom = {
				token: 'existing-token',
				expiresAt: Date.now() + 1209600000,
				user: { id: 999, email: 'existing@example.com', displayName: 'Existing User' },
			};
		} );

	beforeEach( async () => {
		vi.clearAllMocks();
		vi.mocked( writeProviderConfig ).mockReset();
		directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-login-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', directory );

		vi.mocked( getAppLocale ).mockResolvedValue( 'en' );
		me.mockResolvedValue( { ok: true, json: async () => mockUserData } );
		vi.stubGlobal( 'fetch', me );
		vi.mocked( openBrowser ).mockResolvedValue( undefined );
		vi.mocked( input ).mockResolvedValue( mockAccessToken );
	} );

	afterEach( async () => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		await fs.rm( directory, { force: true, recursive: true } );
	} );

	it( 'should skip login if already authenticated', async () => {
		await signIn();

		await runCommand();

		expect( openBrowser ).not.toHaveBeenCalled();
		expect( input ).not.toHaveBeenCalled();
	} );

	it( 'should complete the login process successfully', async () => {
		await runCommand();

		const url = new URL( authUrl() );
		expect( url.searchParams.get( 'redirect_uri' ) ).toBe(
			'https://developer.wordpress.com/copy-oauth-token'
		);
		expect( url.searchParams.get( 'locale' ) ).toBe( 'en' );
		expect( input ).toHaveBeenCalledWith( {
			message: 'Authentication token:',
		} );
		expect( me ).toHaveBeenCalledWith( expect.stringContaining( '/rest/v1.1/me' ), {
			headers: { Authorization: `Bearer ${ mockAccessToken }` },
		} );
		expect( await readAuthToken() ).toEqual( {
			accessToken: mockAccessToken,
			id: mockUserData.ID,
			email: mockUserData.email,
			displayName: mockUserData.display_name,
			expiresIn: expect.any( Number ),
			expirationTime: expect.any( Number ),
		} );
	} );

	it( 'should handle browser open failure', async () => {
		const browserError = new LoggerError( 'Failed to open browser' );
		vi.mocked( openBrowser ).mockRejectedValue( browserError );

		await runCommand();

		expect( input ).toHaveBeenCalled();
	} );

	it( 'should handle API error when fetching user info', async () => {
		me.mockRejectedValue( new Error( 'Failed to fetch user info' ) );

		await runCommand();

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
		expect( me ).toHaveBeenCalled();
	} );

	it( 'should report error if storing the token fails', async () => {
		vi.mocked( writeProviderConfig ).mockRejectedValue( new Error( 'Failed to save' ) );

		await runCommand();

		expect( mockReportError ).toHaveBeenCalled();
		expect( mockReportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
	} );

	it( 'should print the URL even when the browser opens', async () => {
		const logSpy = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );

		await runCommand();

		expect( logSpy ).toHaveBeenCalledWith( authUrl() );

		logSpy.mockRestore();
	} );

	it( 'should use provided locale', async () => {
		vi.mocked( getAppLocale ).mockResolvedValue( 'fr' );

		await runCommand();

		expect( new URL( authUrl() ).searchParams.get( 'locale' ) ).toBe( 'fr' );
	} );

	describe( 'Tracks event', () => {
		const authEvents = () =>
			vi
				.mocked( recordTracksEvent )
				.mock.calls.filter( ( [ name ] ) => name === TRACKS_EVENTS.WPCOM_AUTH )
				.map( ( [ name, props ] ) => [
					name,
					Object.fromEntries(
						Object.entries( props ?? {} ).filter(
							( [ key, value ] ) =>
								! [ 'placement', 'intent', 'auth_flow', 'auth_attempt_id' ].includes( key ) &&
								value !== undefined
						)
					),
				] );

		// `account_type` is absent throughout — the CLI has no signup path.
		it( 'records a successful login', async () => {
			await runCommand();

			expect( authEvents() ).toEqual( [
				[ TRACKS_EVENTS.WPCOM_AUTH, { channel: 'studio-cli', source: 'cli', success: true } ],
			] );
		} );

		it( 'correlates login start and success without including the pasted token', async () => {
			await runCommand();

			const calls = vi.mocked( recordTracksEvent ).mock.calls;
			const started = calls.find( ( [ name ] ) => name === TRACKS_EVENTS.WPCOM_AUTH_STARTED );
			const succeeded = calls.find( ( [ name ] ) => name === TRACKS_EVENTS.WPCOM_AUTH );
			expect( started?.[ 1 ] ).toEqual(
				expect.objectContaining( {
					auth_attempt_id: expect.any( String ),
					source: 'cli',
					placement: 'cli',
					intent: 'account',
				} )
			);
			expect( succeeded?.[ 1 ] ).toEqual(
				expect.objectContaining( {
					...started?.[ 1 ],
					success: true,
				} )
			);
			expect( JSON.stringify( calls ) ).not.toContain( mockAccessToken );
		} );

		it( 'retains attribution when the browser fails and the pasted token succeeds', async () => {
			vi.mocked( openBrowser ).mockRejectedValue( new Error( 'browser unavailable' ) );
			await runCommand();

			const calls = vi.mocked( recordTracksEvent ).mock.calls;
			const started = calls.find( ( [ name ] ) => name === TRACKS_EVENTS.WPCOM_AUTH_STARTED );
			expect( calls ).toContainEqual( [ TRACKS_EVENTS.WPCOM_AUTH_LAUNCH_FAILED, started?.[ 1 ] ] );
			expect( calls ).toContainEqual( [
				TRACKS_EVENTS.WPCOM_AUTH,
				{ ...started?.[ 1 ], success: true },
			] );
		} );

		it( 'records a cancelled prompt against the started attempt', async () => {
			const error = new Error( 'cancelled' );
			error.name = 'ExitPromptError';
			vi.mocked( input ).mockRejectedValue( error );
			await runCommand();

			const calls = vi.mocked( recordTracksEvent ).mock.calls;
			const started = calls.find( ( [ name ] ) => name === TRACKS_EVENTS.WPCOM_AUTH_STARTED );
			expect( calls ).toContainEqual( [ TRACKS_EVENTS.WPCOM_AUTH_CANCELLED, started?.[ 1 ] ] );
			expect( authEvents() ).toEqual( [] );
		} );

		it.each( [ true, false ] )(
			'records the visible terminal offer before the user accepts=%s',
			async ( accepts ) => {
				await withTerminal( true, async () => {
					vi.mocked( confirm ).mockResolvedValue( accepts );
					if ( accepts ) await requireAuthToken();
					else await expect( requireAuthToken() ).rejects.toThrow();
					const calls = vi.mocked( recordTracksEvent ).mock.calls;
					const exposure = calls.find(
						( [ event ] ) => event === TRACKS_EVENTS.ACCOUNT_PROMPT_VIEWED
					)?.[ 1 ];
					expect( exposure ).toEqual( {
						channel: 'studio-cli',
						source: 'cli',
						placement: 'cli',
						intent: 'account',
						journey_id: expect.stringMatching( /^[0-9a-f-]{36}$/ ),
					} );
					if ( accepts ) {
						const started = calls.find(
							( [ event ] ) => event === TRACKS_EVENTS.WPCOM_AUTH_STARTED
						)?.[ 1 ];
						expect( started?.journey_id ).toBe( exposure?.journey_id );
						expect(
							calls.find( ( [ event ] ) => event === TRACKS_EVENTS.WPCOM_AUTH )?.[ 1 ]?.journey_id
						).toBe( exposure?.journey_id );
					} else
						expect( calls.map( ( [ event ] ) => event ) ).toEqual( [
							TRACKS_EVENTS.ACCOUNT_PROMPT_VIEWED,
						] );
				} );
			}
		);

		it( 'does not record a prompt or an attempt for non-interactive auth-required errors', async () => {
			await withTerminal( false, async () => {
				await expect( requireAuthToken() ).rejects.toThrow();
				expect( confirm ).not.toHaveBeenCalled();
				expect( recordTracksEvent ).not.toHaveBeenCalled();
			} );
		} );

		// `is_a11n` is derived from the stored token, so the event must follow the write.
		it( 'records the success only after the token is stored', async () => {
			const order: string[] = [];
			const { writeProviderConfig: write } = await vi.importActual<
				typeof import('@studio/common/lib/provider-config')
			>( '@studio/common/lib/provider-config' );
			vi.mocked( writeProviderConfig ).mockImplementation( async ( ...args ) => {
				await write( ...args );
				order.push( 'write' );
			} );
			vi.mocked( recordTracksEvent ).mockImplementation( async () => {
				order.push( 'record' );
			} );

			await runCommand();

			expect( order ).toEqual( [ 'record', 'write', 'record' ] );
		} );

		it( 'records a failure when the token is rejected', async () => {
			me.mockRejectedValue( new Error( 'nope' ) );

			await runCommand();

			expect( authEvents() ).toEqual( [
				[
					TRACKS_EVENTS.WPCOM_AUTH,
					{
						channel: 'studio-cli',
						source: 'cli',
						success: false,
						failure_reason: 'profile_fetch_failed',
					},
				],
			] );
		} );

		it( 'records a failure when the token cannot be stored', async () => {
			vi.mocked( writeProviderConfig ).mockRejectedValue( new LoggerError( 'disk full' ) );

			await runCommand();

			expect( authEvents() ).toEqual( [
				[
					TRACKS_EVENTS.WPCOM_AUTH,
					{ channel: 'studio-cli', source: 'cli', success: false, failure_reason: 'unknown' },
				],
			] );
		} );

		// Nothing was authenticated, so there is no outcome to record.
		it( 'records nothing when already authenticated', async () => {
			await signIn();

			await runCommand();

			expect( authEvents() ).toEqual( [] );
		} );
	} );
} );
