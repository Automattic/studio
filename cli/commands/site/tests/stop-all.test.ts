import { SiteData, clearSiteLatestCliPid, readAppdata } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { runCommand } from '../stop-all';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	readAppdata: jest.fn(),
	clearSiteLatestCliPid: jest.fn(),
	updateSiteAutoStart: jest.fn().mockResolvedValue( undefined ),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/site-utils' );
jest.mock( 'cli/lib/wordpress-server-manager' );

describe( 'CLI: studio site stop-all', () => {
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
		it( 'should throw when appdata cannot be read', async () => {
			( readAppdata as jest.Mock ).mockRejectedValue( new Error( 'Failed to read appdata' ) );

			await expect( runCommand( false ) ).rejects.toThrow( 'Failed to read appdata' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when PM2 connection fails', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			await expect( runCommand( false ) ).rejects.toThrow( 'PM2 connection failed' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when all sites fail to stop', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );
			( stopWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server stop failed' ) );

			await expect( runCommand( false ) ).rejects.toThrow( 'Failed to stop all (3) sites' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when some sites fail to stop', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			( stopWordPressServer as jest.Mock )
				.mockResolvedValueOnce( undefined ) // site-1 success
				.mockRejectedValueOnce( new Error( 'Server stop failed' ) ) // site-2 fails
				.mockResolvedValueOnce( undefined ); // site-3 success

			await expect( runCommand( false ) ).rejects.toThrow( 'Stopped 2 sites out of 3' );
			expect( disconnect ).toHaveBeenCalled();
			expect( stopWordPressServer ).toHaveBeenCalledTimes( 3 );
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should handle empty sites list', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: [] } );

			await runCommand( false );

			expect( connect ).not.toHaveBeenCalled();
			expect( stopWordPressServer ).not.toHaveBeenCalled();
		} );

		it( 'should skip if no sites are running', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );

			( isServerRunning as jest.Mock ).mockResolvedValue( undefined );

			await runCommand( false );

			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledTimes( 3 );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( clearSiteLatestCliPid ).not.toHaveBeenCalled();
			expect( stopProxyIfNoSitesNeedIt ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle single site', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: [ testSites[ 0 ] ] } );
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( false );

			expect( stopWordPressServer ).toHaveBeenCalledTimes( 1 );
			expect( stopWordPressServer ).toHaveBeenCalledWith( 'site-1' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should stop all running sites', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( false );

			expect( readAppdata ).toHaveBeenCalled();
			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledTimes( 3 );
			expect( isServerRunning ).toHaveBeenCalledWith( 'site-1' );
			expect( isServerRunning ).toHaveBeenCalledWith( 'site-2' );
			expect( isServerRunning ).toHaveBeenCalledWith( 'site-3' );

			expect( stopWordPressServer ).toHaveBeenCalledTimes( 3 );
			expect( stopWordPressServer ).toHaveBeenCalledWith( 'site-1' );
			expect( stopWordPressServer ).toHaveBeenCalledWith( 'site-2' );
			expect( stopWordPressServer ).toHaveBeenCalledWith( 'site-3' );

			expect( clearSiteLatestCliPid ).toHaveBeenCalledTimes( 3 );
			expect( clearSiteLatestCliPid ).toHaveBeenCalledWith( 'site-1' );
			expect( clearSiteLatestCliPid ).toHaveBeenCalledWith( 'site-2' );
			expect( clearSiteLatestCliPid ).toHaveBeenCalledWith( 'site-3' );

			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalledWith(
				[ 'site-1', 'site-2', 'site-3' ],
				expect.any( Object )
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should stop only running sites (mixed state)', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );

			( isServerRunning as jest.Mock )
				.mockResolvedValueOnce( testProcessDescription ) // site-1 running
				.mockResolvedValueOnce( undefined ) // site-2 not running
				.mockResolvedValueOnce( testProcessDescription ); // site-3 running

			await runCommand( false );

			expect( isServerRunning ).toHaveBeenCalledTimes( 3 );

			expect( stopWordPressServer ).toHaveBeenCalledTimes( 2 );
			expect( stopWordPressServer ).toHaveBeenCalledWith( 'site-1' );
			expect( stopWordPressServer ).toHaveBeenCalledWith( 'site-3' );
			expect( stopWordPressServer ).not.toHaveBeenCalledWith( 'site-2' );

			expect( clearSiteLatestCliPid ).toHaveBeenCalledTimes( 2 );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should continue stopping other sites even if one fails', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			( stopWordPressServer as jest.Mock )
				.mockResolvedValueOnce( undefined ) // site-1 success
				.mockRejectedValueOnce( new Error( 'Server stop failed' ) ) // site-2 fails
				.mockResolvedValueOnce( undefined ); // site-3 success

			try {
				await runCommand( false );
			} catch {
				// Expected to throw due to partial failure
			}

			expect( stopWordPressServer ).toHaveBeenCalledTimes( 3 );
			expect( clearSiteLatestCliPid ).toHaveBeenCalledTimes( 2 );
			expect( clearSiteLatestCliPid ).toHaveBeenCalledWith( 'site-1' );
			expect( clearSiteLatestCliPid ).toHaveBeenCalledWith( 'site-3' );
			expect( clearSiteLatestCliPid ).not.toHaveBeenCalledWith( 'site-2' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when proxy stop fails', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: [ testSites[ 0 ] ] } );
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );
			( stopProxyIfNoSitesNeedIt as jest.Mock ).mockRejectedValue(
				new Error( 'Proxy stop failed' )
			);

			// Should throw when proxy stop fails
			await expect( runCommand( false ) ).rejects.toThrow( 'Failed to stop proxy server' );

			expect( stopWordPressServer ).toHaveBeenCalledWith( 'site-1' );
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Cleanup', () => {
		it( 'should always disconnect from PM2 on success', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			await runCommand( false );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should always disconnect from PM2 on error', async () => {
			( readAppdata as jest.Mock ).mockRejectedValue( new Error( 'Error' ) );

			try {
				await runCommand( false );
			} catch {
				// Expected
			}

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should always disconnect when no sites exist', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: [] } );

			await runCommand( false );

			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should always disconnect when no sites are running', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( { sites: testSites } );
			( isServerRunning as jest.Mock ).mockResolvedValue( undefined );

			await runCommand( false );

			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
