import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { vi } from 'vitest';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { runCommand } from '../status';
vi.mock( 'cli/lib/cli-config', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config' );
	return {
		...actual,
		getSiteByFolder: vi.fn(),
		getSiteUrl: vi.fn(),
	};
} );
vi.mock( 'cli/lib/pm2-manager' );
vi.mock( 'cli/lib/wordpress-server-manager' );
vi.mock( '@studio/common/lib/get-wordpress-version' );

describe( 'CLI: studio site status', () => {
	// Simple test data
	const testSite = {
		id: 'site-1',
		name: 'Test Site',
		path: '/path/to/site',
		port: 8080,
		phpVersion: '8.0',
		// createPassword returns a Base64-encoded string
		adminPassword: btoa( 'password123' ),
	};

	const testSiteWithoutOptional: Partial< typeof testSite > = {
		id: 'site-1',
		name: 'Test Site',
		path: '/path/to/site',
		port: 8080,
		adminPassword: undefined,
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
		vi.mocked( getSiteUrl ).mockReturnValue( 'http://localhost:8080' );
		vi.mocked( connect ).mockResolvedValue( undefined );
		vi.mocked( disconnect ).mockResolvedValue( undefined );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
		vi.mocked( getWordPressVersion ).mockReturnValue( '6.4' );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when site not found', async () => {
			vi.mocked( getSiteByFolder ).mockRejectedValue( new Error( 'Site not found' ) );

			await expect( runCommand( '/invalid/path', 'table' ) ).rejects.toThrow( 'Site not found' );
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should display site status with table format', async () => {
			await runCommand( '/path/to/site', 'table' );

			expect( getSiteByFolder ).toHaveBeenCalledWith( '/path/to/site' );
			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should output JSON format correctly', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						siteUrl: 'http://localhost:8080/',
						sitePath: '/path/to/site',
						status: '🔴 Offline',
						phpVersion: '8.0',
						wpVersion: '6.4',
						xdebug: 'Disabled',
						adminUsername: 'admin',
						adminPassword: 'password123',
					},
					null,
					2
				)
			);

			consoleSpy.mockRestore();
		} );

		it( 'should show online status when server is running', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( {
				name: 'test-site',
				pmId: 0,
				status: 'online',
				pid: 12345,
			} );

			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						siteUrl: 'http://localhost:8080/',
						autoLoginUrl: 'http://localhost:8080/studio-auto-login?redirect_to=%2Fwp-admin%2F',
						sitePath: '/path/to/site',
						status: '🟢 Online',
						phpVersion: '8.0',
						wpVersion: '6.4',
						xdebug: 'Disabled',
						adminUsername: 'admin',
						adminPassword: 'password123',
					},
					null,
					2
				)
			);

			consoleSpy.mockRestore();
		} );

		it( 'should handle custom domain in site URL', async () => {
			vi.mocked( getSiteUrl ).mockReturnValue( 'http://my-site.wp.local' );

			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				expect.stringContaining( 'http://my-site.wp.local' )
			);

			consoleSpy.mockRestore();
		} );

		it( 'should handle missing optional site properties', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( testSiteWithoutOptional as typeof testSite );

			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						siteUrl: 'http://localhost:8080/',
						sitePath: '/path/to/site',
						status: '🔴 Offline',
						wpVersion: '6.4',
						xdebug: 'Disabled',
						adminUsername: 'admin',
					},
					null,
					2
				)
			);

			consoleSpy.mockRestore();
		} );
	} );

	describe( 'Cleanup', () => {
		it( 'should always disconnect from PM2 on success', async () => {
			await runCommand( '/path/to/site', 'table' );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should always disconnect from PM2 on error', async () => {
			vi.mocked( getSiteByFolder ).mockRejectedValue( new Error( 'Error' ) );

			try {
				await runCommand( '/path/to/site', 'table' );
			} catch {
				// Expected
			}

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
