import { SiteData, clearSiteLatestCliPid, getSiteByFolder } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getSiteByFolder: jest.fn(),
	clearSiteLatestCliPid: jest.fn(),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/site-utils' );
jest.mock( 'cli/lib/wordpress-server-manager' );

describe( 'Site Stop Command', () => {
	// Simple test data
	const testSite: SiteData = {
		id: 'site-1',
		name: 'Test Site',
		path: '/test/site',
		port: 8080,
		phpVersion: '8.0',
		adminUsername: 'admin',
		adminPassword: 'password123',
	};

	const testProcessDescription = {
		pid: 12345,
		status: 'online',
	};

	beforeEach( () => {
		jest.clearAllMocks();

		( getSiteByFolder as jest.Mock ).mockResolvedValue( testSite );
		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockResolvedValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( undefined );
		( stopWordPressServer as jest.Mock ).mockResolvedValue( undefined );
		( clearSiteLatestCliPid as jest.Mock ).mockResolvedValue( undefined );
		( stopProxyIfNoSitesNeedIt as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when site not found', async () => {
			( getSiteByFolder as jest.Mock ).mockRejectedValue( new Error( 'Site not found' ) );

			const { runCommand } = await import( '../stop' );

			await expect( runCommand( '/invalid/path' ) ).rejects.toThrow( 'Site not found' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when PM2 connection fails', async () => {
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			const { runCommand } = await import( '../stop' );

			await expect( runCommand( '/test/site' ) ).rejects.toThrow( 'PM2 connection failed' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when WordPress server stop fails', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );
			( stopWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server stop failed' ) );

			const { runCommand } = await import( '../stop' );

			await expect( runCommand( '/test/site' ) ).rejects.toThrow(
				'Failed to stop WordPress server'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should skip stop if server is not running', async () => {
			const { runCommand } = await import( '../stop' );

			await runCommand( '/test/site' );

			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( clearSiteLatestCliPid ).not.toHaveBeenCalled();
			expect( stopProxyIfNoSitesNeedIt ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should stop a running site', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			const { runCommand } = await import( '../stop' );

			await runCommand( '/test/site' );

			expect( getSiteByFolder ).toHaveBeenCalledWith( '/test/site', false );
			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
			expect( clearSiteLatestCliPid ).toHaveBeenCalledWith( testSite.id );
			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalledWith( testSite.id, expect.any( Object ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should not call stopProxyIfNoSitesNeedIt if site is not running', async () => {
			const { runCommand } = await import( '../stop' );

			await runCommand( '/test/site' );

			expect( stopProxyIfNoSitesNeedIt ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Cleanup', () => {
		it( 'should always disconnect from PM2 on success', async () => {
			const { runCommand } = await import( '../stop' );

			await runCommand( '/test/site' );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should always disconnect from PM2 on error', async () => {
			( getSiteByFolder as jest.Mock ).mockRejectedValue( new Error( 'Error' ) );

			const { runCommand } = await import( '../stop' );

			try {
				await runCommand( '/test/site' );
			} catch {
				// Expected
			}

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should always disconnect when site is not running', async () => {
			const { runCommand } = await import( '../stop' );

			await runCommand( '/test/site' );

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
