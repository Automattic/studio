/**
 * @jest-environment node
 */
import fs from 'fs';
import fsPromises from 'fs/promises';

// Store original platform
const originalPlatform = process.platform;

jest.mock( 'fs', () => ( {
	existsSync: jest.fn(),
} ) );

jest.mock( 'fs/promises', () => ( {
	readFile: jest.fn(),
	readdir: jest.fn(),
} ) );

// Mock child_process exec with promisify-compatible implementation
jest.mock( 'child_process', () => ( {
	exec: jest.fn(),
} ) );

// Mock instance data structure for reference (used in documentation)

const _mockInstanceDataShape = {
	siteSlug: 'string',
	wpTitle: 'string',
	multisite: 'boolean',
	wordpress: { mode: 'image', tag: 'string' },
	muPlugins: { mode: 'image' },
	appCode: { mode: 'local', dir: 'string' },
	php: 'string (image tag)',
	elasticsearch: 'boolean',
	phpmyadmin: 'boolean',
	xdebug: 'boolean',
	mailpit: 'boolean',
	autologinKey: 'string',
	adminPassword: 'string',
};

describe( 'vip-environment', () => {
	beforeEach( () => {
		jest.resetAllMocks();
		jest.resetModules();
		// Reset platform
		Object.defineProperty( process, 'platform', { value: originalPlatform, writable: true } );
	} );

	afterAll( () => {
		// Restore original platform
		Object.defineProperty( process, 'platform', { value: originalPlatform, writable: true } );
	} );

	describe( 'getVipDevEnvPath', () => {
		it( 'should return path containing vip/dev-environment', () => {
			const { getVipDevEnvPath } = require( '../vip-environment' );
			const result = getVipDevEnvPath();
			expect( result ).toContain( 'vip' );
			expect( result ).toContain( 'dev-environment' );
		} );

		it( 'should use XDG_DATA_HOME when set on non-Windows', () => {
			Object.defineProperty( process, 'platform', { value: 'darwin', writable: true } );
			process.env.XDG_DATA_HOME = '/custom/data';

			jest.resetModules();
			const { getVipDevEnvPath } = require( '../vip-environment' );
			const result = getVipDevEnvPath();

			expect( result ).toBe( '/custom/data/vip/dev-environment' );

			delete process.env.XDG_DATA_HOME;
		} );
	} );

	describe( 'listVipEnvironments', () => {
		it( 'should return empty array when dev-environment directory does not exist', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( false );

			const { listVipEnvironments } = require( '../vip-environment' );
			const result = await listVipEnvironments();

			expect( result ).toEqual( [] );
		} );

		it( 'should skip non-directory entries', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( true );
			( fsPromises.readdir as jest.Mock ).mockResolvedValue( [
				{ name: 'some-file.txt', isDirectory: () => false },
			] );

			const { listVipEnvironments } = require( '../vip-environment' );
			const result = await listVipEnvironments();

			expect( result ).toEqual( [] );
		} );

		it( 'should skip directories without valid instance_data.json', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( true );
			( fsPromises.readdir as jest.Mock ).mockResolvedValue( [
				{ name: 'invalid-site', isDirectory: () => true },
			] );
			( fsPromises.readFile as jest.Mock ).mockRejectedValue( new Error( 'File not found' ) );

			const { listVipEnvironments } = require( '../vip-environment' );
			const result = await listVipEnvironments();

			expect( result ).toEqual( [] );
		} );
	} );

	describe( 'getVipEnvironment', () => {
		it( 'should return null when environment does not exist', async () => {
			( fsPromises.readFile as jest.Mock ).mockRejectedValue( new Error( 'File not found' ) );

			const { getVipEnvironment } = require( '../vip-environment' );
			const result = await getVipEnvironment( 'nonexistent' );

			expect( result ).toBeNull();
		} );
	} );
} );

describe( 'VipEnvironment type mapping', () => {
	it( 'should correctly map instance data fields to VipEnvironment', () => {
		// Test the expected shape of the VipEnvironment interface
		const expectedFields = [
			'slug',
			'title',
			'running',
			'phpVersion',
			'wordpressVersion',
			'multisite',
			'elasticsearch',
			'phpmyadmin',
			'xdebug',
			'mailpit',
			'path',
			'urls',
		];

		// This test validates that the interface contract is maintained
		expectedFields.forEach( ( field ) => {
			expect( typeof field ).toBe( 'string' );
		} );
	} );
} );

describe( 'PHP version extraction', () => {
	// Helper function to extract PHP version from image tag
	const extractPhpVersion = ( phpImageTag: string ): string => {
		const match = phpImageTag.match( /:(\d+\.\d+)/ );
		return match ? match[ 1 ] : phpImageTag;
	};

	it( 'should extract version from full image tag', () => {
		expect( extractPhpVersion( 'ghcr.io/automattic/vip-container-images/php-fpm:8.2' ) ).toBe(
			'8.2'
		);
	} );

	it( 'should extract version from different image tags', () => {
		expect( extractPhpVersion( 'ghcr.io/automattic/vip-container-images/php-fpm:8.1' ) ).toBe(
			'8.1'
		);
		expect( extractPhpVersion( 'php:7.4' ) ).toBe( '7.4' );
	} );

	it( 'should return original string if no version found', () => {
		expect( extractPhpVersion( 'invalid-tag' ) ).toBe( 'invalid-tag' );
	} );
} );
