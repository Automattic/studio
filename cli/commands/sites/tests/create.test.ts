import fs from 'fs';
import { input, select } from '@inquirer/prompts';
import { fetchWordPressVersions } from 'common/lib/wp-org/versions';
import { readAppdata, saveAppdata, lockAppdata, unlockAppdata } from 'cli/lib/appdata';
import { Logger } from 'cli/logger';

jest.mock( 'fs' );
jest.mock( '@inquirer/prompts' );
jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	readAppdata: jest.fn(),
	saveAppdata: jest.fn(),
	lockAppdata: jest.fn(),
	unlockAppdata: jest.fn(),
} ) );
jest.mock( 'cli/logger' );
jest.mock( 'common/lib/wp-org/versions', () => ( {
	fetchWordPressVersions: jest.fn(),
} ) );

describe( 'Sites Create Command', () => {
	const mockSiteData = {
		name: 'Test Site',
		path: '/test/path',
		phpVersion: '8.3',
		wpVersion: 'latest',
	};

	const mockSite = {
		id: 'test-site-id',
		name: 'test-path',
		path: '/test/path',
	};

	const mockAppdata = {
		sites: [],
		newSites: [ mockSite ],
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
		// Mock individual prompt functions
		( input as jest.Mock )
			.mockResolvedValueOnce( mockSiteData.path ) // Site path
			.mockResolvedValueOnce( mockSiteData.name ); // Site name
		( select as jest.Mock )
			.mockResolvedValueOnce( mockSiteData.phpVersion ) // PHP version
			.mockResolvedValueOnce( mockSiteData.wpVersion ); // WordPress version
		( readAppdata as jest.Mock ).mockResolvedValue( { ...mockAppdata } ); // Clone to avoid mutation
		( lockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( unlockAppdata as jest.Mock ).mockResolvedValue( undefined );
		( saveAppdata as jest.Mock ).mockResolvedValue( undefined );

		// Mock WordPress versions API to return successful data
		( fetchWordPressVersions as jest.Mock ).mockResolvedValue( [
			{ isBeta: false, isDevelopment: false, label: 'latest', value: 'latest' },
			{ isBeta: false, isDevelopment: false, label: '6.4', value: '6.4.3' },
			{ isBeta: false, isDevelopment: false, label: '6.3', value: '6.3.4' },
		] );

		// Mock fs methods
		( fs.existsSync as jest.Mock ).mockReturnValue( false );
		( fs.mkdirSync as jest.Mock ).mockReturnValue( undefined );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'should create a site successfully with basic data', async () => {
		// Ensure mocks are properly reset and configured for this test
		( input as jest.Mock )
			.mockReset()
			.mockResolvedValueOnce( '/test/path' )
			.mockResolvedValueOnce( 'Test Site' );
		( select as jest.Mock )
			.mockReset()
			.mockResolvedValueOnce( '8.3' )
			.mockResolvedValueOnce( 'latest' );

		const { runCommand } = await import( '../create' );
		await runCommand();

		expect( input ).toHaveBeenCalledTimes( 2 ); // path, name
		expect( select ).toHaveBeenCalledTimes( 2 ); // phpVersion, wpVersion
		expect( mockLogger.reportStart ).toHaveBeenCalledWith( 'appdata', 'Creating site...' );
		expect( saveAppdata ).toHaveBeenCalled();
		expect( mockLogger.reportSuccess ).toHaveBeenCalledWith(
			'Site "Test Site" created successfully'
		);
	} );

	it( 'should create directory if it does not exist', async () => {
		( input as jest.Mock )
			.mockReset()
			.mockResolvedValueOnce( '/test/path' )
			.mockResolvedValueOnce( 'Test Site' );
		( select as jest.Mock )
			.mockReset()
			.mockResolvedValueOnce( '8.3' )
			.mockResolvedValueOnce( 'latest' );
		( fs.existsSync as jest.Mock ).mockReturnValue( false );

		const { runCommand } = await import( '../create' );
		await runCommand();

		expect( fs.mkdirSync ).toHaveBeenCalledWith( '/test/path', { recursive: true } );
	} );

	it( 'should update site name if different from folder name', async () => {
		( input as jest.Mock )
			.mockReset()
			.mockResolvedValueOnce( '/test/path' )
			.mockResolvedValueOnce( 'Test Site' );
		( select as jest.Mock )
			.mockReset()
			.mockResolvedValueOnce( '8.3' )
			.mockResolvedValueOnce( 'latest' );

		const { runCommand } = await import( '../create' );
		await runCommand();

		expect( lockAppdata ).toHaveBeenCalled();
		expect( readAppdata ).toHaveBeenCalled();
		// Check that saveAppdata was called and a site was added
		expect( saveAppdata ).toHaveBeenCalled();
		const saveCall = ( saveAppdata as jest.Mock ).mock.calls[ 0 ][ 0 ];
		expect( saveCall.newSites ).toContainEqual( {
			id: expect.any( String ),
			name: 'Test Site',
			path: '/test/path',
		} );
		expect( unlockAppdata ).toHaveBeenCalled();
	} );

	it( 'should handle TTY errors gracefully', async () => {
		jest.clearAllMocks(); // Clear previous mock setup

		const ttyError: Error & { isTTYError?: boolean } = new Error( 'TTY Error' );
		ttyError.isTTYError = true;

		// Mock the first input function (site path) to reject with TTY error
		( input as jest.Mock ).mockReset().mockRejectedValueOnce( ttyError );

		const consoleErrorSpy = jest.spyOn( console, 'error' ).mockImplementation();
		const processExitSpy = jest.spyOn( process, 'exit' ).mockImplementation( () => {
			throw new Error( 'process.exit' );
		} );

		const { runCommand } = await import( '../create' );

		await expect( runCommand() ).rejects.toThrow( 'process.exit' );
		expect( consoleErrorSpy ).toHaveBeenCalledWith(
			'This command requires an interactive terminal'
		);
		expect( processExitSpy ).toHaveBeenCalledWith( 1 );

		consoleErrorSpy.mockRestore();
		processExitSpy.mockRestore();
	} );

	it( 'should handle site creation errors', async () => {
		const error = new Error( 'Creation failed' );
		( input as jest.Mock )
			.mockReset()
			.mockResolvedValueOnce( '/test/path' )
			.mockResolvedValueOnce( 'Test Site' );
		( select as jest.Mock )
			.mockReset()
			.mockResolvedValueOnce( '8.3' )
			.mockResolvedValueOnce( 'latest' );
		( saveAppdata as jest.Mock ).mockRejectedValue( error );

		const { runCommand } = await import( '../create' );

		await expect( runCommand() ).rejects.toThrow( 'Creation failed' );
		expect( mockLogger.reportError ).toHaveBeenCalled();
	} );
} );
