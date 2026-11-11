import { vi } from 'vitest';
import { SiteData, readCliConfig, saveCliConfig } from 'cli/lib/cli-config/core';
import { clearSiteLatestCliPid, getSiteByFolder } from 'cli/lib/cli-config/sites';
import {
	connectToDaemon,
	disconnectFromDaemon,
	killDaemonAndChildren,
} from 'cli/lib/daemon-client';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import {
	getRunningSiteCount,
	isServerRunning,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
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
// Run the command body directly: these suites cover the command, not the
// operation guard (lib/tests/site-operations.test.ts does that). Spreading the real module keeps
// any other export real rather than silently stubbing it.
vi.mock( 'cli/lib/site-operations', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/site-operations') >() ),
	withSiteOperation: ( _folder: string, _kind: string, fn: () => unknown ) => fn(),
} ) );
vi.mock( 'cli/lib/site-utils' );
vi.mock( 'cli/lib/wordpress-server-manager' );
vi.mock( 'cli/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('cli/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );

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
		vi.mocked( getRunningSiteCount ).mockResolvedValue( 0 );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
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

		it( 'records a site-stop Tracks event with the remaining running-site count', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );
			vi.mocked( getRunningSiteCount ).mockResolvedValue( 2 );

			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site' );

			expect( recordTracksEvent ).toHaveBeenCalledWith(
				TRACKS_EVENTS.SITE_STOP,
				expect.objectContaining( { running_site_count: 2 } )
			);
		} );

		it( 'does not record a site-stop Tracks event when the site is not running', async () => {
			await runCommand( Mode.STOP_SINGLE_SITE, '/test/site' );

			expect( recordTracksEvent ).not.toHaveBeenCalled();
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
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
		vi.mocked( killDaemonAndChildren ).mockResolvedValue( undefined );
		vi.mocked( clearSiteLatestCliPid ).mockResolvedValue( undefined );
		vi.mocked( getRunningSiteCount ).mockResolvedValue( 0 );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Success Cases', () => {
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

			// One event per stopped site, with the remaining count decrementing to 0.
			expect( recordTracksEvent ).toHaveBeenCalledTimes( 3 );
			expect( recordTracksEvent ).toHaveBeenNthCalledWith(
				1,
				TRACKS_EVENTS.SITE_STOP,
				expect.objectContaining( { running_site_count: 2 } )
			);
			expect( recordTracksEvent ).toHaveBeenNthCalledWith(
				2,
				TRACKS_EVENTS.SITE_STOP,
				expect.objectContaining( { running_site_count: 1 } )
			);
			expect( recordTracksEvent ).toHaveBeenNthCalledWith(
				3,
				TRACKS_EVENTS.SITE_STOP,
				expect.objectContaining( { running_site_count: 0 } )
			);

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
