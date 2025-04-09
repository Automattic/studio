import fs from 'fs';
import os from 'os';
import path from 'path';
import { addPreviewSiteToAppdata } from 'cli/commands/preview/lib/snapshots';
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

describe( 'Snapshots Module', () => {
	const mockHomeDir = '/mock/home';
	const mockSiteFolderName = 'folder';
	const mockSiteUrl = 'test-preview.example.com';
	const mockSiteId = 12345;
	const mockSiteFolder = '/test/folder';
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
		( fs.writeFileSync as jest.Mock ).mockImplementation( () => undefined );
	} );

	describe( 'addPreviewSiteToAppdata', () => {
		it( 'should add a new preview site to appdata', async () => {
			const mockSiteId = 'abc123';
			const mockAtomicSiteId = 123;
			const mockUserData = {
				version: 1,
				sites: [
					{
						id: mockSiteId,
						path: mockSiteFolder,
						name: 'Test Site',
					},
				],
				snapshots: [],
			};

			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await addPreviewSiteToAppdata( mockSiteUrl, mockAtomicSiteId, mockSiteFolder );

			expect( fs.writeFileSync ).toHaveBeenCalled();
			const savedData = JSON.parse( ( fs.writeFileSync as jest.Mock ).mock.calls[ 0 ][ 1 ] );

			expect( savedData.snapshots ).toHaveLength( 1 );
			expect( savedData.snapshots[ 0 ] ).toEqual( {
				url: mockSiteUrl,
				atomicSiteId: mockAtomicSiteId,
				localSiteId: mockSiteId,
				date: 1234567890,
				name: 'Test Site',
			} );
		} );

		it( 'should append to existing snapshots', async () => {
			const mockSiteId = 'abc123';
			const mockAtomicSiteId = 123;
			const existingSnapshot = {
				url: 'existing.com',
				atomicSiteId: mockAtomicSiteId,
				localSiteId: 'existing',
				date: 1000000,
			};

			const mockUserData = {
				version: 1,
				sites: [
					{
						id: mockSiteId,
						path: mockSiteFolder,
						name: 'Test Site',
					},
				],
				snapshots: [ existingSnapshot ],
			};

			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await addPreviewSiteToAppdata( mockSiteUrl, mockAtomicSiteId, mockSiteFolder );

			expect( fs.writeFileSync ).toHaveBeenCalled();
			const savedData = JSON.parse( ( fs.writeFileSync as jest.Mock ).mock.calls[ 0 ][ 1 ] );

			expect( savedData.snapshots ).toHaveLength( 2 );
			expect( savedData.snapshots[ 0 ] ).toEqual( existingSnapshot );
			expect( savedData.snapshots[ 1 ] ).toEqual( {
				url: mockSiteUrl,
				atomicSiteId: mockAtomicSiteId,
				localSiteId: mockSiteId,
				date: 1234567890,
				name: 'Test Site',
			} );
		} );

		it( 'should add userId from authToken if available', async () => {
			const mockSiteId = 'abc123';
			const mockAtomicSiteId = 123;
			const mockUserData = {
				version: 1,
				sites: [
					{
						id: mockSiteId,
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

			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await addPreviewSiteToAppdata( mockSiteUrl, mockAtomicSiteId, mockSiteFolder );

			expect( fs.writeFileSync ).toHaveBeenCalled();
			const savedData = JSON.parse( ( fs.writeFileSync as jest.Mock ).mock.calls[ 0 ][ 1 ] );

			expect( savedData.snapshots[ 0 ].userId ).toBe( mockUserId );
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

			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await addPreviewSiteToAppdata( mockSiteUrl, mockSiteId, mockSiteFolder );

			expect( fs.writeFileSync ).not.toHaveBeenCalled();
		} );

		it( 'should handle errors correctly', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValueOnce( false );

			await expect(
				addPreviewSiteToAppdata( mockSiteUrl, mockSiteId, mockSiteFolder )
			).rejects.toThrow( LoggerError );
		} );
	} );
} );
