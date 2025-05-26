/**
 * @jest-environment node
 */
import wpcom from 'wpcom';
import { SupportedLocale } from 'common/lib/locale';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getAuthenticationToken, onOpenUrlCallback, getSignUpUrl } from 'src/lib/oauth';
import { loadUserData, saveUserData } from 'src/storage/user-data';

jest.mock( 'src/lib/certificate-manager', () => ( {} ) );
jest.mock( 'src/ipc-utils' );
jest.mock( 'src/storage/user-data' );
jest.mock( 'wpcom' );

describe( 'getAuthenticationToken', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'should return valid token', async () => {
		const validToken = {
			accessToken: 'valid-token',
			expiresIn: 3600,
			expirationTime: new Date().getTime() + 3600 * 1000,
			id: 123,
			email: 'user@example.com',
			displayName: 'Test User',
		};
		( loadUserData as jest.Mock ).mockResolvedValue( { authToken: validToken } );

		const result = await getAuthenticationToken();
		expect( result ).toEqual( validToken );
	} );

	it( 'should return null for expired token', async () => {
		const expiredToken = {
			accessToken: 'expired-token',
			expiresIn: 3600,
			expirationTime: new Date().getTime() - 1000, // Past time
			id: 123,
			email: 'user@example.com',
			displayName: 'Test User',
		};
		( loadUserData as jest.Mock ).mockResolvedValue( { authToken: expiredToken } );

		const result = await getAuthenticationToken();
		expect( result ).toBeNull();
	} );

	it( 'should return null for malformed token data', async () => {
		const malformedToken = {
			accessToken: 'token',
			// Missing required fields
		};
		( loadUserData as jest.Mock ).mockResolvedValue( { authToken: malformedToken } );

		const result = await getAuthenticationToken();
		expect( result ).toBeNull();
	} );

	it( 'should return null when no token exists', async () => {
		( loadUserData as jest.Mock ).mockResolvedValue( {} );

		const result = await getAuthenticationToken();
		expect( result ).toBeNull();
	} );
} );

describe( 'getSignUpUrl', () => {
	it( 'should generate correct signup URL with English locale', () => {
		const locale: SupportedLocale = 'en';
		const result = getSignUpUrl( locale );

		const url = new URL( result );
		expect( url.origin ).toBe( 'https://wordpress.com' );
		expect( url.pathname ).toBe( '/log-in/link' );
		expect( url.searchParams.get( 'client_id' ) ).toBe( '95109' );
		expect( url.searchParams.get( 'locale' ) ).toBe( 'en' );
		expect( url.searchParams.has( 'redirect_to' ) ).toBe( true );
	} );

	it( 'should include encoded authentication URL as redirect_to parameter', () => {
		const locale: SupportedLocale = 'es';
		const mockAuthUrl =
			'https://public-api.wordpress.com/oauth2/authorize?response_type=token&client_id=95109&redirect_uri=wpcom-local-dev%3A%2F%2Fauth&scope=global&locale=es';
		const result = getSignUpUrl( locale );

		const url = new URL( result );
		const redirectTo = url.searchParams.get( 'redirect_to' );
		expect( redirectTo ).toBe( mockAuthUrl );
	} );

	it( 'should generate correct signup URL with different locales', () => {
		const testLocales: SupportedLocale[] = [ 'fr', 'de', 'pt-br', 'ja' ];

		testLocales.forEach( ( locale ) => {
			const result = getSignUpUrl( locale );

			const url = new URL( result );
			expect( url.searchParams.get( 'locale' ) ).toBe( locale );
		} );
	} );

	it( 'should return a valid URL string', () => {
		const locale: SupportedLocale = 'en';
		const result = getSignUpUrl( locale );

		// Should not throw when creating a new URL
		expect( () => new URL( result ) ).not.toThrow();

		// Should be a string
		expect( typeof result ).toBe( 'string' );

		// Should start with https://
		expect( result ).toMatch( /^https:\/\// );
	} );
} );

describe( 'onOpenUrlCallback', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		( loadUserData as jest.Mock ).mockResolvedValue( {} );
		( saveUserData as jest.Mock ).mockResolvedValue( undefined );
	} );

	describe( 'auth callback', () => {
		it( 'should handle successful authentication', async () => {
			const mockWpcomGet = jest.fn().mockResolvedValue( {
				ID: 123,
				email: 'user@example.com',
				display_name: 'Test User',
			} );
			( wpcom as jest.Mock ).mockReturnValue( {
				req: { get: mockWpcomGet },
			} );

			const url = 'studio://auth#access_token=mock-token&expires_in=3600';
			await onOpenUrlCallback( url );

			expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
				token: expect.objectContaining( {
					accessToken: 'mock-token',
					expiresIn: 3600,
					id: 123,
					email: 'user@example.com',
					displayName: 'Test User',
				} ),
			} );
			expect( saveUserData ).toHaveBeenCalled();
		} );

		it( 'should handle authentication error from WordPress.com', async () => {
			const url = 'studio://auth#error=access_denied';
			await onOpenUrlCallback( url );

			expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
				error: new Error( 'access_denied' ),
			} );
			expect( saveUserData ).not.toHaveBeenCalled();
		} );

		it( 'should handle invalid token response', async () => {
			const url = 'studio://auth#access_token=mock-token&expires_in=invalid';
			await onOpenUrlCallback( url );

			expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
				error: expect.any( Error ),
			} );
			expect( saveUserData ).not.toHaveBeenCalled();
		} );

		it( 'should handle wpcom API error', async () => {
			const mockWpcomGet = jest.fn().mockRejectedValue( new Error( 'API Error' ) );
			( wpcom as jest.Mock ).mockReturnValue( {
				req: { get: mockWpcomGet },
			} );

			const url = 'studio://auth#access_token=mock-token&expires_in=3600';
			await onOpenUrlCallback( url );

			expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
				error: expect.any( Error ),
			} );
			expect( saveUserData ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'sync-connect-site callback', () => {
		it( 'should handle sync connect site callback', async () => {
			const url = 'studio://sync-connect-site?remoteSiteId=123&studioSiteId=local-site';
			await onOpenUrlCallback( url );

			expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'sync-connect-site', {
				remoteSiteId: 123,
				studioSiteId: 'local-site',
			} );
		} );

		it( 'should not send sync connect site event if parameters are missing', async () => {
			const url = 'studio://sync-connect-site?remoteSiteId=123';
			await onOpenUrlCallback( url );

			expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		} );
	} );
} );
