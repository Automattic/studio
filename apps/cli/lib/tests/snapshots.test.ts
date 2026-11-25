import fs from 'fs';
import { CONFIG_VERSION } from '@studio/common/lib/config/schema';
import { writeFile } from 'atomically';
import { vol } from 'memfs';
import { vi } from 'vitest';
import { linkPulledPreview, reconcilePreviews } from 'cli/lib/cli-config/snapshots';
import {
	deleteSnapshotFromConfig,
	getSnapshotsFromConfig,
	pruneExpiredOrphanedSnapshots,
	saveSnapshotToConfig,
	updateSnapshotInConfig,
} from 'cli/lib/snapshots';
import { LoggerError } from 'cli/logger';
import type { Snapshot } from '@studio/common/types/snapshot';

const mocks = vi.hoisted( () => ( {
	readFile: vi.fn(),
	writeFile: vi.fn(),
	pathJoin: vi.fn().mockImplementation( ( ...args: string[] ) => args.join( '/' ) ),
	pathResolve: vi.fn().mockImplementation( ( path: string ) => path ),
	pathDirname: vi
		.fn()
		.mockImplementation( ( p: string ) => p.split( '/' ).slice( 0, -1 ).join( '/' ) ),
	pathBasename: vi.fn(),
	arePathsEqual: vi.fn(),
	isWordPressDirectory: vi.fn(),
	homedir: vi.fn(),
} ) );

vi.mock( 'fs' );
vi.mock( 'os', () => ( { default: { homedir: mocks.homedir }, homedir: mocks.homedir } ) );
vi.mock( 'path', () => ( {
	default: {
		join: mocks.pathJoin,
		resolve: mocks.pathResolve,
		dirname: mocks.pathDirname,
		basename: mocks.pathBasename,
	},
	join: mocks.pathJoin,
	resolve: mocks.pathResolve,
	dirname: mocks.pathDirname,
	basename: mocks.pathBasename,
} ) );
vi.mock( 'atomically', () => ( {
	readFile: mocks.readFile,
	writeFile: mocks.writeFile,
} ) );
vi.mock( '@studio/common/lib/fs-utils', () => ( {
	arePathsEqual: mocks.arePathsEqual,
	isWordPressDirectory: mocks.isWordPressDirectory,
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
	const mockShareUrl = `https://${ mockSiteUrl }/?share=abc123`;
	const mockAtomicSiteId = 12345;
	const mockSiteFolder = '/test/folder';
	const mockUserId = 9876;
	const mockPreview = {
		id: mockAtomicSiteId,
		name: mockSiteUrl,
		url: `https://${ mockSiteUrl }`,
		shareUrl: mockShareUrl,
	};

	beforeEach( () => {
		vi.clearAllMocks();
		vol.reset();
		mocks.homedir.mockReturnValue( mockHomeDir );
		mocks.pathBasename.mockReturnValue( mockSiteFolderName );
		vi.spyOn( Date, 'now' ).mockReturnValue( 1234567890 );

		vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
		mocks.arePathsEqual.mockImplementation( ( path1, path2 ) => path1 === path2 );
		mocks.readFile.mockResolvedValue( '{}' );
		mocks.writeFile.mockResolvedValue( undefined );
	} );

	describe( 'saveSnapshotToConfig', () => {
		it( 'should add a new preview site to appdata with sequence number', async () => {
			const mockSiteId = 'abc123';
			const mockUserData = {
				version: CONFIG_VERSION,
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

			await saveSnapshotToConfig( mockSiteFolder, mockPreview, mockUserId, 'Test Site Preview 1' );

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
				shareUrl: mockShareUrl,
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
				version: CONFIG_VERSION,
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

			await saveSnapshotToConfig(
				mockSiteFolder,
				{ ...mockPreview, id: mockAtomicSiteId + 1 },
				mockUserId,
				'Test Site Preview 2'
			);

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
				shareUrl: mockShareUrl,
			} );
		} );

		it( 'should throw error if site is not found', async () => {
			const mockUserData = {
				version: CONFIG_VERSION,
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
				saveSnapshotToConfig( mockSiteFolder, mockPreview, mockUserId, 'Test' )
			).rejects.toThrow( LoggerError );

			expect( writeFile ).not.toHaveBeenCalled();
		} );

		it( 'should handle errors correctly', async () => {
			vi.spyOn( fs, 'existsSync' ).mockReturnValueOnce( false );

			await expect(
				saveSnapshotToConfig( mockSiteFolder, mockPreview, mockUserId, 'Test' )
			).rejects.toThrow( LoggerError );
		} );
	} );

	describe( 'updateSnapshotInConfig', () => {
		it( 'should update the date of an existing snapshot', async () => {
			const mockSiteId = 'abc123';
			const mockUserData = {
				version: CONFIG_VERSION,
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

			const updatedSnapshot = await updateSnapshotInConfig( mockSiteFolder, mockPreview );

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( mocks.writeFile.mock.calls[ 0 ][ 1 ] );

			expect( savedData.snapshots[ 0 ].date ).toBe( 1234567890 );
			expect( savedData.snapshots[ 0 ] ).not.toHaveProperty( 'syncedAt' );
			expect( updatedSnapshot ).toEqual( { ...savedData.snapshots[ 0 ], syncedAt: 1234567890 } );
			expect( updatedSnapshot.date ).toBe( 1234567890 );
		} );

		it( 'should throw an error if snapshot not found', async () => {
			const mockUserData = {
				version: CONFIG_VERSION,
				snapshots: [],
			};

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

			await expect( updateSnapshotInConfig( mockSiteFolder, mockPreview ) ).rejects.toThrow(
				LoggerError
			);
		} );
	} );

	describe( 'getSnapshotsFromConfig', () => {
		it( 'should return snapshots filtered by userId', async () => {
			const mockUserData = {
				version: CONFIG_VERSION,
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

			const snapshots = await getSnapshotsFromConfig( 9876 );

			expect( snapshots ).toHaveLength( 1 );
			expect( snapshots[ 0 ] ).toEqual( mockUserData.snapshots[ 0 ] );
		} );

		it( 'should return snapshots filtered by userId and siteFolder', async () => {
			const mockUserData = {
				version: CONFIG_VERSION,
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

			const snapshots = await getSnapshotsFromConfig( 9876, mockSiteFolder );

			expect( snapshots ).toHaveLength( 1 );
			expect( snapshots[ 0 ] ).toEqual( mockUserData.snapshots[ 0 ] );
		} );

		it( 'should return empty array if no snapshots exist', async () => {
			const mockUserData = {
				version: CONFIG_VERSION,
				snapshots: [],
			};

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

			const snapshots = await getSnapshotsFromConfig( 9876 );

			expect( snapshots ).toHaveLength( 0 );
		} );
	} );

	describe( 'deleteSnapshotFromConfig', () => {
		it( 'should delete snapshot by url', async () => {
			const mockUserData = {
				version: CONFIG_VERSION,
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

			await deleteSnapshotFromConfig( 'test1.com' );

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( mocks.writeFile.mock.calls[ 0 ][ 1 ] );
			expect( savedData.snapshots ).toHaveLength( 1 );
			expect( savedData.snapshots[ 0 ].url ).toBe( 'test2.com' );
		} );

		it( 'should not modify snapshots if url not found', async () => {
			const mockUserData = {
				version: CONFIG_VERSION,
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

			await deleteSnapshotFromConfig( 'nonexistent.com' );

			expect( writeFile ).not.toHaveBeenCalled();
		} );

		it( 'should handle empty snapshots array', async () => {
			const mockUserData = {
				version: CONFIG_VERSION,
				snapshots: [],
			};

			mocks.readFile.mockResolvedValue( JSON.stringify( mockUserData ) );

			await deleteSnapshotFromConfig( 'test1.com' );

			expect( writeFile ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'pruneExpiredOrphanedSnapshots', () => {
		const USER_ID = 42;
		const isExpired = ( s: Snapshot ) => s.date < 5000;

		it( 'should remove only expired snapshots with no associated site for the given user', async () => {
			const mockData = {
				version: CONFIG_VERSION,
				sites: [ { id: 'live-site', name: 'Live', path: '/x', port: 80, phpVersion: '8.3' } ],
				snapshots: [
					{
						url: 'live-fresh.com',
						atomicSiteId: 1,
						localSiteId: 'live-site',
						date: 9000,
						userId: USER_ID,
					},
					{
						url: 'live-expired.com',
						atomicSiteId: 2,
						localSiteId: 'live-site',
						date: 1000,
						userId: USER_ID,
					},
					{
						url: 'orphan-fresh.com',
						atomicSiteId: 3,
						localSiteId: 'dead-site',
						date: 9000,
						userId: USER_ID,
					},
					{
						url: 'orphan-expired.com',
						atomicSiteId: 4,
						localSiteId: 'dead-site',
						date: 1000,
						userId: USER_ID,
					},
					{
						url: 'other-user-orphan-expired.com',
						atomicSiteId: 5,
						localSiteId: 'dead-site',
						date: 1000,
						userId: 999,
					},
				],
			};
			mocks.readFile.mockResolvedValue( JSON.stringify( mockData ) );

			const pruned = await pruneExpiredOrphanedSnapshots( USER_ID, isExpired );

			expect( pruned ).toBe( 1 );
			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( mocks.writeFile.mock.calls[ 0 ][ 1 ] );
			const urls = savedData.snapshots.map( ( s: Snapshot ) => s.url ).sort();
			expect( urls ).toEqual( [
				'live-expired.com',
				'live-fresh.com',
				'orphan-fresh.com',
				'other-user-orphan-expired.com',
			] );
		} );

		it( 'should not write the config when nothing needs pruning', async () => {
			const mockData = {
				version: CONFIG_VERSION,
				sites: [ { id: 'live-site', name: 'Live', path: '/x', port: 80, phpVersion: '8.3' } ],
				snapshots: [
					{
						url: 'live-fresh.com',
						atomicSiteId: 1,
						localSiteId: 'live-site',
						date: 9000,
						userId: USER_ID,
					},
				],
			};
			mocks.readFile.mockResolvedValue( JSON.stringify( mockData ) );

			const pruned = await pruneExpiredOrphanedSnapshots( USER_ID, isExpired );

			expect( pruned ).toBe( 0 );
			expect( writeFile ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'reconcilePreviews', () => {
		const USER_ID = 42;
		const snapshot = ( url: string, atomicSiteId: number, date: number, userId = USER_ID ) => ( {
			url,
			atomicSiteId,
			localSiteId: 'site',
			date,
			userId,
		} );

		it( 'refreshes, clears and discovers the server’s preview launch URLs', async () => {
			mocks.readFile.mockResolvedValue(
				JSON.stringify( {
					version: CONFIG_VERSION,
					sites: [],
					snapshots: [
						{
							...snapshot( 'first.wpcomstaging.com', 1, 1000 ),
							launchUrl: 'https://wordpress.com/old',
						},
						{
							...snapshot( 'linked.wpcomstaging.com', 2, 1000 ),
							launchUrl: 'https://wordpress.com/stale',
						},
					],
				} )
			);
			await reconcilePreviews(
				USER_ID,
				[
					{
						id: 1,
						name: 'First',
						url: 'https://first.wpcomstaging.com',
						launchUrl: 'https://wordpress.com/launch/1',
					},
					{ id: 2, name: 'Linked', url: 'https://linked.wpcomstaging.com', liveSiteId: 20 },
					{
						id: 3,
						name: 'New',
						url: 'https://new.wpcomstaging.com',
						launchUrl: 'https://wordpress.com/launch/3',
					},
				],
				5000
			);
			const saved = JSON.parse( mocks.writeFile.mock.calls[ 0 ][ 1 ] );
			expect(
				saved.snapshots.map( ( item: Snapshot ) => [ item.atomicSiteId, item.launchUrl ] )
			).toEqual( [
				[ 1, 'https://wordpress.com/launch/1' ],
				[ 2, undefined ],
				[ 3, 'https://wordpress.com/launch/3' ],
			] );
		} );

		it( "forgets the user's ended WordPress.com previews, updates the rest and lists ones made elsewhere", async () => {
			// The live site a preview shows changes to follows the server: set, cleared and listed.
			mocks.readFile.mockResolvedValue(
				JSON.stringify( {
					version: CONFIG_VERSION,
					sites: [],
					snapshots: [
						snapshot( 'standing.wpcomstaging.com', 1, 1000 ),
						snapshot( 'ended.wpcomstaging.com', 2, 1000 ),
						snapshot( 'saved-after-check.wpcomstaging.com', 3, 6000 ),
						snapshot( 'legacy.wp.build', 4, 1000 ),
						snapshot( 'other-user.wpcomstaging.com', 5, 1000, 999 ),
						{ ...snapshot( 'unlinked.wpcomstaging.com', 7, 1000 ), liveSiteId: 70 },
					],
				} )
			);

			const shareUrl = 'https://standing.wpcomstaging.com/?share=abc';
			const elsewhereUrl = 'https://elsewhere.wpcomstaging.com/?share=def';
			await reconcilePreviews(
				USER_ID,
				[
					{
						id: 1,
						name: 'standing.wpcomstaging.com',
						url: 'https://standing.wpcomstaging.com',
						expiresAt: 9000,
						shareUrl,
						liveSiteId: 10,
					},
					{
						id: 6,
						name: 'elsewhere.wpcomstaging.com',
						url: 'https://elsewhere.wpcomstaging.com',
						expiresAt: 8000,
						shareUrl: elsewhereUrl,
						liveSiteId: 60,
					},
					{
						id: 7,
						name: 'unlinked.wpcomstaging.com',
						url: 'https://unlinked.wpcomstaging.com',
						expiresAt: 7000,
					},
				],
				5000
			);

			const savedData = JSON.parse( mocks.writeFile.mock.calls[ 0 ][ 1 ] );
			expect(
				savedData.snapshots.map( ( s: Snapshot ) => [
					s.url,
					s.expiresAt,
					s.shareUrl,
					s.liveSiteId,
				] )
			).toEqual( [
				[ 'standing.wpcomstaging.com', 9000, shareUrl, 10 ],
				[ 'saved-after-check.wpcomstaging.com', undefined, undefined, undefined ],
				[ 'legacy.wp.build', undefined, undefined, undefined ],
				[ 'other-user.wpcomstaging.com', undefined, undefined, undefined ],
				[ 'unlinked.wpcomstaging.com', 7000, undefined, undefined ],
				[ 'elsewhere.wpcomstaging.com', 8000, elsewhereUrl, 60 ],
			] );
		} );

		it( 'puts a preview back with the local site WordPress.com says it was made from, when that site is here', async () => {
			mocks.readFile.mockResolvedValue(
				JSON.stringify( {
					version: CONFIG_VERSION,
					sites: [
						{ id: 'here', path: '/sites/here', name: 'Here', phpVersion: '8.0', port: 8881 },
					],
					snapshots: [
						{ ...snapshot( 'saved-unlinked.wpcomstaging.com', 1, 1000 ), localSiteId: '' },
						{ ...snapshot( 'saved-linked.wpcomstaging.com', 2, 1000 ), localSiteId: 'other' },
					],
				} )
			);
			const preview = ( id: number, extra: object = {} ) => ( {
				id,
				name: `p${ id }.wpcomstaging.com`,
				url: `https://p${ id }.wpcomstaging.com`,
				...extra,
			} );

			await reconcilePreviews(
				USER_ID,
				[
					preview( 1, { originId: 'here' } ),
					// A saved preview keeps the site it is saved with.
					preview( 2, { originId: 'here' } ),
					// Not saved here, such as one whose first build failed.
					preview( 3, { originId: 'here', title: 'Here Preview 2' } ),
					// Made from a site on another computer.
					preview( 4, { originId: 'gone', title: 'Elsewhere Preview 1' } ),
					preview( 5 ),
				],
				5000
			);

			const savedData = JSON.parse( mocks.writeFile.mock.calls[ 0 ][ 1 ] );
			expect(
				savedData.snapshots.map( ( s: Snapshot ) => [ s.atomicSiteId, s.localSiteId, s.name ] )
			).toEqual( [
				[ 1, 'here', undefined ],
				[ 2, 'other', undefined ],
				[ 3, 'here', 'Here Preview 2' ],
				[ 4, '', 'Elsewhere Preview 1' ],
				[ 5, '', undefined ],
			] );
		} );
	} );

	describe( 'linkPulledPreview', () => {
		it( 'attaches a pulled preview and its version to the local site, unless another site has it', async () => {
			const preview = ( url: string, atomicSiteId: number, localSiteId: string ) => ( {
				url,
				atomicSiteId,
				localSiteId,
				date: 1000,
				userId: 42,
			} );
			mocks.readFile.mockResolvedValue(
				JSON.stringify( {
					version: CONFIG_VERSION,
					sites: [
						{
							id: 'pulled-site',
							name: 'Local',
							path: '/local',
							port: 8881,
							phpVersion: '8.3',
							connections: [
								{
									provider: 'wpcom',
									account: '42',
									preview: true,
									site: { id: 4 },
									localVersionId: 'old',
									lastPushTimestamp: new Date( 1 ).toISOString(),
								},
							],
						},
					],
					snapshots: [
						preview( 'made-elsewhere.wpcomstaging.com', 1, '' ),
						preview( 'taken.wpcomstaging.com', 2, 'other-site' ),
						preview( 'pulled-before.wpcomstaging.com', 4, 'pulled-site' ),
					],
				} )
			);
			const standing = ( id: number ) => ( {
				id,
				name: 'unlisted.wpcomstaging.com',
				url: 'https://unlisted.wpcomstaging.com',
				expiresAt: 9000,
			} );

			for ( const atomicSiteId of [ 1, 2, 3, 4 ] ) {
				// The pull of preview 4 was partial, which leaves its sync unknown.
				const sync =
					atomicSiteId === 4 ? undefined : { versionId: `v${ atomicSiteId }`, syncedAt: 5 };
				const previewSite = standing( atomicSiteId );
				await linkPulledPreview(
					'pulled-site',
					42,
					previewSite,
					{
						...previewSite,
						localSiteId: '',
						isStaging: false,
						isPressable: false,
						syncSupport: 'syncable',
						lastPushTimestamp: null,
						lastPullTimestamp: null,
					},
					sync
				);
				mocks.readFile.mockResolvedValue( mocks.writeFile.mock.lastCall?.[ 1 ] );
			}

			expect(
				( await getSnapshotsFromConfig( 42 ) ).map( ( s: Snapshot ) => [
					s.url,
					s.localSiteId,
					s.versionId,
					s.syncedAt,
				] )
			).toEqual( [
				[ 'made-elsewhere.wpcomstaging.com', 'pulled-site', 'v1', 5 ],
				[ 'taken.wpcomstaging.com', 'other-site', undefined, undefined ],
				[ 'pulled-before.wpcomstaging.com', 'pulled-site', undefined, undefined ],
				[ 'unlisted.wpcomstaging.com', 'pulled-site', 'v3', 5 ],
			] );
		} );
	} );
} );
