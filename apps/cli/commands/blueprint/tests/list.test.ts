import { isOnline } from '@studio/common/lib/network-utils';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { fetchStudioBlueprints } from '@studio/common/lib/studio-blueprints-api';
import { vi } from 'vitest';
import { mockReportKeyValuePair } from 'cli/tests/test-utils';
import { runCommand } from '../list';

vi.mock( '@studio/common/lib/network-utils' );
vi.mock( '@studio/common/lib/shared-config' );
vi.mock( '@studio/common/lib/studio-blueprints-api' );
vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportStart = vi.fn();
		reportSuccess = vi.fn();
		reportError = vi.fn();
		reportProgress = vi.fn();
		reportWarning = vi.fn();
		reportKeyValuePair = mockReportKeyValuePair;
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
		playground_url: 'https://playground.wordpress.net/',
		blueprint: {
			meta: { categories: [ 'starter' ] },
			steps: [],
		},
		bundle_url: null,
	},
	{
		slug: 'woo-shop',
		title: 'WooCommerce Shop',
		excerpt: 'An online store',
		image: 'https://example.com/woo.png',
		playground_url: 'https://playground.wordpress.net/',
		blueprint: {
			meta: { categories: [ 'ecommerce' ] },
			steps: [],
		},
		bundle_url: 'https://example.com/woo-bundle.zip',
	},
];

describe( 'CLI: studio blueprint list', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( isOnline ).mockResolvedValue( true );
		vi.mocked( readSharedConfig ).mockResolvedValue( { version: 1 } );
		vi.mocked( fetchStudioBlueprints ).mockResolvedValue( testBlueprints );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should list blueprints in table format', async () => {
		const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

		await runCommand( 'table' );

		expect( fetchStudioBlueprints ).toHaveBeenCalled();
		expect( consoleSpy ).toHaveBeenCalled();

		consoleSpy.mockRestore();
	} );

	it( 'should list blueprints in json format', async () => {
		await runCommand( 'json' );

		expect( mockReportKeyValuePair ).toHaveBeenCalledWith(
			'blueprints',
			JSON.stringify( testBlueprints )
		);
	} );

	it( 'should throw when offline', async () => {
		vi.mocked( isOnline ).mockResolvedValue( false );

		await expect( runCommand( 'table' ) ).rejects.toThrow( 'internet connection' );
	} );

	it( 'should handle empty blueprint list', async () => {
		vi.mocked( fetchStudioBlueprints ).mockResolvedValue( [] );

		await runCommand( 'table' );

		// Should not throw
	} );

	it( 'should output empty json array when no blueprints', async () => {
		vi.mocked( fetchStudioBlueprints ).mockResolvedValue( [] );

		await runCommand( 'json' );

		expect( mockReportKeyValuePair ).toHaveBeenCalledWith( 'blueprints', '[]' );
	} );

	it( 'should filter by category', async () => {
		await runCommand( 'json', 'ecommerce' );

		expect( mockReportKeyValuePair ).toHaveBeenCalledWith(
			'blueprints',
			JSON.stringify( [ testBlueprints[ 1 ] ] )
		);
	} );

	it( 'should filter by category case-insensitively', async () => {
		await runCommand( 'json', 'Ecommerce' );

		expect( mockReportKeyValuePair ).toHaveBeenCalledWith(
			'blueprints',
			JSON.stringify( [ testBlueprints[ 1 ] ] )
		);
	} );

	it( 'should return empty results for non-matching category', async () => {
		await runCommand( 'json', 'nonexistent' );

		expect( mockReportKeyValuePair ).toHaveBeenCalledWith( 'blueprints', '[]' );
	} );

	it( 'should pass locale from shared config', async () => {
		vi.mocked( readSharedConfig ).mockResolvedValue( { version: 1, locale: 'fr_FR' } );

		await runCommand( 'table' );

		expect( fetchStudioBlueprints ).toHaveBeenCalledWith( 'fr_FR' );
	} );
} );
