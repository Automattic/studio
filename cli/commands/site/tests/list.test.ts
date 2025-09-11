import { readAppdata } from 'cli/lib/appdata';
import { Logger } from 'cli/logger';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
	readAppdata: jest.fn(),
} ) );
jest.mock( 'cli/logger' );

describe( 'Sites List Command', () => {
	const mockAppdata = {
		sites: [
			{
				id: 'site-1',
				name: 'Test Site 1',
				path: '/path/to/site1',
			},
			{
				id: 'site-2',
				name: 'Test Site 2',
				path: '/path/to/site2',
			},
		],
		snapshots: [],
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
		( readAppdata as jest.Mock ).mockResolvedValue( mockAppdata );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should list sites successfully', async () => {
		const { runCommand } = await import( '../list' );
		await runCommand( 'table' );

		expect( readAppdata ).toHaveBeenCalled();
		expect( mockLogger.reportStart ).toHaveBeenCalledWith( 'load', 'Loading sites…' );
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Found 2 sites' );
	} );

	it( 'should handle no sites found', async () => {
		const { runCommand } = await import( '../list' );
		( readAppdata as jest.Mock ).mockResolvedValue( {
			sites: [],
			newSites: [],
			snapshots: [],
		} );

		await runCommand( 'table' );

		expect( mockLogger.reportStart ).toHaveBeenCalledWith( 'load', 'Loading sites…' );
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'No sites found' );
	} );

	it( 'should handle appdata read errors', async () => {
		const { runCommand } = await import( '../list' );
		( readAppdata as jest.Mock ).mockRejectedValue( new Error( 'Failed to read appdata' ) );

		await runCommand( 'table' );

		expect( mockLogger.reportError ).toHaveBeenCalled();
	} );

	it( 'should work with json format', async () => {
		const consoleSpy = jest.spyOn( console, 'log' ).mockImplementation();
		const { runCommand } = await import( '../list' );
		await runCommand( 'json' );

		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith( 'Found 2 sites' );
		expect( consoleSpy ).toHaveBeenCalledWith(
			JSON.stringify(
				[
					{
						id: 'site-1',
						name: 'Test Site 1',
						path: '/path/to/site1',
						phpVersion: undefined,
					},
					{
						id: 'site-2',
						name: 'Test Site 2',
						path: '/path/to/site2',
						phpVersion: undefined,
					},
				],
				null,
				2
			)
		);

		consoleSpy.mockRestore();
	} );
} );
