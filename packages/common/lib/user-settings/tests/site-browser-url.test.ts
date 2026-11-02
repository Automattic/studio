import { describe, expect, it } from 'vitest';
import { getSiteBrowserUrl } from '../site-browser-url';

describe( 'getSiteBrowserUrl', () => {
	const site = { url: 'http://localhost:8881' };

	it( 'signs in as the admin by default', () => {
		const url = new URL( getSiteBrowserUrl( site, '/wp-admin/' ) );
		expect( url.pathname ).toBe( '/studio-auto-login' );
		expect( url.searchParams.has( 'user' ) ).toBe( false );
	} );

	it( 'signs in as the given user for Client admin', () => {
		const url = new URL( getSiteBrowserUrl( site, '/wp-admin/', true, 'maria' ) );
		expect( url.searchParams.get( 'user' ) ).toBe( 'maria' );
		expect( url.searchParams.get( 'redirect_to' ) ).toBe( 'http://localhost:8881/wp-admin/' );
	} );
} );
