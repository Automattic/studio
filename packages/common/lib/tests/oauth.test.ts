import { getAuthenticationUrl, getSignUpUrl } from '../oauth';

describe( 'getAuthenticationUrl', () => {
	it( 'should generate correct authentication URL with English locale', () => {
		const result = getAuthenticationUrl( 'en' );

		expect( result ).toBe(
			'https://public-api.wordpress.com/oauth2/authorize?response_type=token&client_id=95109&redirect_uri=wp-studio%3A%2F%2Fauth&scope=global&locale=en'
		);
	} );

	it( 'should generate correct authentication URL with other locales', () => {
		const result = getAuthenticationUrl( 'es' );

		expect( result ).toBe(
			'https://public-api.wordpress.com/oauth2/authorize?response_type=token&client_id=95109&redirect_uri=wp-studio%3A%2F%2Fauth&scope=global&locale=es'
		);
	} );
} );

describe( 'getSignUpUrl', () => {
	it( 'returns to the provided OAuth redirect after signup', () => {
		const redirectUri = 'http://localhost:8081/auth/callback';
		const result = new URL( getSignUpUrl( 'en', redirectUri ) );
		const oauthRedirect = new URL( result.searchParams.get( 'oauth2_redirect' ) ?? '' );

		expect( result.pathname ).toBe( '/start/wpcc/oauth2-user' );
		expect( result.searchParams.get( 'oauth2_client_id' ) ).toBe( '95109' );
		expect( oauthRedirect.searchParams.get( 'redirect_uri' ) ).toBe( redirectUri );
	} );
} );
