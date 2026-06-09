import { search } from '@inquirer/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type WpComSiteInfo } from 'cli/lib/api';
import { pickWpComSite } from 'cli/lib/wpcom-site-picker';

vi.mock( '@inquirer/prompts', () => ( {
	search: vi.fn(),
} ) );

// Strip the dim-hostname ANSI styling so assertions can match the plain
// label text regardless of the terminal's color support.
// eslint-disable-next-line no-control-regex
const stripAnsi = ( value: string ): string => value.replace( /\x1b\[[0-9;]*m/g, '' );

describe( 'pickWpComSite', () => {
	const sites: WpComSiteInfo[] = [
		{ id: 1, name: 'My Blog', url: 'https://blog.example.com', isStaging: false },
		{ id: 2, name: 'Shop', url: 'https://store.wordpress.com', isStaging: false },
		{ id: 3, name: 'Portfolio', url: 'https://portfolio.example.org', isStaging: false },
	];

	const originalIsTTY = process.stdin.isTTY;

	beforeEach( () => {
		vi.clearAllMocks();
		Object.defineProperty( process.stdin, 'isTTY', { value: false, configurable: true } );
	} );

	afterEach( () => {
		Object.defineProperty( process.stdin, 'isTTY', {
			value: originalIsTTY,
			configurable: true,
		} );
		vi.restoreAllMocks();
	} );

	it( 'returns the site matching the selected id', async () => {
		vi.mocked( search ).mockResolvedValue( 2 );

		const result = await pickWpComSite( sites, 'Pick one' );

		expect( result ).toEqual( sites[ 1 ] );
	} );

	it( 'returns undefined for an empty site list without prompting', async () => {
		const result = await pickWpComSite( [], 'Pick one' );

		expect( result ).toBeUndefined();
		expect( search ).not.toHaveBeenCalled();
	} );

	it( 'returns undefined when the prompt is cancelled', async () => {
		const abortError = new Error( 'aborted' );
		abortError.name = 'AbortPromptError';
		vi.mocked( search ).mockRejectedValue( abortError );

		await expect( pickWpComSite( sites, 'Pick one' ) ).resolves.toBeUndefined();
	} );

	it( 'rethrows unexpected prompt errors', async () => {
		vi.mocked( search ).mockRejectedValue( new Error( 'boom' ) );

		await expect( pickWpComSite( sites, 'Pick one' ) ).rejects.toThrow( 'boom' );
	} );

	it( 'formats each choice as the site name followed by its hostname', async () => {
		vi.mocked( search ).mockResolvedValue( 1 );

		await pickWpComSite( sites, 'Pick one' );

		const config = vi.mocked( search ).mock.calls[ 0 ][ 0 ] as unknown as {
			source: ( term?: string ) => Array< { name: string; value: number } >;
		};
		const choices = config.source( '' ).map( ( choice ) => stripAnsi( choice.name ) );

		expect( choices ).toEqual( [
			'My Blog blog.example.com',
			'Shop store.wordpress.com',
			'Portfolio portfolio.example.org',
		] );
	} );

	it( 'appends a [staging] badge to staging sites only', async () => {
		const sitesWithStaging: WpComSiteInfo[] = [
			{ id: 1, name: 'Production', url: 'https://prod.wordpress.com', isStaging: false },
			{
				id: 2,
				name: 'Production',
				url: 'https://staging-1-prod.wpcomstaging.com',
				isStaging: true,
			},
		];
		vi.mocked( search ).mockResolvedValue( 1 );

		await pickWpComSite( sitesWithStaging, 'Pick one' );

		const config = vi.mocked( search ).mock.calls[ 0 ][ 0 ] as unknown as {
			source: ( term?: string ) => Array< { name: string; value: number } >;
		};
		const choices = config.source( '' ).map( ( choice ) => stripAnsi( choice.name ) );

		expect( choices ).toEqual( [
			'Production prod.wordpress.com',
			'Production staging-1-prod.wpcomstaging.com [staging]',
		] );
	} );

	it( 'filters choices by name or hostname (case-insensitive)', async () => {
		vi.mocked( search ).mockResolvedValue( 1 );

		await pickWpComSite( sites, 'Pick one' );

		const config = vi.mocked( search ).mock.calls[ 0 ][ 0 ] as unknown as {
			source: ( term?: string ) => Array< { name: string; value: number } >;
		};

		// Matches on the site name.
		expect( config.source( 'shop' ).map( ( c ) => c.value ) ).toEqual( [ 2 ] );
		// Matches on the hostname even when the name doesn't contain the term.
		expect( config.source( 'example.org' ).map( ( c ) => c.value ) ).toEqual( [ 3 ] );
		// Substring of the hostname matches multiple sites.
		expect( config.source( 'example' ).map( ( c ) => c.value ) ).toEqual( [ 1, 3 ] );
		// No matches.
		expect( config.source( 'nomatch' ) ).toEqual( [] );
		// Empty term returns every site.
		expect( config.source( '' ).map( ( c ) => c.value ) ).toEqual( [ 1, 2, 3 ] );
	} );
} );
