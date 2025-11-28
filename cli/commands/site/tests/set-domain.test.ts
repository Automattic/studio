import { arePathsEqual } from 'common/lib/fs-utils';
import {
	SiteData,
	getSiteByFolder,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';
import { addDomainToHosts, removeDomainFromHosts } from 'cli/lib/hosts-file';
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
jest.mock( 'cli/lib/hosts-file' );

describe( 'Site Set-Domain Command', () => {
	const mockSiteFolder = '/test/site/path';
	const mockDomainName = 'example.local';
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
			sites: [ { ...mockSiteData } ],
			snapshots: [],
		} );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( undefined );
		( startWordPressServer as jest.Mock ).mockResolvedValue( mockProcessDescription );
		( stopWordPressServer as jest.Mock ).mockResolvedValue( undefined );
		( arePathsEqual as jest.Mock ).mockImplementation( ( a: string, b: string ) => a === b );
		( addDomainToHosts as jest.Mock ).mockResolvedValue( undefined );
		( removeDomainFromHosts as jest.Mock ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Handling', () => {
		it( 'should handle PM2 connection failure', async () => {
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			const { runCommand } = await import( '../set-domain' );
			await runCommand( mockSiteFolder, mockDomainName );

			expect( mockLogger.reportStart ).toHaveBeenCalledWith(
				'startDaemon',
				'Starting process daemon...'
			);
			expect( mockLogger.reportError ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle appdata lock failure', async () => {
			( lockAppdata as jest.Mock ).mockRejectedValue( new Error( 'Lock failed' ) );

			const { runCommand } = await import( '../set-domain' );
			await runCommand( mockSiteFolder, mockDomainName );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle appdata read failure', async () => {
			( readAppdata as jest.Mock ).mockRejectedValue( new Error( 'Read failed' ) );

			const { runCommand } = await import( '../set-domain' );
			await runCommand( mockSiteFolder, mockDomainName );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle domain validation error', async () => {
			const { runCommand } = await import( '../set-domain' );
			await runCommand( mockSiteFolder, 'invalid domain' );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( saveAppdata ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should throw error when domain already exists', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [ { ...mockSiteData, customDomain: 'example.local' } ],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-domain' );
			await runCommand( mockSiteFolder, mockDomainName );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( saveAppdata ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle site not found in appdata', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [],
				snapshots: [],
			} );

			const { runCommand } = await import( '../set-domain' );
			await runCommand( mockSiteFolder, mockDomainName );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle appdata save failure', async () => {
			( saveAppdata as jest.Mock ).mockRejectedValue( new Error( 'Save failed' ) );

			const { runCommand } = await import( '../set-domain' );
			await runCommand( mockSiteFolder, mockDomainName );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle WordPress server stop failure', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );
			( stopWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server stop failed' ) );

			const { runCommand } = await import( '../set-domain' );
			await runCommand( mockSiteFolder, mockDomainName );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should set domain on a stopped site', async () => {
			const { runCommand } = await import( '../set-domain' );
			await runCommand( mockSiteFolder, mockDomainName );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].customDomain ).toBe( mockDomainName );
			expect( unlockAppdata ).toHaveBeenCalled();
			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should set domain and restart a running site', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../set-domain' );
			await runCommand( mockSiteFolder, mockDomainName );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].customDomain ).toBe( mockDomainName );
			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( mockSiteData.id );
			expect( startWordPressServer ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
