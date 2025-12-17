import { arePathsEqual } from 'common/lib/fs-utils';
import {
	SiteData,
	getSiteByFolder,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getSiteByFolder: jest.fn(),
	lockAppdata: jest.fn(),
	readAppdata: jest.fn(),
	saveAppdata: jest.fn(),
	unlockAppdata: jest.fn(),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/run-wp-cli-command' );
jest.mock( 'cli/lib/wordpress-server-manager' );
jest.mock( 'common/lib/fs-utils' );

describe( 'CLI: studio site set-wp-version', () => {
	const testSitePath = '/test/site/path';

	const createTestSite = (): SiteData => ( {
		id: 'test-site-id',
		name: 'Test Site',
		path: testSitePath,
		port: 8881,
		adminUsername: 'admin',
		adminPassword: 'password123',
		running: false,
		phpVersion: '8.0',
		wpVersion: '6.4',
		url: `http://localhost:8881`,
		enableHttps: false,
		customDomain: 'test.local',
	} );

	const testProcessDescription = {
		name: 'test-site-id',
		pmId: 0,
		status: 'online',
		pid: 12345,
	};

	let testSite: SiteData;

	beforeEach( () => {
		jest.clearAllMocks();
		jest.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );

		testSite = createTestSite();

		( getSiteByFolder as jest.Mock ).mockResolvedValue( testSite );
		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockReturnValue( undefined );
		( lockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( readAppdata as jest.Mock ).mockResolvedValue( {
			sites: [ testSite ],
			snapshots: [],
		} );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( undefined );
		( startWordPressServer as jest.Mock ).mockResolvedValue( testProcessDescription );
		( stopWordPressServer as jest.Mock ).mockResolvedValue( undefined );
		( arePathsEqual as jest.Mock ).mockImplementation( ( a: string, b: string ) => a === b );
		( runWpCliCommand as jest.Mock ).mockResolvedValue( [
			{ exitCode: 0 },
			jest.fn().mockResolvedValue( undefined ),
		] );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when WordPress version update command fails', async () => {
			( runWpCliCommand as jest.Mock ).mockResolvedValue( [
				{ exitCode: 1 },
				jest.fn().mockResolvedValue( undefined ),
			] );

			const { runCommand } = await import( '../set-wp-version' );

			await expect( runCommand( testSitePath, '6.5' ) ).rejects.toThrow(
				'Failed to update WordPress version to 6.5'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when site not found in appdata', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-wp-version' );

			await expect( runCommand( testSitePath, '6.5' ) ).rejects.toThrow(
				'The specified folder is not added to Studio.'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when appdata save fails', async () => {
			( saveAppdata as jest.Mock ).mockRejectedValue( new Error( 'Save failed' ) );

			const { runCommand } = await import( '../set-wp-version' );

			await expect( runCommand( testSitePath, '6.5' ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when PM2 connection fails', async () => {
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			const { runCommand } = await import( '../set-wp-version' );

			await expect( runCommand( testSitePath, '6.5' ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when WordPress server stop fails', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );
			( stopWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server stop failed' ) );

			const { runCommand } = await import( '../set-wp-version' );

			await expect( runCommand( testSitePath, '6.5' ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw when WP-CLI command execution fails', async () => {
			( runWpCliCommand as jest.Mock ).mockRejectedValue( new Error( 'WP-CLI failed' ) );

			const { runCommand } = await import( '../set-wp-version' );

			await expect( runCommand( testSitePath, '6.5' ) ).rejects.toThrow();
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should update WordPress version on a stopped site', async () => {
			const { runCommand } = await import( '../set-wp-version' );

			await runCommand( testSitePath, '6.5' );

			expect( getSiteByFolder ).toHaveBeenCalledWith( testSitePath );
			expect( connect ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).not.toHaveBeenCalled();

			expect( runWpCliCommand ).toHaveBeenCalledWith( testSitePath, '8.0', 8881, [
				'core',
				'update',
				expect.stringContaining( '6.5' ),
				'--force',
				'--skip-plugins',
				'--skip-themes',
			] );

			expect( lockAppdata ).toHaveBeenCalled();
			expect( readAppdata ).toHaveBeenCalled();
			expect( saveAppdata ).toHaveBeenCalled();

			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].isWpAutoUpdating ).toBe( false );

			expect( unlockAppdata ).toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should update WordPress version and restart a running site', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( testProcessDescription );

			const { runCommand } = await import( '../set-wp-version' );

			await runCommand( testSitePath, '6.5' );

			expect( isServerRunning ).toHaveBeenCalledWith( testSite.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( testSite.id );

			expect( runWpCliCommand ).toHaveBeenCalledWith( testSitePath, '8.0', 8881, [
				'core',
				'update',
				expect.stringContaining( '6.5' ),
				'--force',
				'--skip-plugins',
				'--skip-themes',
			] );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].isWpAutoUpdating ).toBe( false );

			expect( startWordPressServer ).toHaveBeenCalledWith(
				expect.any( Object ),
				expect.any( Logger )
			);
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
