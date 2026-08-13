/**
 * @vitest-environment node
 */
import { readFile, writeFile } from 'atomically';
import { vi } from 'vitest';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { __resetPendingAuthContext, setPendingAuthContext } from 'src/lib/auth-tracks-context';
import { handleAuthDeeplink } from 'src/lib/deeplink/handlers/auth';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';

const mockWpcomGet = vi.fn();

vi.mock( 'src/lib/certificate-manager', () => ( {} ) );
vi.mock( 'src/ipc-utils' );
vi.mock( 'src/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('src/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );
vi.mock( '@studio/common/lib/wpcom-factory', () => ( {
	default: () => ( {
		req: { get: mockWpcomGet },
	} ),
} ) );
vi.mock( '@studio/common/lib/wpcom-xhr-request-factory', () => ( {
	default: vi.fn(),
} ) );

describe( 'handleAuthDeeplink', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( { sites: [] } ) ) );
		vi.mocked( writeFile ).mockResolvedValue( undefined );
	} );

	it( 'should handle successful authentication', async () => {
		mockWpcomGet.mockResolvedValue( {
			ID: 123,
			email: 'user@example.com',
			display_name: 'Test User',
		} );

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
		expect( writeFile ).toHaveBeenCalled();
	} );

	it( 'should handle authentication error from WordPress.com', async () => {
		const url = new URL( 'wp-studio://auth#error=access_denied' );
		await handleAuthDeeplink( url );

		// Matched by message, not identity: the error also carries a `code` for Tracks, and the renderer
		// keys its "Authorization denied" dialog off the message.
		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
			error: expect.objectContaining( { message: 'access_denied' } ),
		} );
		expect( writeFile ).not.toHaveBeenCalled();
	} );

	it( 'should handle invalid token response', async () => {
		const url = new URL( 'wp-studio://auth#access_token=mock-token&expires_in=invalid' );
		await handleAuthDeeplink( url );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
			error: expect.any( Error ),
		} );
		expect( writeFile ).not.toHaveBeenCalled();
	} );

	it( 'should handle wpcom API error', async () => {
		mockWpcomGet.mockRejectedValue( new Error( 'API Error' ) );

		const url = new URL( 'wp-studio://auth#access_token=mock-token&expires_in=3600' );
		await handleAuthDeeplink( url );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
			error: expect.any( Error ),
		} );
		expect( writeFile ).not.toHaveBeenCalled();
	} );

	describe( 'Tracks event', () => {
		const successUrl = () => new URL( 'wp-studio://auth#access_token=mock-token&expires_in=3600' );

		const lastAuthEventProps = () => {
			const calls = vi
				.mocked( recordTracksEvent )
				.mock.calls.filter( ( [ event ] ) => event === TRACKS_EVENTS.WPCOM_AUTH );
			return calls.at( -1 )?.[ 1 ];
		};

		beforeEach( () => {
			__resetPendingAuthContext();
			mockWpcomGet.mockResolvedValue( {
				ID: 123,
				email: 'user@example.com',
				display_name: 'Test User',
			} );
		} );

		it( 'records a successful login with the initiating context', async () => {
			setPendingAuthContext( 'top_bar', 'existing' );

			await handleAuthDeeplink( successUrl() );

			expect( lastAuthEventProps() ).toEqual( {
				success: true,
				source: 'top_bar',
				account_type: 'existing',
			} );
		} );

		// `is_a11n` is derived from the stored token, so recording before the write would tag every
		// Automattician's login as `false`.
		it( 'records the success only after the token is stored', async () => {
			setPendingAuthContext( 'onboarding', 'new' );
			const order: string[] = [];
			vi.mocked( writeFile ).mockImplementation( async () => {
				order.push( 'write' );
			} );
			vi.mocked( recordTracksEvent ).mockImplementation( async () => {
				order.push( 'record' );
			} );

			await handleAuthDeeplink( successUrl() );

			expect( order.indexOf( 'write' ) ).toBeLessThan( order.indexOf( 'record' ) );
		} );

		it( 'records a denied authorization as a failure', async () => {
			setPendingAuthContext( 'previews_tab', 'existing' );

			await handleAuthDeeplink( new URL( 'wp-studio://auth#error=access_denied' ) );

			expect( lastAuthEventProps() ).toEqual( {
				success: false,
				source: 'previews_tab',
				account_type: 'existing',
				failure_reason: 'access_denied',
			} );
		} );

		it( 'classifies a missing token as a token error', async () => {
			setPendingAuthContext( 'settings', 'existing' );

			await handleAuthDeeplink( new URL( 'wp-studio://auth#expires_in=0' ) );

			expect( lastAuthEventProps() ).toMatchObject( {
				success: false,
				failure_reason: 'token_error',
			} );
		} );

		it( 'classifies a failing profile fetch', async () => {
			setPendingAuthContext( 'settings', 'existing' );
			mockWpcomGet.mockRejectedValue( new Error( 'network down' ) );

			await handleAuthDeeplink( successUrl() );

			expect( lastAuthEventProps() ).toMatchObject( {
				success: false,
				failure_reason: 'profile_fetch_failed',
			} );
		} );

		it( 'reports an unknown source when auth was not initiated in this session', async () => {
			await handleAuthDeeplink( successUrl() );

			expect( lastAuthEventProps() ).toEqual( { success: true, source: 'unknown' } );
		} );

		// A stale context must not attach itself to an unrelated login.
		it( 'attributes only the first deep link after an initiation', async () => {
			setPendingAuthContext( 'add_site', 'existing' );

			await handleAuthDeeplink( successUrl() );
			await handleAuthDeeplink( successUrl() );

			expect( lastAuthEventProps() ).toEqual( { success: true, source: 'unknown' } );
		} );
	} );
} );
