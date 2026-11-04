import { expect, it } from 'vitest';
import { getSiteBrowserUrl } from './site-browser-url';
const site = { url: 'http://localhost:9000', landingPage: '/wp-admin/edit.php' };
it( 'honors Blueprint landing pages and signs into admin', () => {
	const url = new URL( getSiteBrowserUrl( site, '', false ) );
	expect( url.pathname ).toBe( '/studio-auto-login' );
	expect( url.searchParams.get( 'redirect_to' ) ).toBe( 'http://localhost:9000/wp-admin/edit.php' );
} );
it( 'opens the explicit front end logged out and preserves remote preview URLs', () => {
	expect( getSiteBrowserUrl( site, '/', false ) ).toBe( 'http://localhost:9000/' );
	expect( getSiteBrowserUrl( site, 'https://example.test/about/', false ) ).toBe(
		'https://example.test/about/'
	);
} );
