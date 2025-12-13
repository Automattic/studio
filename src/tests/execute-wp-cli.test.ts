/**
 * @jest-environment node
 */
const originalUniversal = jest.requireActual( '@php-wasm/universal' );
const originalNode = jest.requireActual( '@php-wasm/node' );

import fs from 'fs';
import os from 'os';
import path from 'path';
import { WpNowProvider } from 'src/lib/wordpress-provider/wp-now';

// Mock the modules - use original implementations for wp-now provider tests
jest.mock( '@php-wasm/universal', () => {
	return {
		...originalUniversal,
		PHP: jest.fn().mockImplementation( ( ...args ) => {
			return new originalUniversal.PHP( ...args );
		} ),
		SupportedPHPVersionsList: [ '7.4', '8.0', '8.1', '8.2', '8.3' ],
	};
} );

jest.mock( '@php-wasm/node', () => ( {
	...originalNode,
	loadNodeRuntime: jest.fn().mockImplementation( ( ...args ) => {
		return originalNode.loadNodeRuntime( ...args );
	} ),
	createNodeFsMountHandler: jest.fn().mockImplementation( ( ...args ) => {
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

} );
