import { SiteData, clearSiteLatestCliPid, getSiteByFolder } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
	getSiteByFolder: jest.fn(),
	clearSiteLatestCliPid: jest.fn(),
	getSiteUrl: jest.fn( ( site ) => `http://localhost:${ site.port }` ),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/site-utils' );
jest.mock( 'cli/lib/wordpress-server-manager' );
jest.mock( 'cli/logger' );

describe( 'Site Stop Command', () => {
	const mockSiteFolder = '/test/site/path';
	const mockSiteData: SiteData = {
		id: 'test-site-id',
		name: 'Test Site',
		path: mockSiteFolder,
		port: 8881,
		adminUsername: 'admin',
		adminPassword: 'password123',
		running: true,
		phpVersion: '8.0',
		url: `http://localhost:8881`,
	};

	const mockProcessDescription = {
		name: 'test-site-id',
		pmId: 0,
		status: 'online',
		pid: 12345,
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
		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockReturnValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( undefined );
		( stopWordPressServer as jest.Mock ).mockResolvedValue( undefined );
		( clearSiteLatestCliPid as jest.Mock ).mockResolvedValue( undefined );
		( stopProxyIfNoSitesNeedIt as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Handling', () => {
		it( 'should handle site not found error', async () => {
			( getSiteByFolder as jest.Mock ).mockRejectedValue( new Error( 'Site not found' ) );

			const { runCommand } = await import( '../stop' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle PM2 connection failure', async () => {
			( getSiteByFolder as jest.Mock ).mockResolvedValue( mockSiteData );
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			const { runCommand } = await import( '../stop' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportError ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle WordPress server stop failure', async () => {
			( getSiteByFolder as jest.Mock ).mockResolvedValue( mockSiteData );
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );
			( stopWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server stop failed' ) );

			const { runCommand } = await import( '../stop' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportStart ).toHaveBeenCalledWith(
				'stopSite',
				'Stopping WordPress site...'
			);
			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should report that site is not running if server is not running', async () => {
			( getSiteByFolder as jest.Mock ).mockResolvedValue( mockSiteData );
			( isServerRunning as jest.Mock ).mockResolvedValue( undefined );

			const { runCommand } = await import( '../stop' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'WordPress site is not running' );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( clearSiteLatestCliPid ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should stop a running site', async () => {
			( getSiteByFolder as jest.Mock ).mockResolvedValue( mockSiteData );
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../stop' );
			await runCommand( mockSiteFolder );

			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( mockLogger.reportStart ).toHaveBeenCalledWith(
				'stopSite',
				'Stopping WordPress site...'
			);
			expect( stopWordPressServer ).toHaveBeenCalledWith( mockSiteData.id );
			expect( clearSiteLatestCliPid ).toHaveBeenCalledWith( mockSiteData.id );
			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'WordPress site stopped' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should call stopProxyIfNoSitesNeedIt after stopping a site', async () => {
			( getSiteByFolder as jest.Mock ).mockResolvedValue( mockSiteData );
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../stop' );
			await runCommand( mockSiteFolder );

			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalledWith( mockSiteData.id, mockLogger );
		} );

		it( 'should not call stopProxyIfNoSitesNeedIt if site is not running', async () => {
			( getSiteByFolder as jest.Mock ).mockResolvedValue( mockSiteData );
			( isServerRunning as jest.Mock ).mockResolvedValue( undefined );

			const { runCommand } = await import( '../stop' );
			await runCommand( mockSiteFolder );

			expect( stopProxyIfNoSitesNeedIt ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'Cleanup', () => {
		it( 'should disconnect from PM2 even on error', async () => {
			( getSiteByFolder as jest.Mock ).mockRejectedValue( new Error( 'Site error' ) );

			const { runCommand } = await import( '../stop' );
			await runCommand( mockSiteFolder );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should disconnect from PM2 on success', async () => {
			( getSiteByFolder as jest.Mock ).mockResolvedValue( mockSiteData );
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../stop' );
			await runCommand( mockSiteFolder );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should disconnect from PM2 even if server was not running', async () => {
			( getSiteByFolder as jest.Mock ).mockResolvedValue( mockSiteData );
			( isServerRunning as jest.Mock ).mockResolvedValue( undefined );

			const { runCommand } = await import( '../stop' );
			await runCommand( mockSiteFolder );

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
