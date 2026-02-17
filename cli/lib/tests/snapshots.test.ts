import { writeFile } from 'atomically';
import { vi } from 'vitest';
import {
	deleteSnapshotFromAppdata,
	getSnapshotsFromAppdata,
	saveSnapshotToAppdata,
	updateSnapshotInAppdata,
} from 'cli/lib/snapshots';
import { LoggerError } from 'cli/logger';

const mocks = vi.hoisted( () => ( {
	readFile: vi.fn(),
	writeFile: vi.fn(),
	pathJoin: vi.fn().mockImplementation( ( ...args: string[] ) => args.join( '/' ) ),
	pathResolve: vi.fn().mockImplementation( ( path: string ) => path ),
	pathBasename: vi.fn(),
	lockfileLock: vi.fn().mockImplementation( ( path, options, callback ) => callback( null ) ),
	lockfileUnlock: vi.fn().mockImplementation( ( path, callback ) => callback( null ) ),
	arePathsEqual: vi.fn(),
	isWordPressDirectory: vi.fn(),
	existsSync: vi.fn(),
	homedir: vi.fn(),
} ) );

vi.mock( 'fs', () => ( {
	default: { existsSync: mocks.existsSync },
	existsSync: mocks.existsSync,
} ) );
vi.mock( 'os', () => ( { default: { homedir: mocks.homedir }, homedir: mocks.homedir } ) );
vi.mock( 'path', () => ( {
	default: { join: mocks.pathJoin, resolve: mocks.pathResolve, basename: mocks.pathBasename },
	join: mocks.pathJoin,
	resolve: mocks.pathResolve,
	basename: mocks.pathBasename,
} ) );
vi.mock( 'atomically', () => ( {
	readFile: mocks.readFile,
	writeFile: mocks.writeFile,
} ) );
vi.mock( 'lockfile', () => ( {
	default: { lock: mocks.lockfileLock, unlock: mocks.lockfileUnlock },
	lock: mocks.lockfileLock,
	unlock: mocks.lockfileUnlock,
} ) );
vi.mock( 'common/lib/fs-utils', () => ( {
	arePathsEqual: mocks.arePathsEqual,
	isWordPressDirectory: mocks.isWordPressDirectory,
} ) );
vi.mock( 'cli/lib/api', () => ( { validateAccessToken: vi.fn().mockResolvedValue( undefined ) } ) );

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
		vi.clearAllMocks();
		mocks.homedir.mockReturnValue( mockHomeDir );
		mocks.pathBasename.mockReturnValue( mockSiteFolderName );
		vi.spyOn( Date, 'now' ).mockReturnValue( 1234567890 );

		mocks.existsSync.mockReturnValue( true );
		mocks.arePathsEqual.mockImplementation( ( path1, path2 ) => path1 === path2 );
		mocks.readFile.mockResolvedValue( '{}' );
		mocks.writeFile.mockResolvedValue( undefined );
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

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

			await saveSnapshotToAppdata( mockSiteFolder, mockAtomicSiteId, mockSiteUrl );

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( mocks.writeFile.mock.calls[ 0 ][ 1 ] );

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

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

			await saveSnapshotToAppdata( mockSiteFolder, mockAtomicSiteId + 1, mockSiteUrl );

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( mocks.writeFile.mock.calls[ 0 ][ 1 ] );

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

		it( 'should throw error if site is not found', async () => {
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

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

			await expect(
				saveSnapshotToAppdata( mockSiteFolder, mockAtomicSiteId, mockSiteUrl )
			).rejects.toThrow( LoggerError );

			expect( writeFile ).not.toHaveBeenCalled();
		} );

		it( 'should handle errors correctly', async () => {
			mocks.existsSync.mockReturnValueOnce( false );

			await expect(
				saveSnapshotToAppdata( mockSiteFolder, mockAtomicSiteId, mockSiteUrl )
			).rejects.toThrow( LoggerError );
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

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

			const updatedSnapshot = await updateSnapshotInAppdata( mockAtomicSiteId, mockSiteFolder );

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( mocks.writeFile.mock.calls[ 0 ][ 1 ] );

			expect( savedData.snapshots[ 0 ].date ).toBe( 1234567890 );
			expect( updatedSnapshot ).toEqual( savedData.snapshots[ 0 ] );
			expect( updatedSnapshot.date ).toBe( 1234567890 );
		} );

		it( 'should throw an error if snapshot not found', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [],
			};

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

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

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

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

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

			const snapshots = await getSnapshotsFromAppdata( 9876, mockSiteFolder );

			expect( snapshots ).toHaveLength( 1 );
			expect( snapshots[ 0 ] ).toEqual( mockUserData.snapshots[ 0 ] );
		} );

		it( 'should return empty array if no snapshots exist', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [],
			};

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

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

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

			await deleteSnapshotFromAppdata( 'test1.com' );

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( mocks.writeFile.mock.calls[ 0 ][ 1 ] );
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

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

			await deleteSnapshotFromAppdata( 'nonexistent.com' );

			expect( writeFile ).not.toHaveBeenCalled();
		} );

		it( 'should handle empty snapshots array', async () => {
			const mockUserData = {
				version: 1,
				snapshots: [],
			};

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

			await deleteSnapshotFromAppdata( 'test1.com' );

			expect( writeFile ).not.toHaveBeenCalled();
		} );
	} );
} );
