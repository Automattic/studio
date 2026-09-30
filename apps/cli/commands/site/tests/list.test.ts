import { vi } from 'vitest';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { connectToDaemon, disconnectFromDaemon, listProcesses } from 'cli/lib/daemon-client';
import { SITE_LIST_PUBLIC_FIELDS } from 'cli/lib/site-public-fields';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { mockReportKeyValuePair } from 'cli/tests/test-utils';
import { runCommand } from '../list';

vi.mock( 'cli/lib/cli-config/core', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/core' );
	return {
		...actual,
		readCliConfig: vi.fn(),
	};
} );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/wordpress-server-manager' );
vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportStart = vi.fn();
		reportSuccess = vi.fn();
		reportError = vi.fn();
		reportProgress = vi.fn();
		reportWarning = vi.fn();
		reportKeyValuePair = mockReportKeyValuePair;
		spinner = {};
		currentAction = null;
	},
	LoggerError: class extends Error {},
} ) );

describe( 'CLI: studio site list', () => {
	const testCliConfig = {
		version: 1 as const,
		sites: [
			{
				id: 'site-1',
				name: 'Test Site 1',
				path: '/path/to/site1',
				port: 8080,
				phpVersion: '8.0',
			},
			{
				id: 'site-2',
				name: 'Test Site 2',
				path: '/path/to/site2',
				port: 8081,
				phpVersion: '8.0',
				customDomain: 'my-site.wp.local',
			},
		],
		snapshots: [],
	};

	const emptyCliConfig = {
		version: 1 as const,
		sites: [],
		snapshots: [],
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( readCliConfig ).mockResolvedValue( testCliConfig );
		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
		vi.mocked( listProcesses ).mockResolvedValue( [] );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when config read fails', async () => {
			vi.mocked( readCliConfig ).mockRejectedValue( new Error( 'Failed to read config' ) );

			await expect( runCommand( 'table' ) ).rejects.toThrow( 'Failed to read config' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should list sites with table format', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( 'table' );

			expect( readCliConfig ).toHaveBeenCalled();
			expect( consoleSpy ).toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();

			consoleSpy.mockRestore();
		} );

		it( 'should list sites with json format', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( 'json' );

			const publicSites = [
				{
					id: 'site-1',
					name: 'Test Site 1',
					path: '/path/to/site1',
					port: 8080,
					phpVersion: '8.0',
					url: 'http://localhost:8080',
					running: false,
				},
				{
					id: 'site-2',
					name: 'Test Site 2',
					path: '/path/to/site2',
					port: 8081,
					phpVersion: '8.0',
					customDomain: 'my-site.wp.local',
					url: 'http://my-site.wp.local',
					running: false,
				},
			];
			expect( consoleSpy ).toHaveBeenCalledWith( JSON.stringify( publicSites ) );
			expect( mockReportKeyValuePair ).toHaveBeenCalledWith(
				'sites',
				JSON.stringify( publicSites )
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();

			consoleSpy.mockRestore();
		} );

		it( 'prints only public fields in list JSON', async () => {
			const plaintextPassword = 'super-secret-admin-password';
			const encodedPassword = btoa( plaintextPassword );
			vi.mocked( readCliConfig ).mockResolvedValue( {
				...testCliConfig,
				sites: [
					{
						...testCliConfig.sites[ 0 ],
						adminPassword: encodedPassword,
						runtime: 'native-php',
						latestCliPid: 4242,
						// Unknown fields pass through the loose config schema; they must stay hidden.
						futureApiToken: 'FUTURE_TOKEN_VALUE',
					},
				],
			} as Awaited< ReturnType< typeof readCliConfig > > );

			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( 'json' );

			expect( consoleSpy ).toHaveBeenCalledTimes( 1 );
			const stdout = String( consoleSpy.mock.calls[ 0 ][ 0 ] );
			const parsed = JSON.parse( stdout ) as Array< Record< string, unknown > >;

			expect( parsed ).toHaveLength( 1 );
			expect( parsed[ 0 ] ).toMatchObject( {
				id: 'site-1',
				name: 'Test Site 1',
				path: '/path/to/site1',
				port: 8080,
				phpVersion: '8.0',
				runtime: 'native-php',
				url: 'http://localhost:8080',
				running: false,
			} );

			for ( const key of Object.keys( parsed[ 0 ] ) ) {
				expect( SITE_LIST_PUBLIC_FIELDS ).toContain( key );
			}
			expect( stdout ).not.toContain( plaintextPassword );
			expect( stdout ).not.toContain( encodedPassword );
			expect( stdout ).not.toContain( 'FUTURE_TOKEN_VALUE' );

			const [ , ipcJson ] = mockReportKeyValuePair.mock.calls[ 0 ];
			const ipcSites = JSON.parse( ipcJson ) as Array< Record< string, unknown > >;
			expect( ipcSites[ 0 ] ).toMatchObject( {
				id: 'site-1',
				adminPassword: encodedPassword,
			} );

			consoleSpy.mockRestore();
		} );

		// Both front ends disable a site's actions on what this reports, so an
		// entry left behind by a crashed process must not survive into the payload.
		it( 'should omit an operation whose owning process is gone', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( {
				...testCliConfig,
				sites: [
					{
						...testCliConfig.sites[ 0 ],
						operation: { pid: 0x7ffffffe, kind: 'delete' as const },
					},
				],
			} );

			await runCommand( 'json' );

			const [ , json ] = mockReportKeyValuePair.mock.calls[ 0 ];
			expect( JSON.parse( json )[ 0 ] ).not.toHaveProperty( 'operation' );
		} );

		it( 'should handle no sites found', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( emptyCliConfig );

			await runCommand( 'table' );

			expect( readCliConfig ).toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should output empty json array when no sites found', async () => {
			vi.mocked( readCliConfig ).mockResolvedValue( emptyCliConfig );

			await runCommand( 'json' );

			expect( mockReportKeyValuePair ).toHaveBeenCalledWith( 'sites', '[]' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should handle custom domain in site URL', async () => {
			await runCommand( 'json' );

			expect( mockReportKeyValuePair ).toHaveBeenCalledWith(
				'sites',
				expect.stringContaining( 'my-site.wp.local' )
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );
} );
