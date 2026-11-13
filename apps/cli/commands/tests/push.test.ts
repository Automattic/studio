import { once } from 'events';
import fs from 'fs';
import * as configFile from '@studio/common/lib/cli-config-file';
import { readProviderConfig } from '@studio/common/lib/provider-config';
import { getRemoteSites, rememberRemoteSite } from '@studio/common/lib/remote-sites';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { RemoteSiteError, type PushContent, type PushStatus } from '@studio/providers';
import { getProvider } from '@studio/providers/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getExporter } from 'cli/lib/import-export/export/export-manager';
import { getSiteVersion } from 'cli/lib/site-versions';
import { exportStaticContent } from 'cli/lib/static-content';
import { onCancel, reportSyncActivity } from 'cli/lib/sync-activity';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { runCommand } from '../push';
import type { SyncSite } from '@studio/common/types/sync';
import type { SiteData } from 'cli/lib/cli-config/core';
import type { Readable } from 'stream';

vi.mock( '@studio/common/lib/shared-config', async ( importActual ) => ( {
	...( await importActual< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/remote-sites' );
vi.mock( '@studio/common/lib/provider-config', async ( importActual ) => ( {
	...( await importActual< typeof import('@studio/common/lib/provider-config') >() ),
	readProviderConfig: vi.fn(),
} ) );
vi.mock( 'cli/lib/static-content' );
vi.mock( '@studio/common/lib/deploy-ignore' );
vi.mock( 'cli/lib/cli-config/sites', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/cli-config/sites') >() ),
	getSiteByFolder: vi.fn(),
} ) );
vi.mock( 'cli/lib/import-export/export/export-manager' );
vi.mock( 'cli/lib/site-operations', () => ( {
	withSiteOperation: ( _folder: string, _kind: string, fn: () => unknown ) => fn(),
} ) );
vi.mock( 'cli/lib/sqlite-integration' );
vi.mock( 'cli/lib/site-versions', () => ( {
	getSiteVersion: vi.fn().mockResolvedValue( 'before-upload' ),
} ) );
vi.mock( 'cli/lib/sync-activity' );
vi.mock( 'cli/lib/sync-api', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/sync-api') >() ),
	fetchSyncableSites: vi.fn(),
} ) );
vi.mock( '@studio/providers/services', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/providers/services') >();
	const sites = {
		wpcom: { push: vi.fn() },
		spacefast: { list: vi.fn(), create: vi.fn(), push: vi.fn() },
	};
	return {
		...actual,
		getProvider: ( id: keyof typeof sites ) => ( {
			...actual.getProvider( id ),
			sites: sites[ id ],
		} ),
	};
} );
vi.mock( 'cli/lib/tracks' );
vi.mock( 'cli/lib/snapshots', () => ( { getSnapshotsFromConfig: vi.fn().mockResolvedValue( [] ) } ) );

const wpcomSites = getProvider( 'wpcom' ).sites!;
const site = { id: 'site-1', path: '/test/site', phpVersion: '8.3' } as SiteData;
const remoteSite = { id: 42, name: 'Live', syncSupport: 'syncable' } as SyncSite;

const readArchive = ( content: PushContent ) =>
	once(
		( ( content as Extract< PushContent, { kind: 'archive' } > ).file as Readable ).resume(),
		'close'
	);

// Reads the archive to the end, as the real upload does before the push removes it, reports
// `statuses`, then ends with `outcome`.
function pushes( statuses: PushStatus[], outcome?: Error ) {
	vi.mocked( wpcomSites.push ).mockImplementation(
		async ( _config, _site, content: PushContent, _options, onStatus ) => {
			await readArchive( content );
			statuses.forEach( onStatus );
			if ( outcome ) {
				throw outcome;
			}
		}
	);
}

function reported() {
	return vi.mocked( reportSyncActivity ).mock.calls.map( ( [ , activity ] ) => activity );
}

const siteTracksId = '6ad36785-267a-4e6d-b036-0a7460c76497';
beforeEach( () => {
	vi.spyOn( configFile, 'readCliConfigFileRaw' ).mockResolvedValue( {
		version: 1,
		sites: [ { id: 'site-1', name: 'Private title', path: '/test/site', tracksId: siteTracksId } ],
		snapshots: [],
	} );
} );
afterEach( () => vi.restoreAllMocks() );

describe( 'CLI: studio push', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( onCancel ).mockReturnValue( () => true );
		vi.mocked( readAuthToken ).mockResolvedValue( { accessToken: 'token' } as never );
		vi.mocked( getSiteByFolder ).mockResolvedValue( site );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [ remoteSite ] );
		vi.mocked( getRemoteSites ).mockResolvedValue( [] );
		pushes( [] );
		vi.mocked( getExporter ).mockImplementation( async ( { backupFile } ) => {
			return {
				on: vi.fn(),
				export: async () => fs.writeFileSync( backupFile, 'archive' ),
			} as never;
		} );
	} );

	it.each( [ false, true ] )(
		'records the successful push and retains intent only on launch failure: %s',
		async ( failed ) => {
			vi.mocked( getRemoteSites ).mockResolvedValue( [ { ...remoteSite, launchAfterPush: true } ] );
			vi.mocked( wpcomSites.push ).mockImplementation(
				async ( _config, _site, content, options, onStatus ) => {
					await readArchive( content );
					expect( options.launchAfterPush ).toBe( true );
					onStatus( { phase: 'launching' } );
					return failed ? { launchError: 'Changes pushed, but launch failed' } : undefined;
				}
			);
			await expect(
				runCommand( site.path, [ 'all' ], String( remoteSite.id ) )
			).resolves.toBeDefined();
			expect( rememberRemoteSite ).toHaveBeenCalledWith(
				'wpcom',
				site.id,
				expect.objectContaining( { launchAfterPush: failed } ),
				'push',
				expect.anything()
			);
			expect( reported().at( -1 ) ).toMatchObject( { kind: failed ? 'error' : 'success' } );
			expect( recordTracksEvent ).toHaveBeenCalledWith(
				TRACKS_EVENTS.SYNC_PUSH,
				expect.objectContaining( { success: true } )
			);
		}
	);

	// The phase gates cancelling a push, so every UI must see it move on.
	it( 'reports each phase, then the result', async () => {
		pushes( [
			{ phase: 'uploading', progress: 100 },
			{ phase: 'creatingRemoteBackup' },
			{ phase: 'applyingChanges', progress: 10 },
		] );

		await runCommand( site.path, [ 'all' ], String( remoteSite.id ) );

		expect(
			reported().map( ( activity ) => ( 'phase' in activity ? activity.phase : activity.kind ) )
		).toEqual( [
			'pending',
			'pending',
			'creatingBackup',
			'uploading',
			'creatingRemoteBackup',
			'applyingChanges',
			'success',
		] );
		expect( reported()[ 1 ] ).toMatchObject( { remoteSiteId: remoteSite.id } );
		expect( recordTracksEvent ).toHaveBeenCalledExactlyOnceWith(
			TRACKS_EVENTS.SYNC_PUSH,
			expect.objectContaining( { success: true, site_id: siteTracksId } )
		);
		expect( vi.mocked( recordTracksEvent ).mock.calls[ 0 ][ 1 ] ).not.toHaveProperty(
			'preview_id'
		);
	} );

	it( 'keeps a successful push and its event when the site ID cannot be read', async () => {
		vi.spyOn( configFile, 'readCliConfigFileRaw' ).mockRejectedValueOnce(
			new Error( 'Storage unavailable' )
		);
		await expect( runCommand( site.path, [ 'all' ], String( remoteSite.id ) ) ).resolves.toBe(
			remoteSite
		);
		expect( recordTracksEvent ).toHaveBeenCalledExactlyOnceWith(
			TRACKS_EVENTS.SYNC_PUSH,
			expect.objectContaining( { success: true } )
		);
		expect( vi.mocked( recordTracksEvent ).mock.calls[ 0 ][ 1 ] ).not.toHaveProperty( 'site_id' );
	} );
	it( "keeps Studio's local wp-config.php constants out of the pushed archive", async () => {
		await runCommand( site.path, [ 'sqls' ], String( remoteSite.id ) );

		expect( getExporter ).toHaveBeenCalledWith(
			expect.objectContaining( { stripStudioWpConfigConstants: true } )
		);
	} );

	it( 'explains a database the live site failed to import', async () => {
		pushes(
			[ { phase: 'applyingChanges' } ],
			new RemoteSiteError(
				'The database failed to import on the live site. Review your database and try again.',
				'remote_import'
			)
		);

		await expect( runCommand( site.path, [ 'all' ], String( remoteSite.id ) ) ).rejects.toThrow(
			'The database failed to import on the live site.'
		);
		expect( reported().at( -1 ) ).toMatchObject( {
			kind: 'error',
			message: expect.stringContaining( 'The database failed to import on the live site.' ),
		} );
	} );

	it.each( [
		[
			'export',
			'local_export',
			() =>
				vi.mocked( getExporter ).mockResolvedValue( {
					on: vi.fn(),
					export: () => Promise.reject( new Error( 'Export crashed' ) ),
				} as never ),
		],
		[
			'upload',
			'upload',
			() => pushes( [ { phase: 'uploading' } ], new Error( 'Upload crashed' ) ),
		],
		[
			'remote backup',
			'remote_backup',
			() => pushes( [ { phase: 'creatingRemoteBackup' } ], new Error( 'Poll crashed' ) ),
		],
		[
			'remote import',
			'remote_import',
			() => pushes( [ { phase: 'applyingChanges' } ], new Error( 'Poll crashed' ) ),
		],
	] )(
		'attributes an uncoded failure during the %s to that step',
		async ( _, failureReason, fail ) => {
			fail();

			await expect( runCommand( site.path, [ 'all' ], String( remoteSite.id ) ) ).rejects.toThrow();

			expect( recordTracksEvent ).toHaveBeenCalledExactlyOnceWith(
				TRACKS_EVENTS.SYNC_PUSH,
				expect.objectContaining( {
					success: false,
					failure_reason: failureReason,
					selection: 'full',
					includes_database: true,
				} )
			);
		}
	);
} );

describe( 'CLI: studio push to a provider that publishes a static copy', () => {
	const space = {
		id: 'spc_1',
		name: 'My Site',
		url: 'https://my-site.space.fast',
		slug: 'my-site',
		teamId: 'team_1',
	};
	const spacefastSites = getProvider( 'spacefast' ).sites!;
	const files: PushContent = {
		kind: 'files',
		files: [ { path: 'index.html', size: 4, read: async () => new Uint8Array() } ],
	};

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( onCancel ).mockReturnValue( () => true );
		vi.mocked( getSiteByFolder ).mockResolvedValue( { ...site, name: 'My Site' } );
		vi.mocked( readProviderConfig ).mockResolvedValue( { apiKey: 'sfa_key' } as never );
		vi.mocked( exportStaticContent ).mockImplementation(
			async ( _path, _url, _output, beforeExport ) => {
				expect( getSiteVersion ).not.toHaveBeenCalled();
				await beforeExport?.();
				expect( getSiteVersion ).toHaveBeenCalledExactlyOnceWith( site.id, site.path );
				return files;
			}
		);
	} );

	it( 'publishes the export to the site last published to, and reports and records it as that provider’s', async () => {
		vi.mocked( getRemoteSites ).mockResolvedValue( [
			{ ...space, localSiteId: site.id, lastPushTimestamp: null, lastPullTimestamp: null },
			{
				...space,
				id: 'spc_2',
				localSiteId: site.id,
				lastPushTimestamp: '2026-11-01T00:00:00Z',
				lastPullTimestamp: null,
			},
		] );

		await expect( runCommand( site.path, undefined, 'spacefast' ) ).resolves.toMatchObject( {
			id: 'spc_2',
		} );

		expect( exportStaticContent ).toHaveBeenCalledWith(
			site.path,
			space.url,
			expect.any( String ),
			expect.any( Function )
		);
		expect( spacefastSites.push ).toHaveBeenCalledWith(
			{ apiKey: 'sfa_key' },
			expect.objectContaining( { id: 'spc_2' } ),
			files,
			expect.objectContaining( { optionsToSync: [ 'all' ] } ),
			expect.any( Function ),
			expect.any( AbortSignal )
		);
		expect( rememberRemoteSite ).toHaveBeenCalledWith(
			'spacefast',
			site.id,
			expect.objectContaining( { id: 'spc_2' } ),
			'push',
			'before-upload'
		);
		expect( reported().at( -1 ) ).toEqual( {
			kind: 'success',
			direction: 'push',
			provider: 'spacefast',
			remoteSiteId: 'spc_2',
		} );
		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SYNC_PUSH,
			expect.objectContaining( { success: true, sync_type: 'spacefast' } )
		);
	} );

	it( 'asks for a site when there is no terminal to pick one in', async () => {
		vi.mocked( getRemoteSites ).mockResolvedValue( [] );
		vi.mocked( spacefastSites.list ).mockResolvedValue( [ space ] );

		await expect( runCommand( site.path, undefined, 'spacefast' ) ).rejects.toThrow(
			'Choose a site with `--remote-site spacefast:<site>`'
		);
		expect( spacefastSites.push ).not.toHaveBeenCalled();
	} );

	it( 'publishes to the site an ID or URL names', async () => {
		vi.mocked( spacefastSites.list ).mockResolvedValue( [ space ] );

		await runCommand( site.path, undefined, 'spacefast:my-site.space.fast' );

		expect( spacefastSites.push ).toHaveBeenCalledWith(
			expect.anything(),
			space,
			files,
			expect.anything(),
			expect.anything(),
			expect.anything()
		);
	} );
} );
