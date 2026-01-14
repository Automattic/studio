import {
	SiteData,
	clearSiteLatestCliPid,
	getSiteByFolder,
	readAppdata,
	saveAppdata,
	updateSiteAutoStart,
} from 'cli/lib/appdata';
import { connect, disconnect, killDaemonAndAllChildren } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Mode, runCommand } from '../stop';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getSiteByFolder: jest.fn(),
	readAppdata: jest.fn(),
	clearSiteLatestCliPid: jest.fn(),
	updateSiteAutoStart: jest.fn().mockResolvedValue( undefined ),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
	saveAppdata: jest.fn().mockResolvedValue( undefined ),
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
		( killDaemonAndAllChildren as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when site not found', async () => {
			( getSiteByFolder as jest.Mock ).mockRejectedValue( new Error( 'Site not found' ) );

			await expect( runCommand( Mode.STOP_SINGLE_SITE, '/invalid/path', false ) ).rejects.toThrow(
				'Site not found'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when PM2 connection fails', async () => {
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			await expect( runCommand( Mode.STOP_SINGLE_SITE, '/test/site', false ) ).rejects.toThrow(
				'PM2 connection failed'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when WordPress server stop fails', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );
			( stopWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server stop failed' ) );

			await expect( runCommand( Mode.STOP_SINGLE_SITE, '/test/site', false ) ).rejects.toThrow(
				'Failed to stop WordPress server'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should skip stop if server is not running', async () => {
			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site', false );

			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( clearSiteLatestCliPid ).not.toHaveBeenCalled();
			expect( stopProxyIfNoSitesNeedIt ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should stop a running site', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site', false );

			expect( getSiteByFolder ).toHaveBeenCalledWith( '/test/site' );
			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
			expect( clearSiteLatestCliPid ).toHaveBeenCalledWith( testSite.id );
			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalledWith( testSite.id, expect.any( Object ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should not call stopProxyIfNoSitesNeedIt if site is not running', async () => {
			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site', false );

			expect( stopProxyIfNoSitesNeedIt ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should set autoStart to true when flag is passed', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site', true );

			expect( updateSiteAutoStart ).toHaveBeenCalledWith( testSite.id, true );
		} );

		it( 'should set autoStart to false when flag is not passed', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site', false );

			expect( updateSiteAutoStart ).toHaveBeenCalledWith( testSite.id, false );
		} );
	} );

	describe( 'Cleanup', () => {
		it( 'should always disconnect from PM2 on success', async () => {
			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site', false );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should always disconnect from PM2 on error', async () => {
			( getSiteByFolder as jest.Mock ).mockRejectedValue( new Error( 'Error' ) );

			try {
				await runCommand( Mode.STOP_SINGLE_SITE, '/test/site', false );
			} catch {
				// Expected
			}

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should always disconnect when site is not running', async () => {
			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site', false );

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );

describe( 'CLI: studio site stop --all', () => {
	const testSites: SiteData[] = [
		{
			id: 'site-1',
			name: 'Test Site 1',
			path: '/test/site1',
			port: 8080,
			phpVersion: '8.0',
			adminUsername: 'admin',
			adminPassword: 'password123',
		},
		{
			id: 'site-2',
			name: 'Test Site 2',
			path: '/test/site2',
			port: 8081,
			phpVersion: '8.1',
			adminUsername: 'admin',
			adminPassword: 'password456',
		},
		{
			id: 'site-3',
			name: 'Test Site 3',
			path: '/test/site3',
			port: 8082,
			phpVersion: '8.2',
			adminUsername: 'admin',
			adminPassword: 'password789',
		},
	];

	const testProcessDescription = {
		pid: 12345,
		status: 'online',
	};

	beforeEach( () => {
		jest.clearAllMocks();

		// Mock process.exit to prevent tests from exiting
		jest.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );

		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockResolvedValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( undefined );
		( killDaemonAndAllChildren as jest.Mock ).mockResolvedValue( undefined );
		( clearSiteLatestCliPid as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when appdata cannot be read', async () => {
			( readAppdata as jest.Mock ).mockRejectedValue( new Error( 'Failed to read appdata' ) );

			await expect( runCommand( Mode.STOP_ALL_SITES, undefined, false ) ).rejects.toThrow(
				'Failed to read appdata'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when PM2 connection fails', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			await expect( runCommand( Mode.STOP_ALL_SITES, undefined, false ) ).rejects.toThrow(
				'PM2 connection failed'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when killDaemonAndAllChildren fails', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );
			( killDaemonAndAllChildren as jest.Mock ).mockRejectedValue(
				new Error( 'Failed to kill daemon' )
			);

			await expect( runCommand( Mode.STOP_ALL_SITES, undefined, false ) ).rejects.toThrow(
				'Failed to kill daemon'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should handle empty sites list', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: [] } );

			await runCommand( Mode.STOP_ALL_SITES, undefined, false );

			expect( connect ).toHaveBeenCalled();
			expect( killDaemonAndAllChildren ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should skip if no sites are running', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );

			( isServerRunning as jest.Mock ).mockResolvedValue( undefined );

			await runCommand( Mode.STOP_ALL_SITES, undefined, false );

			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledTimes( 3 );
			expect( killDaemonAndAllChildren ).not.toHaveBeenCalled();
			expect( clearSiteLatestCliPid ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle single site', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: [ testSites[ 0 ] ] } );
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( Mode.STOP_ALL_SITES, undefined, false );

			expect( killDaemonAndAllChildren ).toHaveBeenCalledTimes( 1 );
			expect( saveAppdata ).toHaveBeenCalledTimes( 1 );
			expect( saveAppdata ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							id: 'site-1',
							autoStart: false,
						} ),
					] ),
				} )
			);
			expect( process.exit ).toHaveBeenCalledWith( 0 );
		} );

		it( 'should stop all running sites', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( Mode.STOP_ALL_SITES, undefined, false );

			expect( readAppdata ).toHaveBeenCalled();
			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledTimes( 3 );
			expect( isServerRunning ).toHaveBeenCalledWith( 'site-1' );
			expect( isServerRunning ).toHaveBeenCalledWith( 'site-2' );
			expect( isServerRunning ).toHaveBeenCalledWith( 'site-3' );

			expect( killDaemonAndAllChildren ).toHaveBeenCalledTimes( 1 );

			expect( saveAppdata ).toHaveBeenCalledTimes( 1 );
			expect( saveAppdata ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							id: 'site-1',
							autoStart: false,
						} ),
						expect.objectContaining( {
							id: 'site-2',
							autoStart: false,
						} ),
						expect.objectContaining( {
							id: 'site-3',
							autoStart: false,
						} ),
					] ),
				} )
			);

			expect( process.exit ).toHaveBeenCalledWith( 0 );
		} );

		it( 'should stop only running sites (mixed state)', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );

			( isServerRunning as jest.Mock )
				.mockResolvedValueOnce( testProcessDescription ) // site-1 running
				.mockResolvedValueOnce( undefined ) // site-2 not running
				.mockResolvedValueOnce( testProcessDescription ); // site-3 running

			await runCommand( Mode.STOP_ALL_SITES, undefined, true );

			expect( isServerRunning ).toHaveBeenCalledTimes( 3 );

			expect( killDaemonAndAllChildren ).toHaveBeenCalledTimes( 1 );

			expect( saveAppdata ).toHaveBeenCalledTimes( 1 );
			expect( saveAppdata ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							id: 'site-1',
							autoStart: true,
						} ),
						expect.objectContaining( {
							id: 'site-3',
							autoStart: true,
						} ),
					] ),
				} )
			);
			expect( saveAppdata ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.not.arrayContaining( [
						expect.objectContaining( {
							id: 'site-2',
							autoStart: true,
						} ),
					] ),
				} )
			);

			expect( process.exit ).toHaveBeenCalledWith( 0 );
		} );
	} );
} );
