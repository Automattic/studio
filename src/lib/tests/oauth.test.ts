import { readFile } from 'atomically';
import { vi } from 'vitest';
import { SupportedLocale } from 'common/lib/locale';
import { getAuthenticationToken, getSignUpUrl } from 'src/lib/oauth';

vi.mock( 'src/lib/certificate-manager', () => ( {} ) );
vi.mock( 'atomically', () => ( {
	readFile: vi.fn(),
} ) );
vi.mock( 'src/lib/wpcom-factory', () => ( {
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
		vi.mocked( readFile ).mockResolvedValue(
			Buffer.from( JSON.stringify( { authToken: validToken, sites: [] } ) )
		);

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
		vi.mocked( readFile ).mockResolvedValue(
			Buffer.from( JSON.stringify( { authToken: expiredToken, sites: [] } ) )
		);

		const result = await getAuthenticationToken();
		expect( result ).toBeNull();
	} );

	it( 'should return null for malformed token data', async () => {
		const malformedToken = {
			accessToken: 'token',
			// Missing required fields
		};
		vi.mocked( readFile ).mockResolvedValue(
			Buffer.from( JSON.stringify( { authToken: malformedToken, sites: [] } ) )
		);

		const result = await getAuthenticationToken();
		expect( result ).toBeNull();
	} );

	it( 'should return null when no token exists', async () => {
		vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( { sites: [] } ) ) );

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
