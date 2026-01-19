import { getWordPressVersion } from 'common/lib/get-wordpress-version';
import { getSiteByFolder, getSiteUrl, isXdebugBetaEnabled } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { runCommand } from '../status';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getSiteByFolder: jest.fn(),
	getSiteUrl: jest.fn(),
	isXdebugBetaEnabled: jest.fn(),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/wordpress-server-manager' );
jest.mock( 'common/lib/get-wordpress-version' );

describe( 'CLI: studio site status', () => {
	// Simple test data
	// adminPassword is stored as Base64-encoded, so we use btoa('password123')
	const testSite = {
		id: 'site-1',
		name: 'Test Site',
		path: '/path/to/site',
		port: 8080,
		phpVersion: '8.0',
		adminPassword: 'cGFzc3dvcmQxMjM=', // btoa('password123')
	};

	const testSiteWithoutOptional = {
		id: 'site-1',
		path: '/path/to/site',
		adminPassword: undefined,
	};

	beforeEach( () => {
		jest.clearAllMocks();

		( getSiteByFolder as jest.Mock ).mockResolvedValue( testSite );
		( getSiteUrl as jest.Mock ).mockReturnValue( 'http://localhost:8080' );
		( isXdebugBetaEnabled as jest.Mock ).mockResolvedValue( true );
		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockResolvedValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( false );
		( getWordPressVersion as jest.Mock ).mockReturnValue( '6.4' );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when site not found', async () => {
			( getSiteByFolder as jest.Mock ).mockRejectedValue( new Error( 'Site not found' ) );

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
			const consoleSpy = jest.spyOn( console, 'log' ).mockImplementation();

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						'Site URL': 'http://localhost:8080/',
						'Site Path': '/path/to/site',
						Status: '🔴 Offline',
						'PHP version': '8.0',
						'WP version': '6.4',
						Xdebug: 'Disabled',
						'Admin username': 'admin',
						'Admin password': 'password123',
					},
					null,
					2
				)
			);

			consoleSpy.mockRestore();
		} );

		it( 'should show online status when server is running', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( { pid: 12345 } );

			const consoleSpy = jest.spyOn( console, 'log' ).mockImplementation();

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						'Site URL': 'http://localhost:8080/',
						'Auto-login URL': 'http://localhost:8080/studio-auto-login?redirect_to=%2Fwp-admin%2F',
						'Site Path': '/path/to/site',
						Status: '🟢 Online',
						'PHP version': '8.0',
						'WP version': '6.4',
						Xdebug: 'Disabled',
						'Admin username': 'admin',
						'Admin password': 'password123',
					},
					null,
					2
				)
			);

			consoleSpy.mockRestore();
		} );

		it( 'should handle custom domain in site URL', async () => {
			( getSiteUrl as jest.Mock ).mockReturnValue( 'http://my-site.wp.local' );

			const consoleSpy = jest.spyOn( console, 'log' ).mockImplementation();

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				expect.stringContaining( 'http://my-site.wp.local' )
			);

			consoleSpy.mockRestore();
		} );

		it( 'should handle missing optional site properties', async () => {
			( getSiteByFolder as jest.Mock ).mockResolvedValue( testSiteWithoutOptional );

			const consoleSpy = jest.spyOn( console, 'log' ).mockImplementation();

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						'Site URL': 'http://localhost:8080/',
						'Site Path': '/path/to/site',
						Status: '🔴 Offline',
						'WP version': '6.4',
						Xdebug: 'Disabled',
						'Admin username': 'admin',
					},
					null,
					2
				)
			);

			consoleSpy.mockRestore();
		} );

		it( 'should hide xdebug when beta feature is disabled', async () => {
			( isXdebugBetaEnabled as jest.Mock ).mockResolvedValue( false );

			const consoleSpy = jest.spyOn( console, 'log' ).mockImplementation();

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						'Site URL': 'http://localhost:8080/',
						'Site Path': '/path/to/site',
						Status: '🔴 Offline',
						'PHP version': '8.0',
						'WP version': '6.4',
						'Admin username': 'admin',
						'Admin password': 'password123',
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
			( getSiteByFolder as jest.Mock ).mockRejectedValue( new Error( 'Error' ) );

			try {
				await runCommand( '/path/to/site', 'table' );
			} catch {
				// Expected
			}

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
