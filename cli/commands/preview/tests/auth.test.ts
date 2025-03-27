import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAuthToken } from 'cli/commands/preview/lib/auth';

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

	it( 'should return null if app data file does not exist', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( false );

		const result = await getAuthToken();

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
		expect( result ).toBeNull();
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

	it( 'should return null if authToken is not in app data file', async () => {
		const mockUserData = { otherData: 'value' };

		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

		const result = await getAuthToken();

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
		expect( result ).toBeNull();
	} );

	it( 'should return null if authToken.accessToken is not in app data file', async () => {
		const mockUserData = { authToken: { someOtherField: 'value' } };

		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

		const result = await getAuthToken();

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
		expect( result ).toBeNull();
	} );

	it( 'should return null if there is an error reading the file', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockImplementation( () => {
			throw new Error( 'File read error' );
		} );

		const result = await getAuthToken();

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
		expect( result ).toBeNull();
	} );

	it( 'should return null if there is an error parsing the JSON', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockReturnValue( 'invalid json{' );

		const result = await getAuthToken();

		expect( fs.existsSync ).toHaveBeenCalledWith( mockAppDataPath );
		expect( fs.readFileSync ).toHaveBeenCalledWith( mockAppDataPath, 'utf8' );
		expect( result ).toBeNull();
	} );
} );
