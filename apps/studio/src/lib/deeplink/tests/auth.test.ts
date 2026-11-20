/**
 * @vitest-environment node
 */
import { dialog } from 'electron';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAuthToken } from '@studio/common/lib/auth-token';
import * as store from '@studio/common/lib/config/store';
import { vi } from 'vitest';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { __resetPendingAuthContext, setPendingAuthContext } from 'src/lib/auth-tracks-context';
import { handleAuthDeeplink } from 'src/lib/deeplink/handlers/auth';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';

// The account WordPress.com's `/me` answers with, or the error it fails with.
const mockMe = ( me: object | Error ) =>
	vi.stubGlobal(
		'fetch',
		me instanceof Error
			? vi.fn().mockRejectedValue( me )
			: vi.fn().mockResolvedValue( { ok: true, json: async () => me } )
	);

vi.mock( 'atomically', async ( importOriginal ) => importOriginal() );
vi.mock( 'src/ipc-utils' );
vi.mock( 'src/main-window' );
vi.mock( 'src/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('src/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );

describe( 'handleAuthDeeplink', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		process.env.DEV_CONFIG_DIR = mkdtempSync( path.join( os.tmpdir(), 'studio-auth-deeplink-' ) );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		rmSync( process.env.DEV_CONFIG_DIR!, { recursive: true, force: true } );
		delete process.env.DEV_CONFIG_DIR;
	} );

	it( 'should handle successful authentication', async () => {
		mockMe( { ID: 123, email: 'user@example.com', display_name: 'Test User' } );

		const url = new URL( 'wp-studio://auth#access_token=mock-token&expires_in=3600' );
		await handleAuthDeeplink( url );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
			token: expect.objectContaining( {
				accessToken: 'mock-token',
				expiresIn: 3600,
				id: 123,
				email: 'user@example.com',
				displayName: 'Test User',
			} ),
		} );
		await expect( readAuthToken() ).resolves.toMatchObject( {
			accessToken: 'mock-token',
			id: 123,
		} );
	} );

	const expectErrorDialog = async ( message: string ) => {
		expect( dialog.showMessageBox ).toHaveBeenCalledWith(
			undefined,
			expect.objectContaining( { type: 'error', message } )
		);
		expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		await expect( readAuthToken() ).resolves.toBeNull();
	};

	it( 'shows "Authorization denied" when the user denies access on WordPress.com', async () => {
		await handleAuthDeeplink( new URL( 'wp-studio://auth#error=access_denied' ) );

		await expectErrorDialog( 'Authorization denied' );
	} );

	it( 'shows "Authentication error" for an invalid token response', async () => {
		await handleAuthDeeplink(
			new URL( 'wp-studio://auth#access_token=mock-token&expires_in=invalid' )
		);

		await expectErrorDialog( 'Authentication error' );
	} );

	describe( 'Tracks event', () => {
		let state: string | undefined;
		const successUrl = () =>
			new URL(
				`wp-studio://auth#access_token=mock-token&expires_in=3600${
					state ? '&state=' + state : ''
				}`
			);

		const lastAuthEventProps = () => {
			const calls = vi
				.mocked( recordTracksEvent )
				.mock.calls.filter( ( [ event ] ) => event === TRACKS_EVENTS.WPCOM_AUTH );
			return calls.at( -1 )?.[ 1 ];
		};

		beforeEach( () => {
			__resetPendingAuthContext();
			state = undefined;
			mockMe( { ID: 123, email: 'user@example.com', display_name: 'Test User' } );
		} );

		it( 'records a successful login with the initiating context', async () => {
			state = setPendingAuthContext( 'top_bar', 'existing' ).auth_attempt_id;

			await handleAuthDeeplink( successUrl() );

			expect( lastAuthEventProps() ).toMatchObject( {
				success: true,
				source: 'top_bar',
				account_type: 'existing',
			} );
		} );

		// `is_a11n` is derived from the stored token, so recording before the write would tag every
		// Automattician's login as `false`.
		it( 'records the success only after the token is stored', async () => {
			state = setPendingAuthContext( 'onboarding', 'new' ).auth_attempt_id;
			let storedWhenRecorded: unknown;
			vi.mocked( recordTracksEvent ).mockImplementation( async () => {
				storedWhenRecorded = store.readConfigSync().providers.configs.wpcom;
			} );

			await handleAuthDeeplink( successUrl() );

			expect( storedWhenRecorded ).toMatchObject( { token: 'mock-token' } );
		} );

		it( 'records a denied authorization as a failure', async () => {
			state = setPendingAuthContext( 'previews_tab', 'existing' ).auth_attempt_id;

			await handleAuthDeeplink(
				new URL( `wp-studio://auth#error=access_denied&state=${ state }` )
			);

			expect( lastAuthEventProps() ).toMatchObject( {
				success: false,
				source: 'previews_tab',
				account_type: 'existing',
				failure_reason: 'access_denied',
			} );
		} );

		it( 'classifies a missing token as a token error', async () => {
			state = setPendingAuthContext( 'settings', 'existing' ).auth_attempt_id;

			await handleAuthDeeplink( new URL( 'wp-studio://auth#expires_in=0' ) );

			expect( lastAuthEventProps() ).toMatchObject( {
				success: false,
				failure_reason: 'token_error',
			} );
		} );

		it( 'classifies a failing profile fetch', async () => {
			state = setPendingAuthContext( 'settings', 'existing' ).auth_attempt_id;
			mockMe( new Error( 'network down' ) );

			await handleAuthDeeplink( successUrl() );

			expect( lastAuthEventProps() ).toMatchObject( {
				success: false,
				failure_reason: 'profile_fetch_failed',
			} );
		} );

		// Same failure as the CLI's config-write case, so it must classify the same way — otherwise
		// `profile_fetch_failed` would mean two different things depending on channel.
		it( 'classifies a failure to store the token as unknown', async () => {
			state = setPendingAuthContext( 'settings', 'existing' ).auth_attempt_id;
			vi.spyOn( store, 'updateConfig' ).mockRejectedValue( new Error( 'disk full' ) );

			await handleAuthDeeplink( successUrl() );

			expect( lastAuthEventProps() ).toMatchObject( {
				success: false,
				failure_reason: 'unknown',
			} );
		} );

		it( 'reports an unknown source when auth was not initiated in this session', async () => {
			await handleAuthDeeplink( successUrl() );

			expect( lastAuthEventProps() ).toEqual( { success: true, source: 'unknown' } );
		} );

		// A stale context must not attach itself to an unrelated login.
		it( 'attributes only the first deep link after an initiation', async () => {
			state = setPendingAuthContext( 'add_site', 'existing' ).auth_attempt_id;

			await handleAuthDeeplink( successUrl() );
			await handleAuthDeeplink( successUrl() );

			expect( lastAuthEventProps() ).toEqual( { success: true, source: 'unknown' } );
		} );
	} );
} );
