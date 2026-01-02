import {
	getSiteByFolder,
	updateSiteLatestCliPid,
	updateSiteAutoStart,
	SiteData,
} from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { isServerRunning, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';
import { runCommand } from '../start';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getSiteByFolder: jest.fn(),
	updateSiteLatestCliPid: jest.fn(),
	updateSiteAutoStart: jest.fn().mockResolvedValue( undefined ),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/site-utils' );
jest.mock( 'cli/lib/wordpress-server-manager' );
jest.mock( 'cli/lib/sqlite-integration' );

describe( 'CLI: studio site start', () => {
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

	const testSiteWithDomain: SiteData = {
		...testSite,
		customDomain: 'test.local',
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
		( setupCustomDomain as jest.Mock ).mockResolvedValue( undefined );
		( keepSqliteIntegrationUpdated as jest.Mock ).mockResolvedValue( undefined );
		( startWordPressServer as jest.Mock ).mockResolvedValue( testProcessDescription );
		( updateSiteLatestCliPid as jest.Mock ).mockResolvedValue( undefined );
		( logSiteDetails as jest.Mock ).mockImplementation( () => {} );
		( openSiteInBrowser as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when site not found', async () => {
			( getSiteByFolder as jest.Mock ).mockRejectedValue( new Error( 'Site not found' ) );

			await expect( runCommand( '/invalid/path' ) ).rejects.toThrow( 'Site not found' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when PM2 connection fails', async () => {
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			await expect( runCommand( '/test/site' ) ).rejects.toThrow( 'PM2 connection failed' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when WordPress server fails to start', async () => {
			( startWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server start failed' ) );

			await expect( runCommand( '/test/site' ) ).rejects.toThrow(
				'Failed to start WordPress server'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when custom domain setup fails', async () => {
			( getSiteByFolder as jest.Mock ).mockResolvedValue( testSiteWithDomain );
			( setupCustomDomain as jest.Mock ).mockRejectedValue(
				new Error( ' Custom domain setup failed' )
			);

			await expect( runCommand( '/test/site' ) ).rejects.toThrow( 'Custom domain setup failed' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when SQLite integration setup fails', async () => {
			( keepSqliteIntegrationUpdated as jest.Mock ).mockRejectedValue(
				new Error( 'SQLite setup failed' )
			);

			await expect( runCommand( '/test/site' ) ).rejects.toThrow( 'SQLite setup failed' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when browser fails', async () => {
			( openSiteInBrowser as jest.Mock ).mockRejectedValue( new Error( 'Browser error' ) );

			await expect( runCommand( '/test/site' ) ).rejects.toThrow( 'Browser error' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when browser fails while already running', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );
			( openSiteInBrowser as jest.Mock ).mockRejectedValue( new Error( 'Browser error' ) );

			await expect( runCommand( '/test/site' ) ).rejects.toThrow( 'Browser error' );
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should start a basic site', async () => {
			await runCommand( '/test/site' );

			expect( getSiteByFolder ).toHaveBeenCalledWith( '/test/site' );
			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( setupCustomDomain ).toHaveBeenCalledWith( testSite, expect.any( Logger ) );
			expect( keepSqliteIntegrationUpdated ).toHaveBeenCalledWith( '/test/site' );
			expect( startWordPressServer ).toHaveBeenCalledWith( testSite, expect.any( Logger ) );
			expect( updateSiteLatestCliPid ).toHaveBeenCalledWith(
				testSite.id,
				testProcessDescription.pid
			);
			expect( updateSiteAutoStart ).toHaveBeenCalledWith( testSite.id, true );
			expect( logSiteDetails ).toHaveBeenCalledWith( testSite );
			expect( openSiteInBrowser ).toHaveBeenCalledWith( testSite );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should skip server start if already running', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( '/test/site' );

			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( setupCustomDomain ).not.toHaveBeenCalled();
			expect( updateSiteLatestCliPid ).toHaveBeenCalledWith(
				testSite.id,
				testProcessDescription.pid
			);
			expect( openSiteInBrowser ).toHaveBeenCalledWith( testSite );
			expect( logSiteDetails ).toHaveBeenCalledWith( testSite );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should setup custom domain when present', async () => {
			( getSiteByFolder as jest.Mock ).mockResolvedValue( testSiteWithDomain );

			await runCommand( '/test/site' );

			expect( setupCustomDomain ).toHaveBeenCalledWith( testSiteWithDomain, expect.any( Logger ) );
			expect( startWordPressServer ).toHaveBeenCalledWith(
				testSiteWithDomain,
				expect.any( Logger )
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should update SQLite integration', async () => {
			await runCommand( '/test/site' );

			expect( keepSqliteIntegrationUpdated ).toHaveBeenCalledWith( '/test/site' );
		} );

		it( 'should skip browser when skipBrowser is true', async () => {
			await runCommand( '/test/site', true );

			expect( startWordPressServer ).toHaveBeenCalledWith( testSite, expect.any( Logger ) );
			expect( openSiteInBrowser ).not.toHaveBeenCalled();
			expect( logSiteDetails ).toHaveBeenCalledWith( testSite );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should skip browser when already running and skipBrowser is true', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( '/test/site', true );

			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( openSiteInBrowser ).not.toHaveBeenCalled();
			expect( logSiteDetails ).toHaveBeenCalledWith( testSite );
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
