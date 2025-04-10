import fs from 'fs';
import os from 'os';
import path from 'path';
import { readAppdata, saveAppdata, getAuthToken } from 'cli/lib/appdata';

jest.mock( 'fs' );
jest.mock( 'os' );
jest.mock( 'path' );

describe( 'Appdata Module', () => {
	const mockHomeDir = '/mock/home';
	const mockSiteFolderName = 'folder';

	beforeEach( () => {
		jest.clearAllMocks();
		( os.homedir as jest.Mock ).mockReturnValue( mockHomeDir );
		( path.join as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
		( path.basename as jest.Mock ).mockReturnValue( mockSiteFolderName );
		jest.spyOn( Date, 'now' ).mockReturnValue( 1234567890 );

		// Default mock implementation for fs functions
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockReturnValue( '{}' );
		( fs.writeFileSync as jest.Mock ).mockImplementation( () => undefined );
	} );

	describe( 'readAppdata', () => {
		it( 'should throw LoggerError if appdata file does not exist', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( false );
			await expect( readAppdata() ).rejects.toThrow( 'Appdata file not found' );
		} );

		it( 'should return parsed appdata if it exists and is valid', async () => {
			const mockUserData = {
				version: 1,
				sites: [],
				snapshots: [
					{
						url: 'example.com',
						atomicSiteId: 123,
						localSiteId: 'site1',
						date: 1234567,
					},
				],
			};

			( fs.readFileSync as jest.Mock ).mockReturnValueOnce( JSON.stringify( mockUserData ) );

			const result = await readAppdata();
			expect( result ).toEqual( mockUserData );
		} );

		it( 'should throw LoggerError if there is an error reading the file', async () => {
			( fs.readFileSync as jest.Mock ).mockImplementation( () => {
				throw new Error( 'Read error' );
			} );

			await expect( readAppdata() ).rejects.toThrow( 'Failed to read appdata file' );
		} );

		it( 'should throw LoggerError if there is an error parsing the JSON', async () => {
			( fs.readFileSync as jest.Mock ).mockReturnValueOnce( 'invalid json{' );

			await expect( readAppdata() ).rejects.toThrow( 'corrupted' );
		} );
	} );

	describe( 'saveAppdata', () => {
		it( 'should save the userData to the appdata file', async () => {
			const mockUserData = {
				version: 1,
				sites: [],
				snapshots: [],
			};

			await saveAppdata( mockUserData );

			expect( fs.writeFileSync ).toHaveBeenCalledWith(
				expect.any( String ),
				JSON.stringify( mockUserData, null, 2 ) + '\n',
				'utf8'
			);
		} );

		it( 'should throw LoggerError if there is an error saving the file', async () => {
			const mockUserData = {
				version: 1,
				sites: [],
				snapshots: [],
			};

			( fs.writeFileSync as jest.Mock ).mockImplementation( () => {
				throw new Error( 'Write error' );
			} );

			await expect( saveAppdata( mockUserData ) ).rejects.toThrow( 'Failed to save appdata file' );
		} );

		it( 'should add version 1 if version is not provided', async () => {
			const mockUserData = {
				sites: [],
				snapshots: [],
			};

			await saveAppdata( mockUserData );

			expect( fs.writeFileSync ).toHaveBeenCalled();
			const savedData = JSON.parse( ( fs.writeFileSync as jest.Mock ).mock.calls[ 0 ][ 1 ] );
			expect( savedData.version ).toBe( 1 );
		} );
	} );

	describe( 'getAuthToken', () => {
		it( 'should return auth token when it exists', async () => {
			const mockAuthToken = {
				accessToken: 'valid-token',
				id: 123,
			};

			( fs.readFileSync as jest.Mock ).mockReturnValueOnce(
				JSON.stringify( {
					version: 1,
					authToken: mockAuthToken,
					sites: [],
					snapshots: [],
				} )
			);

			const result = await getAuthToken();
			expect( result ).toEqual( mockAuthToken );
		} );

		it( 'should throw LoggerError when auth token is missing', async () => {
			( fs.readFileSync as jest.Mock ).mockReturnValueOnce(
				JSON.stringify( {
					version: 1,
					sites: [],
					snapshots: [],
				} )
			);

			await expect( getAuthToken() ).rejects.toThrow( 'Authentication required' );
		} );

		it( 'should throw LoggerError when access token is missing', async () => {
			( fs.readFileSync as jest.Mock ).mockReturnValueOnce(
				JSON.stringify( {
					version: 1,
					authToken: {
						id: 123,
					},
					sites: [],
					snapshots: [],
				} )
			);

			await expect( getAuthToken() ).rejects.toThrow( 'Authentication required' );
		} );
	} );
} );
