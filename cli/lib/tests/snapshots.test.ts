import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	addPreviewSiteToAppdata,
	getSnapshotsFromAppdata,
	deleteSnapshotFromAppdata,
} from 'cli/lib/snapshots';
import { LoggerError } from 'cli/logger';

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

	describe( 'getSnapshotsFromAppdata', () => {
		it( 'should return snapshots filtered by userId', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [
					{ userId: 9876, url: 'test1.com', atomicSiteId: 1, localSiteId: 'site1', date: 1000 },
					{ userId: 1234, url: 'test2.com', atomicSiteId: 2, localSiteId: 'site2', date: 2000 },
				],
			};

			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			const snapshots = await getSnapshotsFromAppdata( 9876 );

			expect( snapshots ).toHaveLength( 1 );
			expect( snapshots[ 0 ] ).toEqual( mockUserData.snapshots[ 0 ] );
		} );

		it( 'should return snapshots filtered by userId and siteFolder', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [
					{ userId: 9876, url: 'test1.com', atomicSiteId: 1, localSiteId: 'site1', date: 1000 },
					{ userId: 9876, url: 'test2.com', atomicSiteId: 2, localSiteId: 'site2', date: 2000 },
				],
				sites: [ { id: 'site1', path: mockSiteFolder, name: 'Test Site' } ],
			};

			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			const snapshots = await getSnapshotsFromAppdata( 9876, mockSiteFolder );

			expect( snapshots ).toHaveLength( 1 );
			expect( snapshots[ 0 ] ).toEqual( mockUserData.snapshots[ 0 ] );
		} );

		it( 'should return empty array if no snapshots exist', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [],
			};

			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			const snapshots = await getSnapshotsFromAppdata( 9876 );

			expect( snapshots ).toHaveLength( 0 );
		} );
	} );

	describe( 'deleteSnapshotFromAppdata', () => {
		it( 'should delete snapshot by url', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [
					{ url: 'test1.com', atomicSiteId: 1, localSiteId: 'site1', date: 1000 },
					{ url: 'test2.com', atomicSiteId: 2, localSiteId: 'site2', date: 2000 },
				],
			};

			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await deleteSnapshotFromAppdata( 'test1.com' );

			expect( fs.writeFileSync ).toHaveBeenCalled();
			const savedData = JSON.parse( ( fs.writeFileSync as jest.Mock ).mock.calls[ 0 ][ 1 ] );
			expect( savedData.snapshots ).toHaveLength( 1 );
			expect( savedData.snapshots[ 0 ].url ).toBe( 'test2.com' );
		} );

		it( 'should not modify snapshots if url not found', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [ { url: 'test1.com', atomicSiteId: 1, localSiteId: 'site1', date: 1000 } ],
			};

			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await deleteSnapshotFromAppdata( 'nonexistent.com' );

			expect( fs.writeFileSync ).not.toHaveBeenCalled();
		} );

		it( 'should handle empty snapshots array', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [],
			};

			( fs.readFileSync as jest.Mock ).mockReturnValue( JSON.stringify( mockUserData ) );

			await deleteSnapshotFromAppdata( 'test1.com' );

			expect( fs.writeFileSync ).not.toHaveBeenCalled();
		} );
	} );
} );
