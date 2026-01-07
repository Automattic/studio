import {
	SiteData,
	clearSiteLatestCliPid,
	getSiteByFolder,
	updateSiteAutoStart,
} from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { runCommand } from '../stop';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getSiteByFolder: jest.fn(),
	clearSiteLatestCliPid: jest.fn(),
	updateSiteAutoStart: jest.fn().mockResolvedValue( undefined ),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/site-utils' );
jest.mock( 'cli/lib/wordpress-server-manager' );

describe( 'CLI: studio site stop', () => {
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

			await expect( runCommand( '/invalid/path', false ) ).rejects.toThrow( 'Site not found' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when PM2 connection fails', async () => {
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			await expect( runCommand( '/test/site', false ) ).rejects.toThrow( 'PM2 connection failed' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when WordPress server stop fails', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );
			( stopWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server stop failed' ) );

			await expect( runCommand( '/test/site', false ) ).rejects.toThrow(
				'Failed to stop WordPress server'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should skip stop if server is not running', async () => {
			await runCommand( '/test/site', false );

			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( clearSiteLatestCliPid ).not.toHaveBeenCalled();
			expect( stopProxyIfNoSitesNeedIt ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should stop a running site', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( '/test/site', false );

			expect( getSiteByFolder ).toHaveBeenCalledWith( '/test/site' );
			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
			expect( clearSiteLatestCliPid ).toHaveBeenCalledWith( testSite.id );
			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalledWith( testSite.id, expect.any( Object ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should not call stopProxyIfNoSitesNeedIt if site is not running', async () => {
			await runCommand( '/test/site', false );

			expect( stopProxyIfNoSitesNeedIt ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should set autoStart to true when flag is passed', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( '/test/site', true );

			expect( updateSiteAutoStart ).toHaveBeenCalledWith( testSite.id, true );
		} );

		it( 'should set autoStart to false when flag is not passed', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( '/test/site', false );

			expect( updateSiteAutoStart ).toHaveBeenCalledWith( testSite.id, false );
		} );
	} );

	describe( 'Cleanup', () => {
		it( 'should always disconnect from PM2 on success', async () => {
			await runCommand( '/test/site', false );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should always disconnect from PM2 on error', async () => {
			( getSiteByFolder as jest.Mock ).mockRejectedValue( new Error( 'Error' ) );

			try {
				await runCommand( '/test/site', false );
			} catch {
				// Expected
			}

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should always disconnect when site is not running', async () => {
			await runCommand( '/test/site', false );

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
