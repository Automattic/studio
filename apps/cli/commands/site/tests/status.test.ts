import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { vi } from 'vitest';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import {
	getFrontendLogPaths,
	getSiteFrontendUrl,
	isFrontendRunning,
} from 'cli/lib/frontend/server';
import { getSiteEmailDirectory } from 'cli/lib/site-email';
import { getPrettyPath } from 'cli/lib/utils';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { runCommand } from '../status';
vi.mock( 'cli/lib/cli-config/sites', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/sites' );
	return {
		...actual,
		getSiteByFolder: vi.fn(),
		getSiteUrl: vi.fn(),
	};
} );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/wordpress-server-manager' );
vi.mock( 'cli/lib/frontend/server' );
vi.mock( '@studio/common/lib/get-wordpress-version' );

describe( 'CLI: studio site status', () => {
	// Simple test data
	const testSite = {
		id: 'site-1',
		name: 'Test Site',
		path: '/path/to/site',
		port: 8080,
		phpVersion: '8.0',
		// createPassword returns a Base64-encoded string
		adminPassword: btoa( 'password123' ),
	};

	const testSiteWithoutOptional: Partial< typeof testSite > = {
		id: 'site-1',
		name: 'Test Site',
		path: '/path/to/site',
		port: 8080,
		adminPassword: undefined,
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
		vi.mocked( getSiteUrl ).mockReturnValue( 'http://localhost:8080' );
		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
		vi.mocked( getWordPressVersion ).mockReturnValue( '6.4' );
		vi.mocked( isFrontendRunning ).mockResolvedValue( undefined );
		vi.mocked( getSiteFrontendUrl ).mockReturnValue( 'http://localhost:4321' );
		vi.mocked( getFrontendLogPaths ).mockReturnValue( {
			out: '/logs/studio-frontend-site-1-out-20261031.log',
			error: '/logs/studio-frontend-site-1-error-20261031.log',
		} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when site not found', async () => {
			vi.mocked( getSiteByFolder ).mockRejectedValue( new Error( 'Site not found' ) );

			await expect( runCommand( '/invalid/path', 'table' ) ).rejects.toThrow( 'Site not found' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should output JSON format correctly', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						siteUrl: 'http://localhost:8080/',
						sitePath: '/path/to/site',
						emailPath: getPrettyPath( getSiteEmailDirectory( 'site-1' ) ),
						status: '🔴 Offline',
						isOnline: false,
						type: 'WordPress',
						phpVersion: '8.0',
						fileAccess: 'Site directory',
						wpVersion: '6.4',
						xdebug: 'Disabled',
						adminUsername: 'admin',
					},
					null,
					2
				)
			);

			consoleSpy.mockRestore();
		} );

		it( 'omits secret credential fields from status JSON', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'json' );

			const stdout = String( consoleSpy.mock.calls[ 0 ][ 0 ] );
			const parsed = JSON.parse( stdout ) as Record< string, unknown >;

			expect( parsed ).not.toHaveProperty( 'adminPassword' );
			expect( stdout ).not.toContain( 'password123' );
			expect( parsed ).toMatchObject( {
				siteUrl: 'http://localhost:8080/',
				sitePath: '/path/to/site',
				phpVersion: '8.0',
				wpVersion: '6.4',
				adminUsername: 'admin',
			} );

			consoleSpy.mockRestore();
		} );

		it( 'should show online status when server is running', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( {
				name: 'test-site',
				pmId: 0,
				status: 'online',
				pid: 12345,
			} );

			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						siteUrl: 'http://localhost:8080/',
						autoLoginUrl: 'http://localhost:8080/studio-auto-login?redirect_to=%2Fwp-admin%2F',
						sitePath: '/path/to/site',
						emailPath: getPrettyPath( getSiteEmailDirectory( 'site-1' ) ),
						status: '🟢 Online',
						isOnline: true,
						type: 'WordPress',
						phpVersion: '8.0',
						fileAccess: 'Site directory',
						wpVersion: '6.4',
						xdebug: 'Disabled',
						adminUsername: 'admin',
					},
					null,
					2
				)
			);

			consoleSpy.mockRestore();
		} );

		it( 'should report the file access', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( {
				...testSite,
				fileAccess: 'all-files',
			} );

			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).not.toHaveBeenCalledWith( expect.stringContaining( '"runtime"' ) );
			expect( consoleSpy ).toHaveBeenCalledWith(
				expect.stringContaining( '"fileAccess": "All files"' )
			);

			consoleSpy.mockRestore();
		} );

		it( 'should handle missing optional site properties', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( testSiteWithoutOptional as typeof testSite );

			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					{
						siteUrl: 'http://localhost:8080/',
						sitePath: '/path/to/site',
						emailPath: getPrettyPath( getSiteEmailDirectory( 'site-1' ) ),
						status: '🔴 Offline',
						isOnline: false,
						type: 'WordPress',
						fileAccess: 'Site directory',
						wpVersion: '6.4',
						xdebug: 'Disabled',
						adminUsername: 'admin',
					},
					null,
					2
				)
			);

			consoleSpy.mockRestore();
		} );

		it( 'reports the frontend of a headless site', async () => {
			vi.mocked( getSiteByFolder ).mockResolvedValue( {
				...testSite,
				frontend: {
					path: '/path/to/frontend',
					kind: 'command',
					framework: 'astro',
					devCommand: 'npm run dev',
					port: 4321,
				},
			} );
			vi.mocked( isFrontendRunning ).mockResolvedValue( {
				name: 'studio-frontend-site-1',
				pmId: 1,
				status: 'online',
				pid: 23456,
			} );

			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'json' );

			const parsed = JSON.parse( String( consoleSpy.mock.calls[ 0 ][ 0 ] ) );
			expect( parsed ).toMatchObject( {
				type: 'Headless',
				frontendUrl: 'http://localhost:4321',
				frontendFramework: 'Astro',
				frontendStatus: '🟢 Online',
				isFrontendOnline: true,
				frontendPath: '/path/to/frontend',
				frontendLogPath: '/logs/studio-frontend-site-1-out-20261031.log',
				frontendErrorLogPath: '/logs/studio-frontend-site-1-error-20261031.log',
			} );
			expect( isFrontendRunning ).toHaveBeenCalledWith( 'site-1' );

			consoleSpy.mockRestore();
		} );

		it( 'does not report frontend fields for a classic site', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( '/path/to/site', 'json' );

			const stdout = String( consoleSpy.mock.calls[ 0 ][ 0 ] );
			expect( stdout ).not.toContain( 'frontend' );
			expect( isFrontendRunning ).not.toHaveBeenCalled();

			consoleSpy.mockRestore();
		} );
	} );
} );
