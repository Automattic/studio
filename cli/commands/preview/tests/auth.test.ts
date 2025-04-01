import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAuthToken } from 'cli/commands/preview/lib/auth';
import { LoggerError } from 'cli/logger';

// Mock ora
jest.mock( 'ora', () => {
	return {
		__esModule: true,
		default: () => ( {
			start: jest.fn().mockReturnThis(),
			stop: jest.fn().mockReturnThis(),
			succeed: jest.fn().mockReturnThis(),
			fail: jest.fn().mockReturnThis(),
		} ),
	};
} );

jest.mock( 'fs' );
jest.mock( 'os' );
jest.mock( 'path' );

describe( 'Auth Module', () => {
	const mockHomeDir = '/mock/home';
	const mockAppDataPath = '/mock/home/Library/Application Support/Studio/appdata-v1.json';

	beforeEach( () => {
		jest.clearAllMocks();
		( os.homedir as jest.Mock ).mockReturnValue( mockHomeDir );
		( path.join as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
	} );

	it( 'should throw LoggerError if app data file does not exist', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( false );

		await expect( getAuthToken() ).rejects.toThrow( LoggerError );
		await expect( getAuthToken() ).rejects.toMatchObject( {
			message: expect.stringContaining( 'Appdata file not found' ),
		} );

		expect( os.homedir ).toHaveBeenCalled();
		expect( path.join ).toHaveBeenCalledWith(
			mockHomeDir,
			'Library',
			'Application Support',
			'Studio',
			'appdata-v1.json'
		);
		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).not.toHaveBeenCalled();
	} );

	it( 'should return access token if it exists in app data file', async () => {
		const mockAccessToken = 'mock-access-token-123';
		const mockUserData = { authToken: { accessToken: mockAccessToken } };

		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

		const result = await getAuthToken();

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
		expect( result ).toBe( mockAccessToken );
	} );

	it( 'should throw LoggerError if authToken is not in app data file', async () => {
		const mockUserData = { otherData: 'value' };

		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

		await expect( getAuthToken() ).rejects.toThrow( LoggerError );
		await expect( getAuthToken() ).rejects.toMatchObject( {
			message: expect.stringContaining( 'Authentication token is invalid or missing' ),
		} );

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
	} );

	it( 'should throw LoggerError if there is an error reading the file', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockImplementation( () => {
			throw new Error( 'File read error' );
		} );

		await expect( getAuthToken() ).rejects.toThrow( LoggerError );
		await expect( getAuthToken() ).rejects.toMatchObject( {
			message: expect.stringContaining( 'Failed to read appdata file' ),
		} );

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
	} );

	it( 'should throw LoggerError if there is an error parsing the JSON', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockReturnValue( 'invalid json{' );

		await expect( getAuthToken() ).rejects.toThrow( LoggerError );
		await expect( getAuthToken() ).rejects.toMatchObject( {
			message: expect.stringContaining( 'corrupted' ),
		} );

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
	} );
} );
