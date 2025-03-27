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
	const mockAction = 'test-action';

	beforeEach( () => {
		jest.clearAllMocks();
		( os.homedir as jest.Mock ).mockReturnValue( mockHomeDir );
		( path.join as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
	} );

	it( 'should throw LoggerError if app data file does not exist', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( false );

		await expect( getAuthToken( mockAction ) ).rejects.toThrow( LoggerError );
		await expect( getAuthToken( mockAction ) ).rejects.toMatchObject( {
			action: mockAction,
			message: expect.stringContaining( 'Authentication required' ),
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

		const result = await getAuthToken( mockAction );

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
		expect( result ).toBe( mockAccessToken );
	} );

	it( 'should throw LoggerError if authToken is not in app data file', async () => {
		const mockUserData = { otherData: 'value' };

		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

		await expect( getAuthToken( mockAction ) ).rejects.toThrow( LoggerError );
		await expect( getAuthToken( mockAction ) ).rejects.toMatchObject( {
			action: mockAction,
			message: expect.stringContaining( 'Authentication data is invalid' ),
		} );

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
	} );

	it( 'should throw LoggerError if authToken.accessToken is not in app data file', async () => {
		const mockUserData = { authToken: { someOtherField: 'value' } };

		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

		await expect( getAuthToken( mockAction ) ).rejects.toThrow( LoggerError );
		await expect( getAuthToken( mockAction ) ).rejects.toMatchObject( {
			action: mockAction,
			message: expect.stringContaining( 'Authentication data is invalid' ),
		} );

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
	} );

	it( 'should throw LoggerError if there is an error reading the file', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockImplementation( () => {
			throw new Error( 'File read error' );
		} );

		await expect( getAuthToken( mockAction ) ).rejects.toThrow( LoggerError );
		await expect( getAuthToken( mockAction ) ).rejects.toMatchObject( {
			action: mockAction,
			message: expect.stringContaining( 'Authentication required' ),
		} );

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
	} );

	it( 'should throw LoggerError if there is an error parsing the JSON', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockReturnValue( 'invalid json{' );

		await expect( getAuthToken( mockAction ) ).rejects.toThrow( LoggerError );
		await expect( getAuthToken( mockAction ) ).rejects.toMatchObject( {
			action: mockAction,
			message: expect.stringContaining( 'corrupted' ),
		} );

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
	} );

	it( 'should throw LoggerError if authToken schema validation fails', async () => {
		const mockUserData = { authToken: { accessToken: '' } }; // Empty token should fail validation

		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

		await expect( getAuthToken( mockAction ) ).rejects.toThrow( LoggerError );
		await expect( getAuthToken( mockAction ) ).rejects.toMatchObject( {
			action: mockAction,
			message: expect.stringContaining( 'Authentication data is invalid' ),
		} );

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
	} );
} );
