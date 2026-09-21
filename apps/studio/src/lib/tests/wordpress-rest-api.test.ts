/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import { SiteServer } from 'src/site-server';
import { fetchSiteRest } from '../wordpress-rest-api';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock( 'src/site-server', () => ( {
	SiteServer: {
		get: vi.fn(),
	},
} ) );

const mockIpcMainInvokeEvent = {} as IpcMainInvokeEvent;

function mockRunningSite( {
	id = 'site-id',
	port = 8903,
	publicUrl = 'https://example.wp.local',
}: {
	id?: string;
	port?: number;
	publicUrl?: string;
} = {} ) {
	vi.mocked( SiteServer.get ).mockImplementation( ( requestedId ) => {
		if ( requestedId !== id ) {
			return undefined;
		}

		return {
			details: {
				id,
				name: 'Test Site',
				path: '/test-site',
				port,
				phpVersion: '8.4',
				running: true,
				url: publicUrl,
				customDomain: new URL( publicUrl ).hostname,
				enableHttps: publicUrl.startsWith( 'https:' ),
			},
			server: {
				url: publicUrl,
			},
		} as unknown as SiteServer;
	} );
}

function mockRestFetch() {
	const fetchMock = vi.fn( async ( input: Parameters< typeof fetch >[ 0 ] ) => {
		const url = String( input );
		if ( url.includes( '/studio-auto-login' ) ) {
			return new Response( '', {
				status: 302,
				headers: {
					'set-cookie': 'wordpress_logged_in_test=token; Path=/; HttpOnly',
				},
			} );
		}

		if ( url.includes( '/wp-admin/admin-ajax.php' ) ) {
			return new Response( 'test-nonce', { status: 200 } );
		}

		return new Response( JSON.stringify( { ok: true } ), {
			status: 200,
			statusText: 'OK',
			headers: {
				'content-type': 'application/json',
			},
		} );
	} );

	vi.stubGlobal( 'fetch', fetchMock );
	return fetchMock;
}

function getRequestedUrls( fetchMock: ReturnType< typeof mockRestFetch > ) {
	return fetchMock.mock.calls.map( ( [ input ] ) => String( input ) );
}

describe( 'fetchSiteRest', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	} );

	it( 'uses the loopback site port for internal REST requests', async () => {
		mockRunningSite();
		const fetchMock = mockRestFetch();

		const response = await fetchSiteRest( mockIpcMainInvokeEvent, 'site-id', {
			path: '/wp/v2/pages?per_page=100',
		} );

		expect( response.status ).toBe( 200 );
		expect( getRequestedUrls( fetchMock ) ).toEqual( [
			'http://localhost:8903/studio-auto-login?redirect_to=%2Fwp-admin%2F',
			'http://localhost:8903/wp-admin/admin-ajax.php?action=rest-nonce',
			'http://localhost:8903/wp-json/wp/v2/pages?per_page=100',
		] );
	} );

	it( 'skips the nonce request when auto-login returns no login cookie', async () => {
		// A port the earlier tests have not auth-cached, so auth prep really runs.
		mockRunningSite( { port: 8911 } );
		const fetchMock = vi.fn( async ( input: Parameters< typeof fetch >[ 0 ] ) => {
			const url = String( input );
			if ( url.includes( '/studio-auto-login' ) ) {
				return new Response( '', {
					status: 302,
					headers: { 'set-cookie': 'wordpress_test_cookie=1; Path=/' },
				} );
			}
			return new Response( JSON.stringify( [] ), {
				status: 200,
				statusText: 'OK',
				headers: { 'content-type': 'application/json' },
			} );
		} );
		vi.stubGlobal( 'fetch', fetchMock );

		const response = await fetchSiteRest( mockIpcMainInvokeEvent, 'site-id', {
			path: '/wp/v2/search?search=rpg',
		} );

		expect( response.status ).toBe( 200 );
		const urls = fetchMock.mock.calls.map( ( [ input ] ) => String( input ) );
		expect( urls.filter( ( url ) => url.includes( '/studio-auto-login' ) ) ).toHaveLength( 1 );
		expect( urls.some( ( url ) => url.includes( 'admin-ajax.php' ) ) ).toBe( false );
	} );

	it( 'attempts auth once per site while it keeps failing', async () => {
		mockRunningSite( { port: 8912 } );
		const fetchMock = vi.fn( async ( input: Parameters< typeof fetch >[ 0 ] ) => {
			const url = String( input );
			if ( url.includes( '/studio-auto-login' ) ) {
				return new Response( '', { status: 302 } );
			}
			return new Response( JSON.stringify( [] ), {
				status: 200,
				statusText: 'OK',
				headers: { 'content-type': 'application/json' },
			} );
		} );
		vi.stubGlobal( 'fetch', fetchMock );

		const first = await fetchSiteRest( mockIpcMainInvokeEvent, 'site-id', {
			path: '/wp/v2/search?search=rpg',
		} );
		const second = await fetchSiteRest( mockIpcMainInvokeEvent, 'site-id', {
			path: '/wp/v2/search?search=rpgs',
		} );

		expect( first.status ).toBe( 200 );
		expect( second.status ).toBe( 200 );
		const urls = fetchMock.mock.calls.map( ( [ input ] ) => String( input ) );
		expect( urls.filter( ( url ) => url.includes( '/studio-auto-login' ) ) ).toHaveLength( 1 );
	} );

	it( 'returns a 502 response when the site does not respond', async () => {
		mockRunningSite();
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => {
				throw new TypeError( 'fetch failed' );
			} )
		);

		const response = await fetchSiteRest( mockIpcMainInvokeEvent, 'site-id', {
			path: '/wp/v2/search?search=as',
		} );

		expect( response.status ).toBe( 502 );
		expect( response.body ).toContain( 'studio_site_unreachable' );
	} );

	it( 'rejects paths that escape the site REST API', async () => {
		mockRunningSite();
		const fetchMock = mockRestFetch();

		// An absolute URL in `path` would override the REST root and carry the
		// site's auth to an arbitrary host (SSRF) — it must be rejected.
		const response = await fetchSiteRest( mockIpcMainInvokeEvent, 'site-id', {
			path: 'https://evil.example/wp-json/wp/v2/pages',
		} );

		expect( response.status ).toBe( 400 );
		expect( response.body ).toContain( 'REST path must stay within the site REST API.' );
		expect( fetchMock ).not.toHaveBeenCalled();
	} );
} );
