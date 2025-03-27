import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import {
	getAppdataPath,
	readAppdata,
	saveAppdata,
	addPreviewSiteToAppdata,
} from 'cli/commands/preview/lib/appdata';
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

describe( 'Appdata Module', () => {
	const mockHomeDir = '/mock/home';
	const mockAppDataPath = '/mock/home/Library/Application Support/Studio/appdata-v1.json';
	const mockAction = 'test-action';
	const mockSiteUrl = 'test-preview.example.com';
	const mockSiteId = 12345;
	const mockSiteFolder = '/test/folder';
	const mockSiteFolderName = 'folder';
	const mockUserId = 9876;

	beforeEach( () => {
		jest.clearAllMocks();
		( os.homedir as jest.Mock ).mockReturnValue( mockHomeDir );
		( path.join as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
		( path.basename as jest.Mock ).mockReturnValue( mockSiteFolderName );
		jest.spyOn( Date, 'now' ).mockReturnValue( 1234567890 );

		// Default mock implementation for fs functions
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.readFileSync as jest.Mock ).mockReturnValue( '{}' );
		( fs.writeFileSync as jest.Mock ).mockImplementation( () => undefined ); // Successfully do nothing by default
	} );

	describe( 'getAppdataPath', () => {
		it( 'should return the correct appdata path', () => {
			expect( getAppdataPath() ).toBe( mockAppDataPath );
			expect( os.homedir ).toHaveBeenCalled();
			expect( path.join ).toHaveBeenCalledWith(
				mockHomeDir,
				'Library',
				'Application Support',
				'Studio',
				'appdata-v1.json'
			);
		} );
	} );

	describe( 'readAppdata', () => {
		it( 'should throw LoggerError if appdata file does not exist', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( false );
			await expect( readAppdata( mockAction ) ).rejects.toMatchObject( {
				action: mockAction,
				message: expect.stringContaining( 'Appdata file not found' ),
			} );
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

			const result = await readAppdata( mockAction );
			expect( result ).toEqual( mockUserData );
		} );

		it( 'should throw LoggerError if appdata is invalid JSON', async () => {
			( fs.readFileSync as jest.Mock ).mockReturnValueOnce( 'invalid json{	' );

			await expect( readAppdata( mockAction ) ).rejects.toMatchObject( {
				action: mockAction,
				message: expect.stringContaining( 'corrupted' ),
			} );
		} );

		it( 'should throw LoggerError if appdata has invalid schema', async () => {
			const mockInvalidUserData = {
				snapshots: [ { invalid: 'data' } ],
			};

			( fs.readFileSync as jest.Mock ).mockReturnValueOnce( JSON.stringify( mockInvalidUserData ) );

			await expect( readAppdata( mockAction ) ).rejects.toMatchObject( {
				action: mockAction,
				message: expect.stringContaining( 'Invalid appdata format' ),
			} );
		} );
	} );

	describe( 'saveAppdata', () => {
		it( 'should save the userData to the appdata file', async () => {
			const mockUserData = {
				version: 1,
				sites: [],
				snapshots: [],
			};

			await saveAppdata( mockUserData, mockAction );

			expect( fs.writeFileSync ).toHaveBeenCalledWith(
				mockAppDataPath,
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

			await expect( saveAppdata( mockUserData, mockAction ) ).rejects.toMatchObject( {
				action: mockAction,
				message: expect.stringContaining( 'Failed to save appdata file' ),
			} );
		} );

		it( 'should add version 1 if version is not provided', async () => {
			const mockUserData = {
				sites: [],
				snapshots: [],
			};

			await saveAppdata( mockUserData, mockAction );

			expect( fs.writeFileSync ).toHaveBeenCalled();
			const savedData = JSON.parse( ( fs.writeFileSync as jest.Mock ).mock.calls[ 0 ][ 1 ] );
			expect( savedData.version ).toBe( 1 );
		} );
	} );

	describe( 'addPreviewSiteToAppdata', () => {
		it( 'should add a new preview site to appdata', async () => {
			const mockSiteIdNumber = 123;
			const mockUserData = {
				version: 1,
				sites: [
					{
						id: mockSiteIdNumber,
						path: mockSiteFolder,
						name: 'Test Site',
					},
				],
				snapshots: [],
			};

			( fs.existsSync as jest.Mock ).mockReturnValue( true );
			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await addPreviewSiteToAppdata( mockSiteUrl, mockSiteId, mockSiteFolder, mockAction );

			expect( fs.writeFileSync ).toHaveBeenCalled();
			const savedData = JSON.parse( ( fs.writeFileSync as jest.Mock ).mock.calls[ 0 ][ 1 ] );

			expect( savedData.snapshots ).toHaveLength( 1 );
			expect( savedData.snapshots[ 0 ] ).toEqual( {
				url: mockSiteUrl,
				atomicSiteId: mockSiteId,
				localSiteId: mockSiteIdNumber,
				date: 1234567890,
				name: 'Test Site',
			} );
		} );

		it( 'should append to existing snapshots', async () => {
			const mockSiteIdNumber = 123;
			const existingSnapshot = {
				url: 'existing.com',
				atomicSiteId: 111,
				localSiteId: 'existing',
				date: 1000000,
			};

			const mockUserData = {
				version: 1,
				sites: [
					{
						id: mockSiteIdNumber,
						path: mockSiteFolder,
						name: 'Test Site',
					},
				],
				snapshots: [ existingSnapshot ],
			};

			( fs.existsSync as jest.Mock ).mockReturnValue( true );
			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await addPreviewSiteToAppdata( mockSiteUrl, mockSiteId, mockSiteFolder, mockAction );

			expect( fs.writeFileSync ).toHaveBeenCalled();
			const savedData = JSON.parse( ( fs.writeFileSync as jest.Mock ).mock.calls[ 0 ][ 1 ] );

			expect( savedData.snapshots ).toHaveLength( 2 );
			expect( savedData.snapshots[ 0 ] ).toEqual( existingSnapshot );
			expect( savedData.snapshots[ 1 ] ).toEqual( {
				url: mockSiteUrl,
				atomicSiteId: mockSiteId,
				localSiteId: mockSiteIdNumber,
				date: 1234567890,
				name: 'Test Site',
			} );
		} );

		it( 'should create snapshots array if it does not exist', async () => {
			const mockSiteIdNumber = 123;
			const mockUserData = {
				version: 1,
				sites: [
					{
						id: mockSiteIdNumber,
						path: mockSiteFolder,
						name: 'Test Site',
					},
				],
			};

			( fs.existsSync as jest.Mock ).mockReturnValue( true );
			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await addPreviewSiteToAppdata( mockSiteUrl, mockSiteId, mockSiteFolder, mockAction );

			expect( fs.writeFileSync ).toHaveBeenCalled();
			const savedData = JSON.parse( ( fs.writeFileSync as jest.Mock ).mock.calls[ 0 ][ 1 ] );

			expect( savedData.snapshots ).toHaveLength( 1 );
			expect( savedData.snapshots[ 0 ] ).toEqual( {
				url: mockSiteUrl,
				atomicSiteId: mockSiteId,
				localSiteId: mockSiteIdNumber,
				date: 1234567890,
				name: 'Test Site',
			} );
		} );

		it( 'should add userId from authToken if available', async () => {
			const mockSiteIdNumber = 123;
			const mockUserData = {
				version: 1,
				sites: [
					{
						id: mockSiteIdNumber,
						path: mockSiteFolder,
						name: 'Test Site',
					},
				],
				snapshots: [],
				authToken: {
					id: mockUserId,
					accessToken: 'mock-token',
				},
			};

			( fs.existsSync as jest.Mock ).mockReturnValue( true );
			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await addPreviewSiteToAppdata( mockSiteUrl, mockSiteId, mockSiteFolder, mockAction );

			expect( fs.writeFileSync ).toHaveBeenCalled();
			const savedData = JSON.parse( ( fs.writeFileSync as jest.Mock ).mock.calls[ 0 ][ 1 ] );

			expect( savedData.snapshots[ 0 ].userId ).toBe( mockUserId );
		} );

		it( 'should preserve authToken in the appdata file', async () => {
			const mockSiteIdNumber = 123;
			const mockAuthToken = {
				id: mockUserId,
				accessToken: 'mock-token',
				expiresIn: 3600,
				expirationTime: 1234567890,
				email: 'test@example.com',
				displayName: 'Test User',
			};

			const mockUserData = {
				version: 1,
				sites: [
					{
						id: mockSiteIdNumber,
						path: mockSiteFolder,
						name: 'Test Site',
					},
				],
				snapshots: [],
				authToken: mockAuthToken,
				locale: 'en',
			};

			( fs.existsSync as jest.Mock ).mockReturnValue( true );
			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await addPreviewSiteToAppdata( mockSiteUrl, mockSiteId, mockSiteFolder, mockAction );

			expect( fs.writeFileSync ).toHaveBeenCalled();
			const writeCall = ( fs.writeFileSync as jest.Mock ).mock.calls[ 0 ];
			const savedData = JSON.parse( writeCall[ 1 ] );

			expect( savedData.authToken ).toEqual( mockAuthToken );
			expect( savedData.locale ).toBe( 'en' );
		} );

		it( 'should return without error if no matching site is found', async () => {
			const mockUserData = {
				version: 1,
				sites: [
					{
						id: 'site-123',
						path: '/different/path',
						name: 'Different Site',
					},
				],
				snapshots: [],
			};

			( fs.existsSync as jest.Mock ).mockReturnValue( true );
			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await addPreviewSiteToAppdata( mockSiteUrl, mockSiteId, mockSiteFolder, mockAction );

			expect( fs.writeFileSync ).not.toHaveBeenCalled();
		} );

		it( 'should handle errors correctly', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValueOnce( false );

			await expect(
				addPreviewSiteToAppdata( mockSiteUrl, mockSiteId, mockSiteFolder, mockAction )
			).rejects.toThrow( LoggerError );
		} );
	} );
} );
