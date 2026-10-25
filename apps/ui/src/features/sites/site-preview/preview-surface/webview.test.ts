import { describe, expect, it, vi } from 'vitest';
import { isOffOriginRedirect, reloadPreview, type WebviewTag } from './webview';

describe( 'reloadPreview', () => {
	it( 'stops a pending load first, which would otherwise swallow the reload', async () => {
		const calls: string[] = [];
		const webview = {
			stop: vi.fn( () => calls.push( 'stop' ) ),
			reload: vi.fn( () => calls.push( 'reload' ) ),
		} as unknown as WebviewTag;

		await reloadPreview( webview, 'http://localhost:8932/', 'http://localhost:8932/' );

		expect( calls ).toEqual( [ 'stop', 'reload' ] );
	} );
} );

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
