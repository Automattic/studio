import { getWordPressVersion } from 'common/lib/get-wordpress-version';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getSiteByFolder: jest.fn(),
	getSiteUrl: jest.fn(),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/wordpress-server-manager' );
jest.mock( 'common/lib/get-wordpress-version' );
jest.mock( 'cli/lib/utils', () => ( {
	getPrettyPath: ( path: string ) => path.replace( /^\//, '' ),
} ) );
jest.mock( 'cli/logger' );

describe( 'Site Status Command', () => {
	const mockSite = {
		id: 'site-1',
		name: 'Test Site',
		path: '/path/to/site',
		port: 8080,
		phpVersion: '8.0',
		adminPassword: 'password123',
	};

	let mockLogger: {
		reportStart: jest.Mock;
		reportSuccess: jest.Mock;
		reportError: jest.Mock;
	};

	beforeEach( () => {
		jest.clearAllMocks();

		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
		};

		( Logger as jest.Mock ).mockReturnValue( mockLogger );
		( getSiteByFolder as jest.Mock ).mockResolvedValue( mockSite );
		( getSiteUrl as jest.Mock ).mockReturnValue( 'http://localhost:8080' );
		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockResolvedValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( false );
		( getWordPressVersion as jest.Mock ).mockReturnValue( '6.4' );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should show site status successfully with table format', async () => {
		const { runCommand } = await import( '../status' );
		await runCommand( '/path/to/site', 'table' );

		expect( getSiteByFolder ).toHaveBeenCalledWith( '/path/to/site', false );
		expect( mockLogger.reportStart ).toHaveBeenCalledWith( expect.any( String ), 'Loading site…' );
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Site loaded' );
		expect( disconnect ).toHaveBeenCalled();
	} );

	it( 'should show site status with json format', async () => {
		const consoleSpy = jest.spyOn( console, 'log' ).mockImplementation();
		const { runCommand } = await import( '../status' );
		await runCommand( '/path/to/site', 'json' );

		expect( getSiteByFolder ).toHaveBeenCalledWith( '/path/to/site', false );
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Site loaded' );
		expect( consoleSpy ).toHaveBeenCalledWith(
			JSON.stringify(
				{
					'Site URL': 'http://localhost:8080/',
					'Site Path': 'path/to/site',
					Status: '🔴 Offline',
					'PHP Version': '8.0',
					'WP Version': '6.4',
					'Admin Username': 'admin',
					'Admin Password': 'password123',
				},
				null,
				2
			)
		);

		consoleSpy.mockRestore();
	} );

	it( 'should show online status when server is running', async () => {
		( isServerRunning as jest.Mock ).mockResolvedValue( true );
		const consoleSpy = jest.spyOn( console, 'log' ).mockImplementation();
		const { runCommand } = await import( '../status' );
		await runCommand( '/path/to/site', 'json' );

		expect( consoleSpy ).toHaveBeenCalledWith(
			JSON.stringify(
				{
					'Site URL': 'http://localhost:8080/',
					'Auto Login URL': 'http://localhost:8080/studio-auto-login?redirect_to=%2Fwp-admin%2F',
					'Site Path': 'path/to/site',
					Status: '🟢 Online',
					'PHP Version': '8.0',
					'WP Version': '6.4',
					'Admin Username': 'admin',
					'Admin Password': 'password123',
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
		const { runCommand } = await import( '../status' );
		await runCommand( '/path/to/site', 'json' );

		expect( consoleSpy ).toHaveBeenCalledWith(
			expect.stringContaining( 'http://my-site.wp.local' )
		);

		consoleSpy.mockRestore();
	} );

	it( 'should handle site not found error', async () => {
		const { runCommand } = await import( '../status' );
		( getSiteByFolder as jest.Mock ).mockRejectedValue( new Error( 'Site not found' ) );

		await runCommand( '/invalid/path', 'table' );

		expect( mockLogger.reportError ).toHaveBeenCalled();
		expect( disconnect ).toHaveBeenCalled();
	} );

	it( 'should handle missing optional site properties', async () => {
		const minimalSite = {
			id: 'site-1',
			path: '/path/to/site',
			adminPassword: undefined,
		};
		( getSiteByFolder as jest.Mock ).mockResolvedValue( minimalSite );

		const consoleSpy = jest.spyOn( console, 'log' ).mockImplementation();
		const { runCommand } = await import( '../status' );
		await runCommand( '/path/to/site', 'json' );

		expect( consoleSpy ).toHaveBeenCalledWith(
			JSON.stringify(
				{
					'Site URL': 'http://localhost:8080/',
					'Site Path': 'path/to/site',
					Status: '🔴 Offline',
					'PHP Version': undefined,
					'WP Version': '6.4',
					'Admin Username': 'admin',
					'Admin Password': undefined,
				},
				null,
				2
			)
		);

		consoleSpy.mockRestore();
	} );
} );
