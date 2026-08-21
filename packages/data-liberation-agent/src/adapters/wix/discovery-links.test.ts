import { describe, expect, it, vi } from 'vitest';
import { discoverLinkedRoutes } from './discovery-links.js';

describe( 'discoverLinkedRoutes', () => {
	it( 'merges partial sitemap inventory with recursively linked same-origin routes', async () => {
		const loadLinks = vi.fn( async ( url: string ) => {
			if ( url === 'https://example.com/' ) {
				return [
					'https://example.com/projects/one#details',
					'https://external.example/project',
					'/cart',
					'/media/photo.jpg',
				];
			}
			if ( url === 'https://example.com/projects/one' ) {
				return [ '/projects/two', '/projects/one/' ];
			}
			if ( url === 'https://example.com/product/one' ) {
				throw new Error( 'page unavailable' );
			}
			return [];
		} );

		const result = await discoverLinkedRoutes( {
			siteUrl: 'https://example.com/',
			initialUrls: [ 'https://example.com/', 'https://example.com/product/one' ],
			loadLinks,
		} );

		expect( result.urls ).toEqual( [
			'https://example.com/',
			'https://example.com/product/one',
			'https://example.com/projects/one',
			'https://example.com/projects/two',
		] );
		expect( result.failures ).toEqual( [
			{
				url: 'https://example.com/product/one',
				reason: 'page unavailable',
			},
		] );
	} );

	it( 'bounds route retention and page probes independently', async () => {
		const loadLinks = vi.fn( async () => [ '/one', '/two', '/three' ] );
		const result = await discoverLinkedRoutes( {
			siteUrl: 'https://example.com/',
			initialUrls: [],
			loadLinks,
			maxPages: 1,
			maxUrls: 3,
		} );

		expect( result.urls ).toEqual( [
			'https://example.com/',
			'https://example.com/one',
			'https://example.com/two',
		] );
		expect( loadLinks ).toHaveBeenCalledTimes( 1 );
	} );
} );
