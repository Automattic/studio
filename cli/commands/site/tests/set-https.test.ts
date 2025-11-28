import { arePathsEqual } from 'common/lib/fs-utils';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import {
	SiteData,
	getSiteByFolder,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getSiteByFolder: jest.fn(),
	lockAppdata: jest.fn(),
	readAppdata: jest.fn(),
	saveAppdata: jest.fn(),
	unlockAppdata: jest.fn(),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/wordpress-server-manager' );
jest.mock( 'cli/logger' );
jest.mock( 'common/lib/fs-utils' );

describe( 'Site Set-HTTPS Command', () => {
	const mockSiteFolder = '/test/site/path';
	const mockSiteData: SiteData = {
		id: 'test-site-id',
		name: 'Test Site',
		path: mockSiteFolder,
		port: 8881,
		adminUsername: 'admin',
		adminPassword: 'password123',
		running: false,
		phpVersion: '8.0',
		url: `http://localhost:8881`,
		enableHttps: false,
		customDomain: 'test.local',
	};

	const mockProcessDescription = {
		name: 'test-site-id',
		pmId: 0,
		status: 'online',
		pid: 12345,
	};

	let mockLogger: {
		reportStart: jest.Mock;
		reportSuccess: jest.Mock;
		reportError: jest.Mock;
	};

	beforeEach( () => {
		jest.clearAllMocks();

		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
		};

		( Logger as jest.Mock ).mockReturnValue( mockLogger );

		( getSiteByFolder as jest.Mock ).mockResolvedValue( mockSiteData );
		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockReturnValue( undefined );
		( lockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( readAppdata as jest.Mock ).mockResolvedValue( {
			sites: [ mockSiteData ],
			snapshots: [],
		} );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( undefined );
		( startWordPressServer as jest.Mock ).mockResolvedValue( mockProcessDescription );
		( stopWordPressServer as jest.Mock ).mockResolvedValue( undefined );
		( arePathsEqual as jest.Mock ).mockImplementation( ( a: string, b: string ) => a === b );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Handling', () => {
		it( 'should handle missing custom domain', async () => {
			const siteWithoutDomain = { ...mockSiteData, customDomain: undefined };
			( getSiteByFolder as jest.Mock ).mockResolvedValue( siteWithoutDomain );

			const { runCommand } = await import( '../set-https' );
			await runCommand( mockSiteFolder, true );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle PM2 connection failure', async () => {
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			const { runCommand } = await import( '../set-https' );
			await runCommand( mockSiteFolder, true );

			expect( mockLogger.reportError ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle appdata lock failure', async () => {
			( lockAppdata as jest.Mock ).mockRejectedValue( new Error( 'Lock failed' ) );

			const { runCommand } = await import( '../set-https' );
			await runCommand( mockSiteFolder, true );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle appdata read failure', async () => {
			( readAppdata as jest.Mock ).mockRejectedValue( new Error( 'Read failed' ) );

			const { runCommand } = await import( '../set-https' );
			await runCommand( mockSiteFolder, true );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle site not found in appdata', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-https' );
			await runCommand( mockSiteFolder, true );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle WordPress server stop failure', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );
			( stopWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server stop failed' ) );

			const { runCommand } = await import( '../set-https' );
			await runCommand( mockSiteFolder, true );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should enable HTTPS on a stopped site', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteData ],
				snapshots: [],
			} );
			( isServerRunning as jest.Mock ).mockResolvedValue( undefined );

			const { runCommand } = await import( '../set-https' );
			await runCommand( mockSiteFolder, true );

			expect( connect ).toHaveBeenCalled();
			expect( lockAppdata ).toHaveBeenCalled();
			expect( readAppdata ).toHaveBeenCalled();
			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableHttps ).toBe( true );
			expect( unlockAppdata ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should disable HTTPS on a stopped site', async () => {
			const siteWithHttps = { ...mockSiteData, enableHttps: true };
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ siteWithHttps ],
				snapshots: [],
			} );
			( isServerRunning as jest.Mock ).mockResolvedValue( undefined );

			const { runCommand } = await import( '../set-https' );
			await runCommand( mockSiteFolder, false );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableHttps ).toBe( false );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should enable HTTPS and restart a running site', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ mockSiteData ],
				snapshots: [],
			} );
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../set-https' );
			await runCommand( mockSiteFolder, true );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableHttps ).toBe( true );
			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( mockSiteData.id );
			expect( startWordPressServer ).toHaveBeenCalledWith( expect.any( Object ) );
			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Site restarted' );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should disable HTTPS and restart a running site', async () => {
			const siteWithHttps = { ...mockSiteData, enableHttps: true };
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ siteWithHttps ],
				snapshots: [],
			} );
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../set-https' );
			await runCommand( mockSiteFolder, false );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableHttps ).toBe( false );
			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( mockSiteData.id );
			expect( startWordPressServer ).toHaveBeenCalled();
			expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Site restarted' );
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
