import path from 'path';
import { Command } from 'commander';
import { Snapshot } from 'common/types/snapshot';
import { readAppdata, getSiteFromFolder, getAuthToken } from 'cli/lib/appdata';
import { validateSiteFolder } from 'cli/lib/validation';
import { Logger } from 'cli/logger';

jest.mock( 'cli/lib/appdata' );
jest.mock( 'cli/lib/validation' );
jest.mock( 'cli/logger' );

describe( 'Preview List Command', () => {
	const mockFolder = '/test/folder';
	const mockBasename = 'folder';
	const mockDate = 1234567890;
	const mockAuthToken = { accessToken: 'mock-auth-token', id: 123 };
	const mockSnapshots: Snapshot[] = [
		{
			url: 'https://example.com',
			atomicSiteId: 123,
			localSiteId: '456',
			date: Date.now(),
			name: 'Test Snapshot',
			userId: 123,
		},
	];
	const mockSite = {
		id: '456',
		name: 'Test Site',
		path: '/test/site',
	};
	let program: Command;
	let mockLogger: {
		reportStart: jest.Mock;
		reportSuccess: jest.Mock;
		reportError: jest.Mock;
	};

	beforeEach( () => {
		jest.clearAllMocks();
		( readAppdata as jest.Mock ).mockResolvedValue( { snapshots: mockSnapshots } );
		( getAuthToken as jest.Mock ).mockResolvedValue( mockAuthToken );
		( validateSiteFolder as jest.Mock ).mockReturnValue( true );
		( getSiteFromFolder as jest.Mock ).mockResolvedValue( mockSite );

		jest.clearAllMocks();
		jest.spyOn( Date, 'now' ).mockReturnValue( mockDate );
		jest.spyOn( path, 'basename' ).mockReturnValue( mockBasename );
		jest.spyOn( process, 'cwd' ).mockReturnValue( mockFolder );

		program = new Command( 'studio' );
		mockLogger = {
			reportStart: jest.fn(),
			reportSuccess: jest.fn(),
			reportError: jest.fn(),
		};
		( Logger as jest.Mock ).mockReturnValue( mockLogger );
	} );

	it( 'should successfully list snapshots', async () => {
		const { registerCommand } = await import( '../list' );
		registerCommand( program );

		await program.parseAsync( [ 'node', 'studio', 'list', '/test/path' ] );

		expect( mockLogger.reportStart ).toHaveBeenCalledWith( 'validate', 'Validating...' );
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Validation successful' );
		expect( mockLogger.reportStart ).toHaveBeenCalledWith( 'load', 'Loading previews...' );
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Found 1 preview' );
	} );

	it( 'should handle validation errors', async () => {
		const { registerCommand } = await import( '../list' );
		registerCommand( program );
		( validateSiteFolder as jest.Mock ).mockImplementation( () => {
			throw new Error( 'Invalid site folder' );
		} );

		await program.parseAsync( [ 'node', 'studio', 'list', '/invalid/path' ] );

		expect( mockLogger.reportError ).toHaveBeenCalled();
	} );

	it( 'should handle no snapshots found', async () => {
		const { registerCommand } = await import( '../list' );
		registerCommand( program );
		( readAppdata as jest.Mock ).mockResolvedValue( { snapshots: [] } );

		await program.parseAsync( [ 'node', 'studio', 'list', '/test/path' ] );

		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'No previews found' );
	} );
} );
