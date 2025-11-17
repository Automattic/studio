import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { arePathsEqual } from 'common/lib/fs-utils';
import {
	deleteSnapshotFromAppdata,
	getSnapshotsFromAppdata,
	saveSnapshotToAppdata,
	updateSnapshotInAppdata,
} from 'cli/lib/snapshots';
import { LoggerError } from 'cli/logger';

jest.mock( 'fs' );
jest.mock( 'os' );
jest.mock( 'path', () => ( {
	join: jest.fn().mockImplementation( ( ...args ) => args.join( '/' ) ),
	resolve: jest.fn().mockImplementation( ( path ) => path ),
	basename: jest.fn(),
} ) );
jest.mock( 'atomically', () => ( {
	readFile: jest.fn(),
	writeFile: jest.fn(),
} ) );
jest.mock( 'crypto', () => ( {
	randomUUID: jest.fn().mockReturnValue( 'mock-uuid-1234' ),
} ) );
jest.mock( 'lockfile', () => ( {
	lock: jest.fn().mockImplementation( ( path, options, callback ) => callback( null ) ),
	unlock: jest.fn().mockImplementation( ( path, callback ) => callback( null ) ),
} ) );

jest.mock( 'common/lib/fs-utils' );
jest.mock( 'cli/lib/api', () => ( {
	validateAccessToken: jest.fn().mockResolvedValue( undefined ),
} ) );

const mockAuthToken = Object.freeze( {
	accessToken: 'mock-token',
	displayName: 'User Name',
	email: 'user@example.com',
	expirationTime: Date.now() + 3600000, // 1 hour in the future
	expiresIn: 3600,
	id: 123,
} );

describe( 'Snapshots Module', () => {
	const mockHomeDir = '/mock/home';
	const mockSiteFolderName = 'folder';
	const mockSiteUrl = 'test-preview.example.com';
	const mockAtomicSiteId = 12345;
	const mockSiteFolder = '/test/folder';
	const mockUserId = 9876;

	beforeEach( () => {
		jest.clearAllMocks();
		( os.homedir as jest.Mock ).mockReturnValue( mockHomeDir );
		( path.basename as jest.Mock ).mockReturnValue( mockSiteFolderName );
		jest.spyOn( Date, 'now' ).mockReturnValue( 1234567890 );

		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( arePathsEqual as jest.Mock ).mockImplementation( ( path1, path2 ) => path1 === path2 );
		( readFile as jest.Mock ).mockResolvedValue( '{}' );
		( writeFile as jest.Mock ).mockResolvedValue( undefined );
	} );

	describe( 'saveSnapshotToAppdata', () => {
		it( 'should add a new preview site to appdata with sequence number', async () => {
			const mockSiteId = 'abc123';
			const mockUserData = {
				version: 1,
				sites: [
					{
						id: mockSiteId,
						path: mockSiteFolder,
						name: 'Test Site',
						phpVersion: '8.0',
						port: 8881,
					},
				],
				snapshots: [],
				authToken: {
					...mockAuthToken,
					id: mockUserId,
				},
			};

			( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );

			await saveSnapshotToAppdata( mockSiteFolder, mockAtomicSiteId, mockSiteUrl );

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( ( writeFile as jest.Mock ).mock.calls[ 0 ][ 1 ] );

			expect( savedData.snapshots ).toHaveLength( 1 );
			expect( savedData.snapshots[ 0 ] ).toEqual( {
				url: mockSiteUrl,
				atomicSiteId: mockAtomicSiteId,
				localSiteId: mockSiteId,
				date: 1234567890,
				name: 'Test Site Preview 1',
				userId: mockUserId,
				sequence: 1,
			} );
		} );

		it( 'should append to existing snapshots with incremented sequence number', async () => {
			const mockSiteId = 'abc123';
			const existingSnapshot = {
				url: 'existing.com',
				atomicSiteId: mockAtomicSiteId,
				name: 'Existing',
				localSiteId: mockSiteId,
				date: 1000000,
				userId: mockUserId,
				sequence: 1,
			};

			const mockUserData = {
				version: 1,
				sites: [
					{
						id: mockSiteId,
						path: mockSiteFolder,
						name: 'Test Site',
						phpVersion: '8.0',
						port: 8881,
					},
				],
				snapshots: [ existingSnapshot ],
				authToken: {
					...mockAuthToken,
					id: mockUserId,
				},
			};

			( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );

			await saveSnapshotToAppdata( mockSiteFolder, mockAtomicSiteId + 1, mockSiteUrl );

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( ( writeFile as jest.Mock ).mock.calls[ 0 ][ 1 ] );

			expect( savedData.snapshots ).toHaveLength( 2 );
			expect( savedData.snapshots[ 0 ] ).toEqual( existingSnapshot );
			expect( savedData.snapshots[ 1 ] ).toEqual( {
				url: mockSiteUrl,
				atomicSiteId: mockAtomicSiteId + 1,
				localSiteId: mockSiteId,
				date: 1234567890,
				name: 'Test Site Preview 2',
				userId: mockUserId,
				sequence: 2,
			} );
		} );

		it( 'should create a new site if no matching site is found', async () => {
			const mockUserData = {
				version: 1,
				sites: [
					{
						id: 'site-123',
						path: '/different/path',
						name: 'Different Site',
						phpVersion: '8.0',
						port: 8881,
					},
				],
				snapshots: [],
				authToken: {
					...mockAuthToken,
					id: mockUserId,
				},
			};

			let hasWrittenNewSite = false;
			( readFile as jest.Mock ).mockImplementation( async () => {
				if ( hasWrittenNewSite ) {
					return JSON.stringify( {
						...mockUserData,
						newSites: [
							{
								id: 'mock-uuid-1234',
								path: mockSiteFolder,
								name: mockSiteFolderName,
							},
						],
					} );
				}
				return JSON.stringify( mockUserData );
			} );

			( writeFile as jest.Mock ).mockImplementation( async () => {
				hasWrittenNewSite = true;
			} );
			( path.basename as jest.Mock ).mockReturnValueOnce( mockSiteFolderName );

			await saveSnapshotToAppdata( mockSiteFolder, mockAtomicSiteId, mockSiteUrl );

			expect( writeFile ).toHaveBeenCalledTimes( 2 );
			const savedData = JSON.parse( ( writeFile as jest.Mock ).mock.calls[ 1 ][ 1 ] );

			// Check that a new site was created
			expect( savedData.newSites ).toHaveLength( 1 );
			expect( savedData.newSites[ 0 ] ).toEqual( {
				id: 'mock-uuid-1234',
				path: mockSiteFolder,
				name: mockSiteFolderName,
			} );

			// Check that a snapshot was created for the new site
			expect( savedData.snapshots ).toHaveLength( 1 );
			expect( savedData.snapshots[ 0 ] ).toEqual( {
				url: mockSiteUrl,
				atomicSiteId: mockAtomicSiteId,
				localSiteId: 'mock-uuid-1234',
				date: 1234567890,
				name: `${ mockSiteFolderName } Preview 1`,
				userId: mockUserId,
				sequence: 1,
			} );
		} );

		it( 'should append to newSites array if it already exists', async () => {
			const existingNewSite = {
				id: 'existing-new-site',
				path: '/existing/path',
				name: 'Existing New Site',
			};

			const mockUserData = {
				version: 1,
				sites: [],
				newSites: [ existingNewSite ],
				snapshots: [],
				authToken: {
					...mockAuthToken,
					id: mockUserId,
				},
			};

			let hasWrittenNewSite = false;
			( readFile as jest.Mock ).mockImplementation( async () => {
				if ( hasWrittenNewSite ) {
					return JSON.stringify( {
						...mockUserData,
						newSites: [
							existingNewSite,
							{
								id: 'mock-uuid-1234',
								path: mockSiteFolder,
								name: mockSiteFolderName,
							},
						],
					} );
				}
				return JSON.stringify( mockUserData );
			} );

			( writeFile as jest.Mock ).mockImplementation( async () => {
				hasWrittenNewSite = true;
			} );
			( path.basename as jest.Mock ).mockReturnValueOnce( mockSiteFolderName );

			await saveSnapshotToAppdata( mockSiteFolder, mockAtomicSiteId, mockSiteUrl );

			expect( writeFile ).toHaveBeenCalledTimes( 2 );
			const savedData = JSON.parse( ( writeFile as jest.Mock ).mock.calls[ 1 ][ 1 ] );

			// Check that the new site was added to existing newSites array
			expect( savedData.newSites ).toHaveLength( 2 );
			expect( savedData.newSites[ 0 ] ).toEqual( existingNewSite );
			expect( savedData.newSites[ 1 ] ).toEqual( {
				id: 'mock-uuid-1234',
				path: mockSiteFolder,
				name: mockSiteFolderName,
			} );

			// Check that a snapshot was created for the new site
			expect( savedData.snapshots ).toHaveLength( 1 );
			expect( savedData.snapshots[ 0 ] ).toEqual( {
				url: mockSiteUrl,
				atomicSiteId: mockAtomicSiteId,
				localSiteId: 'mock-uuid-1234',
				date: 1234567890,
				name: `${ mockSiteFolderName } Preview 1`,
				userId: mockUserId,
				sequence: 1,
			} );
		} );

		it( 'should handle errors correctly', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValueOnce( false );

			await expect(
				saveSnapshotToAppdata( mockSiteFolder, mockAtomicSiteId, mockSiteUrl )
			).rejects.toThrow( LoggerError );
		} );

		it( 'should only create a new site when getSiteByFolder throws a LoggerError', async () => {
			const mockUserData = {
				version: 1,
				sites: [],
				snapshots: [],
				authToken: {
					...mockAuthToken,
					id: mockUserId,
				},
			};

			( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );

			// Mock fs.existsSync to throw a different error first, then a LoggerError
			const fsExistsSyncMock = fs.existsSync as jest.Mock;
			fsExistsSyncMock
				.mockImplementationOnce( () => {
					throw new Error( 'Some other error' );
				} )
				.mockReturnValueOnce( true );

			await expect(
				saveSnapshotToAppdata( mockSiteFolder, mockAtomicSiteId, mockSiteUrl )
			).rejects.toThrow( 'Some other error' );

			expect( writeFile ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'updateSnapshotInAppdata', () => {
		it( 'should update the date of an existing snapshot', async () => {
			const mockSiteId = 'abc123';
			const mockUserData = {
				version: 1,
				snapshots: [
					{
						url: 'test.com',
						atomicSiteId: mockAtomicSiteId,
						localSiteId: mockSiteId,
						date: 1000000,
						name: 'Test Site Preview 1',
						userId: mockUserId,
						sequence: 1,
					},
				],
				sites: [
					{
						id: mockSiteId,
						path: mockSiteFolder,
						name: 'Test Site',
						phpVersion: '8.0',
						port: 8881,
					},
				],
			};

			( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );

			const updatedSnapshot = await updateSnapshotInAppdata( mockAtomicSiteId, mockSiteFolder );

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( ( writeFile as jest.Mock ).mock.calls[ 0 ][ 1 ] );

			expect( savedData.snapshots[ 0 ].date ).toBe( 1234567890 );
			expect( updatedSnapshot ).toEqual( savedData.snapshots[ 0 ] );
			expect( updatedSnapshot.date ).toBe( 1234567890 );
		} );

		it( 'should throw an error if snapshot not found', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [],
			};

			( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );

			await expect( updateSnapshotInAppdata( mockAtomicSiteId, mockSiteFolder ) ).rejects.toThrow(
				LoggerError
			);
		} );
	} );

	describe( 'getSnapshotsFromAppdata', () => {
		it( 'should return snapshots filtered by userId', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [
					{
						userId: 9876,
						url: 'test1.com',
						name: 'Site 1 Preview 1',
						atomicSiteId: 1,
						localSiteId: 'site1',
						date: 1000,
						sequence: 1,
					},
					{
						userId: 1234,
						url: 'test2.com',
						name: 'Site 2 Preview 1',
						atomicSiteId: 2,
						localSiteId: 'site2',
						date: 2000,
						sequence: 1,
					},
				],
			};

			( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );

			const snapshots = await getSnapshotsFromAppdata( 9876 );

			expect( snapshots ).toHaveLength( 1 );
			expect( snapshots[ 0 ] ).toEqual( mockUserData.snapshots[ 0 ] );
		} );

		it( 'should return snapshots filtered by userId and siteFolder', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [
					{
						userId: 9876,
						url: 'test1.com',
						name: 'Site 1 Preview 1',
						atomicSiteId: 1,
						localSiteId: 'site1',
						date: 1000,
						sequence: 1,
					},
					{
						userId: 9876,
						url: 'test2.com',
						name: 'Site 2 Preview 1',
						atomicSiteId: 2,
						localSiteId: 'site2',
						date: 2000,
						sequence: 1,
					},
				],
				sites: [
					{ id: 'site1', path: mockSiteFolder, name: 'Test Site', phpVersion: '8.0', port: 8881 },
				],
			};

			( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );

			const snapshots = await getSnapshotsFromAppdata( 9876, mockSiteFolder );

			expect( snapshots ).toHaveLength( 1 );
			expect( snapshots[ 0 ] ).toEqual( mockUserData.snapshots[ 0 ] );
		} );

		it( 'should return empty array if no snapshots exist', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [],
			};

			( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );

			const snapshots = await getSnapshotsFromAppdata( 9876 );

			expect( snapshots ).toHaveLength( 0 );
		} );
	} );

	describe( 'deleteSnapshotFromAppdata', () => {
		it( 'should delete snapshot by url', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [
					{
						url: 'test1.com',
						name: 'Site 1 Preview 1',
						atomicSiteId: 1,
						localSiteId: 'site1',
						date: 1000,
						sequence: 1,
					},
					{
						url: 'test2.com',
						name: 'Site 2 Preview 1',
						atomicSiteId: 2,
						localSiteId: 'site2',
						date: 2000,
						sequence: 1,
					},
				],
			};

			( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );

			await deleteSnapshotFromAppdata( 'test1.com' );

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( ( writeFile as jest.Mock ).mock.calls[ 0 ][ 1 ] );
			expect( savedData.snapshots ).toHaveLength( 1 );
			expect( savedData.snapshots[ 0 ].url ).toBe( 'test2.com' );
		} );

		it( 'should not modify snapshots if url not found', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [
					{
						url: 'test1.com',
						atomicSiteId: 1,
						name: 'Site Preview 1',
						localSiteId: 'site1',
						date: 1000,
						sequence: 1,
					},
				],
			};

			( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );

			await deleteSnapshotFromAppdata( 'nonexistent.com' );

			expect( writeFile ).not.toHaveBeenCalled();
		} );

		it( 'should handle empty snapshots array', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [],
			};

			( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );

			await deleteSnapshotFromAppdata( 'test1.com' );

			expect( writeFile ).not.toHaveBeenCalled();
		} );
	} );
} );
