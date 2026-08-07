import { SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { vi } from 'vitest';
import { SiteData, readCliConfig, saveCliConfig } from 'cli/lib/cli-config/core';
import { clearSiteLatestCliPid, getSiteByFolder } from 'cli/lib/cli-config/sites';
import {
	connectToDaemon,
	disconnectFromDaemon,
	killDaemonAndChildren,
} from 'cli/lib/daemon-client';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Mode, runCommand } from '../stop';

vi.mock( 'cli/lib/cli-config/core', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/core' );
	return {
		...actual,
		readCliConfig: vi.fn(),
		saveCliConfig: vi.fn().mockResolvedValue( undefined ),
	};
} );
vi.mock( 'cli/lib/cli-config/sites', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/sites' );
	return {
		...actual,
		getSiteByFolder: vi.fn(),
		clearSiteLatestCliPid: vi.fn(),
	};
} );
vi.mock( 'cli/lib/daemon-client' );
// Pass through the lease: these suites cover the command, not the lock
// (lib/tests/site-lock.test.ts does that). Spreading the real module keeps
// any other export real rather than silently stubbing it.
vi.mock( 'cli/lib/site-lock', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/site-lock') >() ),
	withSiteLock: ( _siteId: string, _kind: string, fn: () => unknown ) => fn(),
	withSiteLockByFolder: ( _folder: string, _kind: string, fn: () => unknown ) => fn(),
} ) );
vi.mock( 'cli/lib/site-utils' );
vi.mock( 'cli/lib/wordpress-server-manager' );

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

	const testProcessDescription: ProcessDescription = {
		name: 'studio-site-site-1',
		pmId: 0,
		pid: 12345,
		status: 'online',
		runtime: SITE_RUNTIME_PLAYGROUND,
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
		vi.mocked( stopWordPressServer ).mockResolvedValue( undefined );
		vi.mocked( clearSiteLatestCliPid ).mockResolvedValue( undefined );
		vi.mocked( stopProxyIfNoSitesNeedIt ).mockResolvedValue( undefined );
		vi.mocked( killDaemonAndChildren ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when site not found', async () => {
			vi.mocked( getSiteByFolder ).mockRejectedValue( new Error( 'Site not found' ) );

			await expect( runCommand( Mode.STOP_SINGLE_SITE, '/invalid/path' ) ).rejects.toThrow(
				'Site not found'
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when process manager connection fails', async () => {
			vi.mocked( connectToDaemon ).mockRejectedValue(
				new Error( 'process manager connection failed' )
			);

			await expect( runCommand( Mode.STOP_SINGLE_SITE, '/test/site' ) ).rejects.toThrow(
				'process manager connection failed'
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when WordPress server stop fails', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );
			vi.mocked( stopWordPressServer ).mockRejectedValue( new Error( 'Server stop failed' ) );

			await expect( runCommand( Mode.STOP_SINGLE_SITE, '/test/site' ) ).rejects.toThrow(
				'Failed to stop WordPress server'
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should skip stop if server is not running', async () => {
			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site' );

			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( clearSiteLatestCliPid ).not.toHaveBeenCalled();
			expect( stopProxyIfNoSitesNeedIt ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should stop a running site', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site' );

			expect( getSiteByFolder ).toHaveBeenCalledWith( '/test/site' );
			expect( connectToDaemon ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );
			expect( clearSiteLatestCliPid ).toHaveBeenCalledWith( testSite.id );
			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalledWith( testSite.id, expect.any( Object ) );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should not call stopProxyIfNoSitesNeedIt if site is not running', async () => {
			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site' );

			expect( stopProxyIfNoSitesNeedIt ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Cleanup', () => {
		it( 'should always disconnect from process manager on success', async () => {
			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site' );

			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should always disconnect from process manager on error', async () => {
			vi.mocked( getSiteByFolder ).mockRejectedValue( new Error( 'Error' ) );

			try {
				await runCommand( Mode.STOP_SINGLE_SITE, '/test/site' );
			} catch {
				// Expected
			}

			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should always disconnect when site is not running', async () => {
			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site' );

			expect( disconnectFromDaemon ).toHaveBeenCalled();
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

	const testProcessDescription: ProcessDescription = {
		name: 'studio-site-site-1',
		pmId: 0,
		pid: 12345,
		status: 'online',
		runtime: SITE_RUNTIME_PLAYGROUND,
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
		vi.mocked( killDaemonAndChildren ).mockResolvedValue( undefined );
		vi.mocked( clearSiteLatestCliPid ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when appdata cannot be read', async () => {
			vi.mocked( readCliConfig ).mockRejectedValue( new Error( 'Failed to read appdata' ) );

			await expect( runCommand( Mode.STOP_ALL_SITES, undefined ) ).rejects.toThrow(
				'Failed to read appdata'
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when process manager connection fails', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: testSites,
				snapshots: [],
			} );
			vi.mocked( connectToDaemon ).mockRejectedValue(
				new Error( 'process manager connection failed' )
			);

			await expect( runCommand( Mode.STOP_ALL_SITES, undefined ) ).rejects.toThrow(
				'process manager connection failed'
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when killDaemonAndAllChildren fails', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: testSites,
				snapshots: [],
			} );
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );
			vi.mocked( killDaemonAndChildren ).mockRejectedValue( new Error( 'Failed to kill daemon' ) );

			await expect( runCommand( Mode.STOP_ALL_SITES, undefined ) ).rejects.toThrow(
				'Failed to kill daemon'
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should kill daemon even with empty sites list', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );

			await runCommand( Mode.STOP_ALL_SITES, undefined );

			expect( connectToDaemon ).toHaveBeenCalled();
			expect( killDaemonAndChildren ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'should kill daemon even if no sites are running', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: testSites,
				snapshots: [],
			} );

			vi.mocked( isServerRunning ).mockResolvedValue( undefined );

			await runCommand( Mode.STOP_ALL_SITES, undefined );

			expect( connectToDaemon ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledTimes( 3 );
			expect( killDaemonAndChildren ).toHaveBeenCalledTimes( 1 );
			expect( clearSiteLatestCliPid ).not.toHaveBeenCalled();
		} );

		it( 'should handle single site', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: [ testSites[ 0 ] ],
				snapshots: [],
			} );
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( Mode.STOP_ALL_SITES, undefined );

			expect( killDaemonAndChildren ).toHaveBeenCalledTimes( 1 );
			expect( saveCliConfig ).toHaveBeenCalledTimes( 1 );
			expect( saveCliConfig ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							id: 'site-1',
						} ),
					] ),
				} )
			);
		} );

		it( 'should stop all running sites', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: testSites,
				snapshots: [],
			} );
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( Mode.STOP_ALL_SITES, undefined );

			expect( readCliConfig ).toHaveBeenCalled();
			expect( connectToDaemon ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledTimes( 3 );
			expect( isServerRunning ).toHaveBeenCalledWith( 'site-1' );
			expect( isServerRunning ).toHaveBeenCalledWith( 'site-2' );
			expect( isServerRunning ).toHaveBeenCalledWith( 'site-3' );

			expect( killDaemonAndChildren ).toHaveBeenCalledTimes( 1 );

			expect( saveCliConfig ).toHaveBeenCalledTimes( 1 );
			expect( saveCliConfig ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							id: 'site-1',
						} ),
						expect.objectContaining( {
							id: 'site-2',
						} ),
						expect.objectContaining( {
							id: 'site-3',
						} ),
					] ),
				} )
			);
		} );

		it( 'should stop only running sites (mixed state)', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				version: 1,
				sites: testSites,
				snapshots: [],
			} );

			vi.mocked( isServerRunning )
				.mockResolvedValueOnce( testProcessDescription ) // site-1 running
				.mockResolvedValueOnce( undefined ) // site-2 not running
				.mockResolvedValueOnce( testProcessDescription ); // site-3 running

			await runCommand( Mode.STOP_ALL_SITES, undefined );

			expect( isServerRunning ).toHaveBeenCalledTimes( 3 );

			expect( killDaemonAndChildren ).toHaveBeenCalledTimes( 1 );

			expect( saveCliConfig ).toHaveBeenCalledTimes( 1 );
			expect( saveCliConfig ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( {
							id: 'site-1',
						} ),
						expect.objectContaining( {
							id: 'site-3',
						} ),
					] ),
				} )
			);
		} );
	} );
} );
