import { vi } from 'vitest';
import { SiteData } from 'cli/lib/cli-config/core';
import { getSiteByFolder, updateSiteLatestCliPid } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import {
	getSiteFrontendUrl,
	isFrontendRunning,
	startFrontendServer,
} from 'cli/lib/frontend/server';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import { isServerRunning, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { runCommand } from '../start';

vi.mock( 'cli/lib/cli-config/sites', async () => ( {
	...( await vi.importActual( 'cli/lib/cli-config/sites' ) ),
	getSiteByFolder: vi.fn(),
	updateSiteLatestCliPid: vi.fn(),
} ) );
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
vi.mock( 'cli/lib/sqlite-integration' );
vi.mock( 'cli/lib/frontend/server' );

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

	const testProcessDescription: ProcessDescription = {
		name: 'test-site',
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
		vi.mocked( setupCustomDomain ).mockResolvedValue( undefined );
		vi.mocked( keepSqliteIntegrationUpdated ).mockResolvedValue( undefined );
		vi.mocked( startWordPressServer ).mockResolvedValue( testProcessDescription );
		vi.mocked( updateSiteLatestCliPid ).mockResolvedValue( undefined );
		vi.mocked( logSiteDetails ).mockImplementation( () => {} );
		vi.mocked( openSiteInBrowser ).mockResolvedValue( undefined );
		vi.mocked( isFrontendRunning ).mockResolvedValue( undefined );
		vi.mocked( startFrontendServer ).mockResolvedValue( testProcessDescription );
		vi.mocked( getSiteFrontendUrl ).mockReturnValue( 'http://localhost:4321' );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
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

		it( 'should throw when WordPress server fails to start', async () => {
			vi.mocked( startWordPressServer ).mockRejectedValue( new Error( 'Server start failed' ) );

			await expect( runCommand( '/test/site' ) ).rejects.toThrow(
				'Failed to start WordPress server'
			);
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
			expect( startWordPressServer ).toHaveBeenCalledWith(
				testSite,
				expect.any( Logger ),
				'start'
			);
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

		it( 'should skip browser when skipBrowser is true', async () => {
			await runCommand( '/test/site', true );

			expect( startWordPressServer ).toHaveBeenCalledWith(
				testSite,
				expect.any( Logger ),
				'start'
			);
			expect( openSiteInBrowser ).not.toHaveBeenCalled();
			expect( logSiteDetails ).toHaveBeenCalledWith( testSite );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Headless sites', () => {
		const headlessSite: SiteData = {
			...testSite,
			frontend: { path: '/test/frontend', kind: 'static', port: 4321 },
		};

		beforeEach( () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( headlessSite );
		} );

		it( 'does not start a frontend for a classic site', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );

			await runCommand( '/test/site' );

			expect( startFrontendServer ).not.toHaveBeenCalled();
		} );

		it( 'starts the frontend after WordPress', async () => {
			await runCommand( '/test/site' );

			expect( startFrontendServer ).toHaveBeenCalledWith( headlessSite, expect.any( Logger ) );
			expect( vi.mocked( startWordPressServer ).mock.invocationCallOrder[ 0 ] ).toBeLessThan(
				vi.mocked( startFrontendServer ).mock.invocationCallOrder[ 0 ]
			);
			expect( vi.mocked( startFrontendServer ).mock.invocationCallOrder[ 0 ] ).toBeLessThan(
				vi.mocked( openSiteInBrowser ).mock.invocationCallOrder[ 0 ]
			);
		} );

		it( 'reports a "Starting frontend…" step', async () => {
			const logger = new Logger< string >();
			const reportStart = vi.spyOn( logger, 'reportStart' ).mockImplementation( () => {} );
			vi.spyOn( logger, 'reportSuccess' ).mockImplementation( () => {} );

			await runCommand( '/test/site', true, true, logger );

			expect( reportStart ).toHaveBeenCalledWith( 'startFrontend', 'Starting frontend…' );
		} );

		it( 'starts the frontend when WordPress is already running', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( '/test/site' );

			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( startFrontendServer ).toHaveBeenCalledWith( headlessSite, expect.any( Logger ) );
		} );

		it( 'leaves a running frontend alone', async () => {
			vi.mocked( isFrontendRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( '/test/site' );

			expect( startFrontendServer ).not.toHaveBeenCalled();
		} );

		it( 'fails the start when the frontend fails, without blaming WordPress', async () => {
			vi.mocked( startFrontendServer ).mockRejectedValue(
				new LoggerError( 'Failed to start the frontend' )
			);

			const error = await runCommand( '/test/site' ).catch( ( caught: Error ) => caught );
			expect( error ).toBeInstanceOf( LoggerError );
			expect( ( error as Error ).message ).toBe( 'Failed to start the frontend' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );
} );
