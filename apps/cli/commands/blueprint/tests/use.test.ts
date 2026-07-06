import { isOnline } from '@studio/common/lib/network-utils';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { fetchStudioBlueprints } from '@studio/common/lib/studio-blueprints-api';
import { vol } from 'memfs';
import { vi } from 'vitest';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { runCommand } from '../use';

vi.mock( 'fs' );
vi.mock( '@studio/common/lib/network-utils' );
vi.mock( '@studio/common/lib/shared-config' );
vi.mock( '@studio/common/lib/studio-blueprints-api' );
vi.mock( '@studio/common/lib/blueprint-bundle', () => ( {
	createBlueprintTempDir: vi.fn().mockResolvedValue( '/tmp/studio-blueprint-bundle-mock' ),
	downloadAndExtractBlueprintBundle: vi.fn(),
	removeBlueprintTempDir: vi.fn().mockResolvedValue( undefined ),
} ) );
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
		playground_url: 'https://playground.wordpress.net/',
		blueprint: { steps: [] },
		bundle_url: null,
	},
	{
		slug: 'woo-shop',
		title: 'WooCommerce Shop',
		excerpt: 'An online store',
		image: 'https://example.com/woo.png',
		playground_url: 'https://playground.wordpress.net/',
		blueprint: { steps: [] },
		bundle_url: null,
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
		vi.mocked( isOnline ).mockResolvedValue( true );
		vi.mocked( readSharedConfig ).mockResolvedValue( { version: 1 } );
		vi.mocked( fetchStudioBlueprints ).mockResolvedValue( testBlueprints );
		vi.mocked( runCreateSiteCommand ).mockResolvedValue( undefined );
		// The blueprint JSON is written into the (mocked) temp dir, which must
		// exist in the memfs volume.
		vol.reset();
		vol.mkdirSync( '/tmp/studio-blueprint-bundle-mock', { recursive: true } );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should create a site with the specified blueprint slug', async () => {
		await runCommand( '/tmp/test-site', 'quick-start', defaultOptions );

		expect( runCreateSiteCommand ).toHaveBeenCalledWith(
			'/tmp/test-site',
			expect.objectContaining( {
				blueprint: expect.objectContaining( {
					contents: { steps: [] },
				} ),
			} )
		);
	} );

	it( 'should throw when offline', async () => {
		vi.mocked( isOnline ).mockResolvedValue( false );

		await expect( runCommand( '/tmp/test-site', 'quick-start', defaultOptions ) ).rejects.toThrow(
			'internet connection'
		);
	} );

	it( 'should throw when no blueprints are available', async () => {
		vi.mocked( fetchStudioBlueprints ).mockResolvedValue( [] );

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

	it( 'should pass site creation options to runCreateSiteCommand', async () => {
		await runCommand( '/tmp/test-site', 'quick-start', {
			name: 'My Site',
			wpVersion: '6.5',
			phpVersion: '8.2',
			customDomain: 'mysite.local',
			enableHttps: true,
			adminUsername: 'admin',
			adminPassword: 'secret',
			adminEmail: 'admin@test.com',
			noStart: true,
			skipBrowser: true,
		} );

		expect( runCreateSiteCommand ).toHaveBeenCalledWith(
			'/tmp/test-site',
			expect.objectContaining( {
				name: 'My Site',
				wpVersion: '6.5',
				phpVersion: '8.2',
				customDomain: 'mysite.local',
				enableHttps: true,
				adminUsername: 'admin',
				adminPassword: 'secret',
				adminEmail: 'admin@test.com',
				noStart: true,
				skipBrowser: true,
			} )
		);
	} );

	it( 'should pass locale from shared config when fetching blueprints', async () => {
		vi.mocked( readSharedConfig ).mockResolvedValue( { version: 1, locale: 'de_DE' } );

		await runCommand( '/tmp/test-site', 'quick-start', defaultOptions );

		expect( fetchStudioBlueprints ).toHaveBeenCalledWith( 'de_DE' );
	} );
} );
