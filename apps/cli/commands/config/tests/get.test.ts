import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { runCommand } from '../get';

vi.mock( 'cli/lib/cli-config/sites', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/sites' );
	return {
		...actual,
		getSiteByFolder: vi.fn(),
	};
} );
vi.mock( '@studio/common/lib/get-wordpress-version' );

describe( 'CLI: studio config get', () => {
	const testSite = {
		id: 'site-1',
		name: 'Test Site',
		path: '/path/to/site',
		port: 8080,
		phpVersion: '8.0',
		enableHttps: true,
		customDomain: 'my-site.local',
		enableXdebug: false,
		adminUsername: 'root',
		// btoa-encoded password (decodePassword decodes Base64)
		adminPassword: btoa( 'password123' ),
		adminEmail: 'admin@example.com',
		enableDebugLog: true,
		enableDebugDisplay: false,
	};

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
		vi.mocked( getWordPressVersion ).mockReturnValue( '6.4' );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Single-key lookup', () => {
		it( 'prints a raw string value with no formatting', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'php', 'table' );

			expect( getSiteByFolder ).toHaveBeenCalledWith( '/path/to/site' );
			expect( consoleSpy ).toHaveBeenCalledTimes( 1 );
			expect( consoleSpy ).toHaveBeenCalledWith( '8.0' );
		} );

		it( 'reads the WordPress version from disk', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'wp', 'table' );

			expect( consoleSpy ).toHaveBeenCalledWith( '6.4' );
		} );

		it( 'prints booleans as true/false', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'https', 'table' );

			expect( consoleSpy ).toHaveBeenCalledWith( 'true' );
		} );

		it( 'decodes the admin password', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'admin-password', 'table' );

			expect( consoleSpy ).toHaveBeenCalledWith( 'password123' );
		} );

		it( 'prints an empty line for an unset value', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( {
				...testSite,
				adminEmail: undefined,
			} );
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'admin-email', 'table' );

			expect( consoleSpy ).toHaveBeenCalledWith( '' );
		} );

		it( 'reports the user-facing runtime mode, not the internal runtime', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( {
				...testSite,
				runtime: 'playground',
			} );
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'runtime', 'table' );

			expect( consoleSpy ).toHaveBeenCalledWith( 'sandbox' );
		} );

		it( 'defaults runtime to native when unset', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'runtime', 'table' );

			expect( consoleSpy ).toHaveBeenCalledWith( 'native' );
		} );

		it( 'reports the file access value', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( {
				...testSite,
				fileAccess: 'all-files',
			} );
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'file-access', 'table' );

			expect( consoleSpy ).toHaveBeenCalledWith( 'all-files' );
		} );

		it( 'throws on an unknown key', async () => {
			await expect( runCommand( '/path/to/site', 'nope', 'table' ) ).rejects.toThrow(
				/Unknown config key "nope"/
			);
		} );
	} );

	describe( 'Listing all settings', () => {
		it( 'outputs every settable key as JSON', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', undefined, 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						name: 'Test Site',
						domain: 'my-site.local',
						https: true,
						php: '8.0',
						wp: '6.4',
						runtime: 'native',
						'file-access': 'site-directory',
						xdebug: false,
						'admin-username': 'root',
						'admin-password': 'password123',
						'admin-email': 'admin@example.com',
						'debug-log': true,
						'debug-display': false,
					},
					null,
					2
				)
			);
		} );

		it( 'falls back to defaults for unset values in JSON', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( {
				id: 'site-2',
				name: 'Bare Site',
				path: '/path/to/bare',
				port: 8081,
				phpVersion: '8.2',
			} );
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/bare', undefined, 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						name: 'Bare Site',
						domain: null,
						https: false,
						php: '8.2',
						wp: '6.4',
						runtime: 'native',
						'file-access': 'site-directory',
						xdebug: false,
						'admin-username': 'admin',
						'admin-password': null,
						'admin-email': null,
						'debug-log': false,
						'debug-display': false,
					},
					null,
					2
				)
			);
		} );

		it( 'renders a table by default', async () => {
			const tableSpy = vi.spyOn( console, 'table' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', undefined, 'table' );

			expect( tableSpy ).toHaveBeenCalledTimes( 1 );
		} );
	} );
} );
