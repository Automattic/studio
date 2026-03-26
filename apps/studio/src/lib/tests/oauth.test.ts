import { SupportedLocale } from '@studio/common/lib/locale';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { getAuthenticationToken, getSignUpUrl } from 'src/lib/oauth';

vi.mock( 'src/lib/certificate-manager', () => ( {} ) );
vi.mock( '@studio/common/lib/shared-config', () => ( {
	readAuthToken: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/wpcom-factory', () => ( {
	__esModule: true,
	default: vi.fn(),
} ) );

describe( 'getAuthenticationToken', () => {
	beforeEach( () => {
		vi.clearAllMocks();
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
		vi.mocked( readAuthToken ).mockResolvedValue( validToken );

		const result = await getAuthenticationToken();
		expect( result ).toEqual( validToken );
	} );

	it( 'should return null for expired token', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( null );

		const result = await getAuthenticationToken();
		expect( result ).toBeNull();
	} );

	it( 'should return null for malformed token data', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( null );

		const result = await getAuthenticationToken();
		expect( result ).toBeNull();
	} );

	it( 'should return null when no token exists', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( null );

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
		expect( url.pathname ).toBe( '/start/wpcc/oauth2-user' );
		expect( url.searchParams.get( 'oauth2_client_id' ) ).toBe( '95109' );
		expect( url.searchParams.get( 'locale' ) ).toBe( 'en' );
		expect( url.searchParams.has( 'oauth2_redirect' ) ).toBe( true );
	} );

	it( 'should include encoded authentication URL as oauth2_redirect parameter', () => {
		const locale: SupportedLocale = 'es';
		const mockAuthUrl =
			'https://public-api.wordpress.com/oauth2/authorize?response_type=token&client_id=95109&redirect_uri=wp-studio%3A%2F%2Fauth&scope=global&locale=es';
		const result = getSignUpUrl( locale );

		const url = new URL( result );
		const redirectTo = url.searchParams.get( 'oauth2_redirect' );
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
