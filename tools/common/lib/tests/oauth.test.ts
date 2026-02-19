import { getAuthenticationUrl } from '../oauth';

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
