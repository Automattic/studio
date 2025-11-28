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
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';

jest.mock( 'fs/promises' );
jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getSiteByFolder: jest.fn(),
	lockAppdata: jest.fn(),
	readAppdata: jest.fn(),
	saveAppdata: jest.fn(),
	unlockAppdata: jest.fn(),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/site-utils' );
jest.mock( 'cli/lib/wordpress-server-manager' );
jest.mock( 'cli/logger' );
jest.mock( 'common/lib/fs-utils' );

describe( 'Site Delete Command', () => {
	const mockSiteFolder = '/test/site/path';
	const mockSiteData: SiteData = {
		id: 'test-site-id',
		name: 'Test Site',
		path: mockSiteFolder,
		port: 8881,
		phpVersion: '8.0',
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
		( stopWordPressServer as jest.Mock ).mockResolvedValue( undefined );
		( stopProxyIfNoSitesNeedIt as jest.Mock ).mockResolvedValue( undefined );
		( arePathsEqual as jest.Mock ).mockImplementation( ( a: string, b: string ) => a === b );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Handling', () => {
		it( 'should handle PM2 connection failure', async () => {
			( connect as jest.Mock ).mockRejectedValue( new Error( 'PM2 connection failed' ) );

			const { runCommand } = await import( '../delete' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportError ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle appdata lock failure', async () => {
			( lockAppdata as jest.Mock ).mockRejectedValue( new Error( 'Lock failed' ) );

			const { runCommand } = await import( '../delete' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle appdata read failure', async () => {
			( readAppdata as jest.Mock ).mockRejectedValue( new Error( 'Read failed' ) );

			const { runCommand } = await import( '../delete' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle site not found in appdata', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( {
				sites: [],
				snapshots: [],
			} );

			const { runCommand } = await import( '../delete' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle WordPress server stop failure', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );
			( stopWordPressServer as jest.Mock ).mockRejectedValue( new Error( 'Server stop failed' ) );

			const { runCommand } = await import( '../delete' );
			await runCommand( mockSiteFolder );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle file deletion failure when delete-files flag is set', async () => {
			const fs = require( 'fs/promises' );
			fs.rm = jest.fn().mockRejectedValue( new Error( 'File deletion failed' ) );

			const { runCommand } = await import( '../delete' );
			await runCommand( mockSiteFolder, true );

			expect( mockLogger.reportError ).toHaveBeenCalledWith( expect.any( LoggerError ) );
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should delete a stopped site without removing files', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( undefined );

			const { runCommand } = await import( '../delete' );
			await runCommand( mockSiteFolder, false );

			expect( connect ).toHaveBeenCalled();
			expect( lockAppdata ).toHaveBeenCalled();
			expect( readAppdata ).toHaveBeenCalled();
			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites ).toHaveLength( 0 );
			expect( unlockAppdata ).toHaveBeenCalled();
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should delete a running site and stop it first', async () => {
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../delete' );
			await runCommand( mockSiteFolder, false );

			expect( isServerRunning ).toHaveBeenCalledWith( mockSiteData.id );
			expect( stopWordPressServer ).toHaveBeenCalledWith( mockSiteData.id );
			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites ).toHaveLength( 0 );
			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should delete a site and remove files when delete-files flag is set', async () => {
			const fs = require( 'fs/promises' );
			fs.rm = jest.fn().mockResolvedValue( undefined );
			( isServerRunning as jest.Mock ).mockResolvedValue( undefined );

			const { runCommand } = await import( '../delete' );
			await runCommand( mockSiteFolder, true );

			expect( saveAppdata ).toHaveBeenCalled();
			const savedAppdata = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites ).toHaveLength( 0 );
			expect( fs.rm ).toHaveBeenCalledWith( mockSiteFolder, {
				recursive: true,
				force: true,
			} );
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should delete a running site and remove files when delete-files flag is set', async () => {
			const fs = require( 'fs/promises' );
			fs.rm = jest.fn().mockResolvedValue( undefined );
			( isServerRunning as jest.Mock ).mockResolvedValue( mockProcessDescription );

			const { runCommand } = await import( '../delete' );
			await runCommand( mockSiteFolder, true );

			expect( stopWordPressServer ).toHaveBeenCalledWith( mockSiteData.id );
			expect( fs.rm ).toHaveBeenCalledWith( mockSiteFolder, {
				recursive: true,
				force: true,
			} );
			expect( stopProxyIfNoSitesNeedIt ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );
} );
