import { describe, expect, it, vi } from 'vitest';
import {
	buildRestApiUrl,
	discoverRestApiRoot,
	parseRestApiRootFromLinkHeader,
} from 'cli/ai/tools/wp-rest';

describe( 'parseRestApiRootFromLinkHeader', () => {
	it( 'extracts the api.w.org root from a Link header', () => {
		expect(
			parseRestApiRootFromLinkHeader( '<https://example.com/wp-json/>; rel="https://api.w.org/"' )
		).toBe( 'https://example.com/wp-json/' );
	} );

	it( 'finds the api.w.org root among multiple links', () => {
		expect(
			parseRestApiRootFromLinkHeader(
				'<https://example.com/>; rel="canonical", ' +
					'<https://example.com/?rest_route=/>; rel="https://api.w.org/"'
			)
		).toBe( 'https://example.com/?rest_route=/' );
	} );

	it( 'returns null when there is no matching link', () => {
		expect(
			parseRestApiRootFromLinkHeader( '<https://example.com/>; rel="canonical"' )
		).toBeNull();
		expect( parseRestApiRootFromLinkHeader( null ) ).toBeNull();
		expect( parseRestApiRootFromLinkHeader( '' ) ).toBeNull();
	} );
} );

describe( 'discoverRestApiRoot', () => {
	it( 'prefers the root advertised by the homepage Link header', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response( null, {
				headers: { link: '<https://example.com/wp-json/>; rel="https://api.w.org/"' },
			} )
		);

		const root = await discoverRestApiRoot(
			'https://example.com/',
			fetchMock as unknown as typeof fetch
		);

		expect( root ).toBe( 'https://example.com/wp-json/' );
		expect( fetchMock ).toHaveBeenCalledWith( 'https://example.com/', { method: 'HEAD' } );
	} );

	it( 'probes /wp-json/ when the Link header is missing', async () => {
		const fetchMock = vi.fn( ( url: string ) => {
			if ( url === 'https://example.com/wp-json/' ) {
				return Promise.resolve( new Response( '{}', { status: 200 } ) );
			}
			return Promise.resolve( new Response( null, { status: 404 } ) );
		} );

		const root = await discoverRestApiRoot(
			'https://example.com',
			fetchMock as unknown as typeof fetch
		);

		expect( root ).toBe( 'https://example.com/wp-json/' );
	} );

	it( 'falls back to ?rest_route= when /wp-json/ 404s (plain permalinks)', async () => {
		const fetchMock = vi.fn( ( url: string, init?: RequestInit ) => {
			if ( init?.method === 'HEAD' ) {
				return Promise.resolve( new Response( null, { status: 200 } ) );
			}
			if ( url === 'https://example.com/wp-json/' ) {
				return Promise.resolve( new Response( null, { status: 404 } ) );
			}
			return Promise.resolve( new Response( '{}', { status: 200 } ) );
		} );

		const root = await discoverRestApiRoot(
			'https://example.com',
			fetchMock as unknown as typeof fetch
		);

		expect( root ).toBe( 'https://example.com/?rest_route=/' );
	} );

	it( 'falls back to the pretty root when nothing responds', async () => {
		const fetchMock = vi.fn().mockRejectedValue( new Error( 'network down' ) );

		const root = await discoverRestApiRoot(
			'https://example.com',
			fetchMock as unknown as typeof fetch
		);

		expect( root ).toBe( 'https://example.com/wp-json/' );
	} );
} );

describe( 'buildRestApiUrl', () => {
	it( 'appends the route to a pretty /wp-json/ root', () => {
		expect( buildRestApiUrl( 'https://example.com/wp-json/', 'wp/v2', '/posts' ).toString() ).toBe(
			'https://example.com/wp-json/wp/v2/posts'
		);
	} );

	it( 'appends the route to the rest_route param for the fallback root', () => {
		expect(
			buildRestApiUrl( 'https://example.com/?rest_route=/', 'wp/v2', '/users/me' ).toString()
		).toBe( 'https://example.com/?rest_route=%2Fwp%2Fv2%2Fusers%2Fme' );
	} );

	it( 'normalizes namespace and path slashes', () => {
		expect(
			buildRestApiUrl( 'https://example.com/wp-json/', '/wc/v3/', 'products' ).toString()
		).toBe( 'https://example.com/wp-json/wc/v3/products' );
	} );

	it( 'preserves a subdirectory install root', () => {
		expect(
			buildRestApiUrl( 'https://example.com/blog/wp-json/', 'wp/v2', '/posts' ).toString()
		).toBe( 'https://example.com/blog/wp-json/wp/v2/posts' );
	} );
} );
