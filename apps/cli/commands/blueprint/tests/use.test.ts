import { fetchLibraryBlueprints } from '@studio/blueprints';
import { openBlueprint } from '@studio/blueprints/node';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { runCommand } from '../use';

vi.mock( '@studio/common/lib/shared-config' );
vi.mock( '@studio/blueprints' );
vi.mock( '@studio/blueprints/node' );
vi.mock( 'cli/commands/site/create', () => ( {
	runCommand: vi.fn(),
} ) );
vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportStart = vi.fn();
		reportSuccess = vi.fn();
		reportError = vi.fn();
		reportProgress = vi.fn();
		reportWarning = vi.fn();
		reportKeyValuePair = vi.fn();
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
		blueprint: { steps: [] },
	},
	{
		slug: 'woo-shop',
		title: 'WooCommerce Shop',
		excerpt: 'An online store',
		image: 'https://example.com/woo.png',
		playgroundUrl: 'https://playground.wordpress.net/',
		blueprint: { steps: [] },
	},
];

const defaultOptions = {
	enableHttps: false,
	noStart: false,
	skipBrowser: true,
};

describe( 'CLI: studio blueprint use', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( readSharedConfig ).mockResolvedValue( { version: 1 } );
		vi.mocked( fetchLibraryBlueprints ).mockResolvedValue( testBlueprints );
		vi.mocked( openBlueprint ).mockImplementation( async ( source ) => ( {
			blueprint: ( source as ( typeof testBlueprints )[ number ] ).blueprint,
			path: '/tmp/opened/blueprint.json',
			[ Symbol.asyncDispose ]: async () => {},
		} ) );
		vi.mocked( runCreateSiteCommand ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should create a site with the specified blueprint slug', async () => {
		await runCommand( '/tmp/test-site', 'quick-start', defaultOptions );

		expect( runCreateSiteCommand ).toHaveBeenCalledWith(
			'/tmp/test-site',
			expect.objectContaining( {
				blueprint: { contents: { steps: [] }, uri: '/tmp/opened/blueprint.json' },
			} )
		);
	} );

	it( 'should throw when offline', async () => {
		vi.mocked( fetchLibraryBlueprints ).mockRejectedValue( new TypeError( 'fetch failed' ) );

		await expect( runCommand( '/tmp/test-site', 'quick-start', defaultOptions ) ).rejects.toThrow(
			'internet connection'
		);
	} );

	it( 'should throw when no blueprints are available', async () => {
		vi.mocked( fetchLibraryBlueprints ).mockResolvedValue( [] );

		await expect( runCommand( '/tmp/test-site', 'quick-start', defaultOptions ) ).rejects.toThrow(
			'No blueprints available'
		);
	} );

	it( 'should throw when slug is not found', async () => {
		await expect( runCommand( '/tmp/test-site', 'nonexistent', defaultOptions ) ).rejects.toThrow(
			'not found'
		);
	} );

	it( 'should throw in non-interactive mode when no slug provided', async () => {
		const originalIsTTY = process.stdin.isTTY;
		Object.defineProperty( process.stdin, 'isTTY', { value: false, writable: true } );

		await expect( runCommand( '/tmp/test-site', undefined, defaultOptions ) ).rejects.toThrow(
			'slug is required'
		);

		Object.defineProperty( process.stdin, 'isTTY', {
			value: originalIsTTY,
			writable: true,
		} );
	} );

	it( 'should pass locale from shared config when fetching blueprints', async () => {
		vi.mocked( readSharedConfig ).mockResolvedValue( { version: 1, locale: 'de_DE' } );

		await runCommand( '/tmp/test-site', 'quick-start', defaultOptions );

		expect( fetchLibraryBlueprints ).toHaveBeenCalledWith( { locale: 'de_DE' } );
	} );
} );
