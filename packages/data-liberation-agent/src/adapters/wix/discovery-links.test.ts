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
		expect( result.failures ).toEqual( [] );
		expect( loadLinks ).not.toHaveBeenCalledWith( 'https://example.com/product/one' );
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

	it( 'keeps path-hosted sites within the supplied source root', async () => {
		const loadLinks = vi.fn( async () => [
			'/demone2/nimbus-commute/privacy-policy',
			'/demone2/nimbus-commute/accessibility-statement',
			'/website/templates',
			'/demone2/another-site',
		] );
		const result = await discoverLinkedRoutes( {
			siteUrl: 'https://www.wix.com/demone2/nimbus-commute',
			initialUrls: [ 'https://www.wix.com/website/templates' ],
			loadLinks,
			maxPages: 1,
		} );

		expect( result.urls ).toEqual( [
			'https://www.wix.com/demone2/nimbus-commute',
			'https://www.wix.com/demone2/nimbus-commute/privacy-policy',
			'https://www.wix.com/demone2/nimbus-commute/accessibility-statement',
		] );
	} );

	it( 'rejects sibling paths that only share a string prefix with the source root', async () => {
		const loadLinks = vi.fn( async () => [ '/a/b/child', '/a/b-other' ] );
		const result = await discoverLinkedRoutes( {
			siteUrl: 'https://example.com/a/b',
			initialUrls: [ 'https://example.com/a/b-other' ],
			loadLinks,
			maxPages: 1,
		} );

		expect( result.urls ).toEqual( [ 'https://example.com/a/b', 'https://example.com/a/b/child' ] );
	} );
} );
