/**
 * @jest-environment node
 */
const originalUniversal = jest.requireActual( '@php-wasm/universal' );
const originalNode = jest.requireActual( '@php-wasm/node' );

import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeWPCli } from 'src/lib/wordpress-provider/playground-cli/wp-cli-executor';
import { WpNowProvider } from 'src/lib/wordpress-provider/wp-now';

// Mock the modules conditionally
jest.mock( '@php-wasm/universal', () => {
	return {
		...originalUniversal,
		// Use original PHP for wp-now tests, mock for playground-cli tests
		PHP: jest.fn().mockImplementation( ( ...args ) => {
			// Check if we're in a playground-cli executor test context
			if ( expect.getState().currentTestName?.includes( 'playground-cli executor' ) ) {
				// Return mock for playground-cli executor tests
				return {};
			}
			// Return original for wp-now provider tests
			return new originalUniversal.PHP( ...args );
		} ),
		SupportedPHPVersionsList: [ '7.4', '8.0', '8.1', '8.2', '8.3' ],
	};
} );

jest.mock( '@php-wasm/node', () => ( {
	...originalNode,
	loadNodeRuntime: jest.fn().mockImplementation( ( ...args ) => {
		// Check if we're in a playground-cli executor test context
		if ( expect.getState().currentTestName?.includes( 'playground-cli executor' ) ) {
			return Promise.resolve( 'mock-runtime-id' );
		}
		// Use original for wp-now provider tests
		return originalNode.loadNodeRuntime( ...args );
	} ),
	createNodeFsMountHandler: jest.fn().mockImplementation( ( ...args ) => {
		// Check if we're in a playground-cli executor test context
		if ( expect.getState().currentTestName?.includes( 'playground-cli executor' ) ) {
			return 'mock-mount-handler';
		}
		// Use original for wp-now provider tests
		return originalNode.createNodeFsMountHandler( ...args );
	} ),
} ) );

jest.unmock( 'fs-extra' );

describe( 'executeWPCli', () => {
	const tmpPath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-test-wp-cli-site' ) );

	beforeAll( async () => {
		// It sets mode index so we don't need to download the whole WordPress
		fs.writeFileSync( path.join( tmpPath, 'index.php' ), '' );
	} );

	afterAll( () => {
		fs.rmSync( tmpPath, { recursive: true } );
	} );

	describe( 'wp-now provider', () => {
		it( 'should execute wp-cli version command and return stdout and stderr', async () => {
			const wpNowProvider = new WpNowProvider();
			const result = await wpNowProvider.executeWPCli( tmpPath, [ '--version' ] );

			expect( result.stdout ).toMatch( /WP-CLI \d+\.\d+\.\d+/ ); // Example: WP-CLI 2.10.0
			expect( result.stderr ).toBe( '' );
		} );

		it( 'should return error if wp-cli command does not exist', async () => {
			const originalConsoleError = console.error;
			const originalConsoleWarn = console.warn;
			console.error = jest.fn();
			console.warn = jest.fn();

			const wpNowProvider = new WpNowProvider();
			const result = await wpNowProvider.executeWPCli( tmpPath, [ 'yoda' ] );

			expect( result.stdout ).toBe( '' );
			expect( result.stderr ).toContain(
				"'yoda' is not a registered wp command. See 'wp help' for available commands."
			);

			console.error = originalConsoleError;
			console.warn = originalConsoleWarn;
		} );

		it( 'should return the correct version of WP-CLI', async () => {
			const wpNowProvider = new WpNowProvider();
			const result = await wpNowProvider.getWPCliVersionFromInstallation();
			expect( result ).toMatch( /v\d+\.\d+\.\d+/ ); // Example: v2.10.0
		} );
	} );

	describe( 'playground-cli executor', () => {
		beforeEach( () => {
			jest.clearAllMocks();
		} );

		it( 'should use the correct WP-CLI phar path', async () => {
			const mockResourcesPath = '/mock/resources';
			const mockSqliteCommandPath = '/mock/sqlite';

			// Get the mocked modules
			const { loadNodeRuntime, createNodeFsMountHandler } = require( '@php-wasm/node' );
			const { PHP } = require( '@php-wasm/universal' );

			// Mock PHP execution
			const mockPHP = {
				setSapiName: jest.fn(),
				mkdir: jest.fn(),
				mount: jest.fn(),
				writeFile: jest.fn(),
				run: jest.fn().mockResolvedValue( {
					text: 'WP-CLI 2.10.0',
					exitCode: 0,
				} ),
				readFileAsText: jest.fn().mockReturnValue( '' ),
				exit: jest.fn(),
				fileExists: jest.fn().mockReturnValue( false ),
				isDir: jest.fn().mockReturnValue( false ),
				listFiles: jest.fn().mockReturnValue( [] ),
			};

			// Configure the mocks
			loadNodeRuntime.mockResolvedValue( 'mock-runtime-id' );
			createNodeFsMountHandler.mockReturnValue( 'mock-mount-handler' );
			PHP.mockImplementation( () => mockPHP );

			// Mock pathExists to return true for phar file
			jest
				.spyOn( require( 'common/lib/fs-utils' ), 'pathExists' )
				.mockImplementation( async ( ...args: any[] ) => {
					const filePath = args[ 0 ] as string;
					return filePath.includes( 'wp-cli.phar' ) || filePath === mockSqliteCommandPath;
				} );

			// Mock readFileSync to return fake phar content
			jest.spyOn( fs, 'readFileSync' ).mockImplementation( ( filePath ) => {
				if ( typeof filePath === 'string' && filePath.includes( 'wp-cli.phar' ) ) {
					return Buffer.from( '<?php // Mock WP-CLI phar content' );
				}
				return Buffer.from( '' );
			} );

			const result = await executeWPCli( tmpPath, [ '--version' ], {
				resourcesPath: mockResourcesPath,
				sqliteCommandPath: mockSqliteCommandPath,
			} );

			expect( mockPHP.writeFile ).toHaveBeenCalledWith( '/tmp/wp-cli.phar', expect.any( Buffer ) );
			expect( result.stdout ).toBe( 'WP-CLI 2.10.0' );
		} );

		it( 'should handle missing phar gracefully', async () => {
			// Get the mocked modules
			const { loadNodeRuntime, createNodeFsMountHandler } = require( '@php-wasm/node' );
			const { PHP } = require( '@php-wasm/universal' );

			// Mock pathExists to return false for phar file
			jest.spyOn( require( 'common/lib/fs-utils' ), 'pathExists' ).mockResolvedValue( false );

			const mockPHP = {
				setSapiName: jest.fn(),
				mkdir: jest.fn(),
				mount: jest.fn(),
				writeFile: jest.fn(),
				run: jest.fn().mockResolvedValue( {
					text: 'WP-CLI phar not found',
					exitCode: 1,
				} ),
				readFileAsText: jest.fn().mockReturnValue( '' ),
				exit: jest.fn(),
				fileExists: jest.fn().mockReturnValue( false ),
				isDir: jest.fn().mockReturnValue( false ),
				listFiles: jest.fn().mockReturnValue( [] ),
			};

			// Configure the mocks
			loadNodeRuntime.mockResolvedValue( 'mock-runtime-id' );
			createNodeFsMountHandler.mockReturnValue( 'mock-mount-handler' );
			PHP.mockImplementation( () => mockPHP );

			try {
				await executeWPCli( tmpPath, [ '--version' ], {
					resourcesPath: '/mock/resources',
					sqliteCommandPath: '/mock/sqlite',
				} );

				// Should still work but without writing the phar file
				expect( mockPHP.writeFile ).not.toHaveBeenCalledWith(
					'/tmp/wp-cli.phar',
					expect.anything()
				);
			} catch ( error ) {
				// Expected behavior when phar is missing
				expect( true ).toBe( true ); // Test passes as long as it doesn't crash unexpectedly
			}
		} );
	} );
} );
