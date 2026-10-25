import { describe, expect, it } from 'vitest';
import { isOffOriginRedirect } from './webview';

describe( 'isOffOriginRedirect', () => {
	it( 'flags a load that settled on another port', () => {
		expect( isOffOriginRedirect( 'http://localhost:8931/', 'http://localhost:8932/' ) ).toBe(
			true
		);
	} );

	it( 'allows same-origin paths, including the auto-login hop', () => {
		expect(
			isOffOriginRedirect( 'http://localhost:8932/wp-admin/', 'http://localhost:8932/' )
		).toBe( false );
		expect(
			isOffOriginRedirect(
				'http://localhost:8932/studio-auto-login?redirect_to=%2Fwp-admin%2F',
				'http://localhost:8932/'
			)
		).toBe( false );
	} );

	it( 'stays quiet on unparseable urls rather than triggering recovery', () => {
		expect( isOffOriginRedirect( 'about:blank', 'http://localhost:8932/' ) ).toBe( true );
		expect( isOffOriginRedirect( '', 'http://localhost:8932/' ) ).toBe( false );
		expect( isOffOriginRedirect( 'http://localhost:8932/', '' ) ).toBe( false );
	} );
} );
