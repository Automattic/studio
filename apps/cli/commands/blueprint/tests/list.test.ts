import { fetchLibraryBlueprints } from '@studio/blueprints';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { runCommand } from '../list';

vi.mock( '@studio/common/lib/shared-config' );
vi.mock( '@studio/blueprints' );
vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportStart = vi.fn();
		reportSuccess = vi.fn();
		reportError = vi.fn();
		reportProgress = vi.fn();
		reportWarning = vi.fn();
		spinner = {};
		currentAction = null;
	},
	LoggerError: class extends Error {},
} ) );

const testBlueprints = [
	{
		slug: 'quick-start',
		title: 'Quick Start',
		excerpt: 'Get started quickly',
		image: 'https://example.com/qs.png',
		playgroundUrl: 'https://playground.wordpress.net/',
		blueprint: {
			meta: { title: 'Quick Start', author: 'Studio', categories: [ 'starter' ] },
			steps: [],
		},
	},
	{
		slug: 'woo-shop',
		title: 'WooCommerce Shop',
		excerpt: 'An online store',
		image: 'https://example.com/woo.png',
		playgroundUrl: 'https://playground.wordpress.net/',
		blueprint: {
			meta: { title: 'WooCommerce Shop', author: 'Studio', categories: [ 'ecommerce' ] },
			steps: [],
		},
		bundleUrl: 'https://example.com/woo-bundle.zip',
	},
];

describe( 'CLI: studio blueprint list', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( readSharedConfig ).mockResolvedValue( { version: 1 } );
		vi.mocked( fetchLibraryBlueprints ).mockResolvedValue( testBlueprints );
		vi.spyOn( console, 'log' ).mockImplementation( () => {} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should list blueprints in json format', async () => {
		await runCommand( 'json' );

		expect( console.log ).toHaveBeenCalledWith( JSON.stringify( testBlueprints ) );
	} );

	it( 'should throw when offline', async () => {
		vi.mocked( fetchLibraryBlueprints ).mockRejectedValue( new TypeError( 'fetch failed' ) );

		await expect( runCommand( 'table' ) ).rejects.toThrow( 'internet connection' );
	} );

	it( 'should output empty json array when no blueprints', async () => {
		vi.mocked( fetchLibraryBlueprints ).mockResolvedValue( [] );

		await runCommand( 'json' );

		expect( console.log ).toHaveBeenCalledWith( '[]' );
	} );

	it( 'should filter by category', async () => {
		await runCommand( 'json', 'ecommerce' );

		expect( console.log ).toHaveBeenCalledWith( JSON.stringify( [ testBlueprints[ 1 ] ] ) );
	} );

	it( 'should filter by category case-insensitively', async () => {
		await runCommand( 'json', 'Ecommerce' );

		expect( console.log ).toHaveBeenCalledWith( JSON.stringify( [ testBlueprints[ 1 ] ] ) );
	} );

	it( 'should return empty results for non-matching category', async () => {
		await runCommand( 'json', 'nonexistent' );

		expect( console.log ).toHaveBeenCalledWith( '[]' );
	} );

	it( 'should pass locale from shared config', async () => {
		vi.mocked( readSharedConfig ).mockResolvedValue( { version: 1, locale: 'fr_FR' } );

		await runCommand( 'table' );

		expect( fetchLibraryBlueprints ).toHaveBeenCalledWith( { locale: 'fr_FR' } );
	} );
} );
