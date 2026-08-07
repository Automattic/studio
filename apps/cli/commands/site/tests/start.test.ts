import { SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { vi } from 'vitest';
import { SiteData } from 'cli/lib/cli-config/core';
import { getSiteByFolder, updateSiteLatestCliPid } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import { isServerRunning, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';
import { runCommand } from '../start';

vi.mock( 'cli/lib/cli-config/sites', async () => ( {
	...( await vi.importActual( 'cli/lib/cli-config/sites' ) ),
	getSiteByFolder: vi.fn(),
	updateSiteLatestCliPid: vi.fn(),
} ) );
vi.mock( 'cli/lib/daemon-client' );
// Pass through the lease: these suites cover the command, not the lock
// (lib/tests/site-lock.test.ts does that). Spreading the real module keeps
// any other export real rather than silently stubbing it.
vi.mock( 'cli/lib/site-lock', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/site-lock') >() ),
	withSiteLock: ( _folder: string, _kind: string, fn: () => unknown ) => fn(),
} ) );
vi.mock( 'cli/lib/site-utils' );
vi.mock( 'cli/lib/wordpress-server-manager' );
vi.mock( 'cli/lib/sqlite-integration' );

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
		status: 'ready',
	};

	const testSiteWithDomain: SiteData = {
		...testSite,
		customDomain: 'test.local',
	};

	const testProcessDescription: ProcessDescription = {
		name: 'test-site',
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
		vi.mocked( setupCustomDomain ).mockResolvedValue( undefined );
		vi.mocked( keepSqliteIntegrationUpdated ).mockResolvedValue( undefined );
		vi.mocked( startWordPressServer ).mockResolvedValue( testProcessDescription );
		vi.mocked( updateSiteLatestCliPid ).mockResolvedValue( undefined );
		vi.mocked( logSiteDetails ).mockImplementation( () => {} );
		vi.mocked( openSiteInBrowser ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when site not found', async () => {
			vi.mocked( getSiteByFolder ).mockRejectedValue( new Error( 'Site not found' ) );

			await expect( runCommand( '/invalid/path' ) ).rejects.toThrow( 'Site not found' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should refuse to start a site whose pull is still in progress', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( { ...testSite, status: 'pulling' } );

			await expect( runCommand( '/test/site' ) ).rejects.toThrow( /not ready to start/ );
			// It bails before touching the server.
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should refuse to start a site whose last pull failed', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( { ...testSite, status: 'pull-failed' } );

			await expect( runCommand( '/test/site' ) ).rejects.toThrow( /not ready to start/ );
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when process manager connection fails', async () => {
			vi.mocked( connectToDaemon ).mockRejectedValue(
				new Error( 'process manager connection failed' )
			);

			await expect( runCommand( '/test/site' ) ).rejects.toThrow(
				'process manager connection failed'
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when WordPress server fails to start', async () => {
			vi.mocked( startWordPressServer ).mockRejectedValue( new Error( 'Server start failed' ) );

			await expect( runCommand( '/test/site' ) ).rejects.toThrow(
				'Failed to start WordPress server'
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when custom domain setup fails', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( testSiteWithDomain );
			vi.mocked( setupCustomDomain ).mockRejectedValue(
				new Error( ' Custom domain setup failed' )
			);

			await expect( runCommand( '/test/site' ) ).rejects.toThrow( 'Custom domain setup failed' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when SQLite integration setup fails', async () => {
			vi.mocked( keepSqliteIntegrationUpdated ).mockRejectedValue(
				new Error( 'SQLite setup failed' )
			);

			await expect( runCommand( '/test/site' ) ).rejects.toThrow( 'SQLite setup failed' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when browser fails', async () => {
			vi.mocked( openSiteInBrowser ).mockRejectedValue( new Error( 'Browser error' ) );

			await expect( runCommand( '/test/site' ) ).rejects.toThrow( 'Browser error' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should throw when browser fails while already running', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );
			vi.mocked( openSiteInBrowser ).mockRejectedValue( new Error( 'Browser error' ) );

			await expect( runCommand( '/test/site' ) ).rejects.toThrow( 'Browser error' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should start a basic site', async () => {
			await runCommand( '/test/site' );

			expect( getSiteByFolder ).toHaveBeenCalledWith( '/test/site' );
			expect( connectToDaemon ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( setupCustomDomain ).toHaveBeenCalledWith( testSite, expect.any( Logger ) );
			expect( keepSqliteIntegrationUpdated ).toHaveBeenCalledWith( '/test/site' );
			expect( startWordPressServer ).toHaveBeenCalledWith( testSite, expect.any( Logger ) );
			expect( logSiteDetails ).toHaveBeenCalledWith( testSite );
			expect( openSiteInBrowser ).toHaveBeenCalledWith( testSite );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should skip server start if already running', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( '/test/site' );

			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( setupCustomDomain ).not.toHaveBeenCalled();
			expect( updateSiteLatestCliPid ).toHaveBeenCalledWith(
				testSite.id,
				testProcessDescription.pid
			);
			expect( openSiteInBrowser ).toHaveBeenCalledWith( testSite );
			expect( logSiteDetails ).toHaveBeenCalledWith( testSite );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should setup custom domain when present', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( testSiteWithDomain );

			await runCommand( '/test/site' );

			expect( setupCustomDomain ).toHaveBeenCalledWith( testSiteWithDomain, expect.any( Logger ) );
			expect( startWordPressServer ).toHaveBeenCalledWith(
				testSiteWithDomain,
				expect.any( Logger )
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();
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
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should skip browser when already running and skipBrowser is true', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( '/test/site', true );

			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( openSiteInBrowser ).not.toHaveBeenCalled();
			expect( logSiteDetails ).toHaveBeenCalledWith( testSite );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );
} );
