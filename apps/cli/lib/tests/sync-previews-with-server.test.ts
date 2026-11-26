import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfigPath, readConfig, updateConfig } from '@studio/common/lib/config/store';
import { getRemoteSites, rememberRemoteSite } from '@studio/common/lib/remote-sites';
import { getDestinationStatus } from 'cli/commands/publish-status';
import { wpcomPreviews } from 'cli/lib/preview-sites';
import { getSiteVersion } from 'cli/lib/site-versions';
import { syncPreviewsWithServer } from 'cli/lib/snapshots';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import type { SyncSite } from '@studio/common/types/sync';

vi.mock( 'cli/lib/preview-sites', () => ( { wpcomPreviews: { list: vi.fn() } } ) );
vi.mock( 'cli/lib/sync-api', () => ( { fetchSyncableSites: vi.fn() } ) );

const remote = {
	id: 42,
	name: 'Hosted',
	url: 'https://example.blog',
	localSiteId: '',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPushTimestamp: null,
	lastPullTimestamp: null,
} as SyncSite;

let root: string;
let sitePath: string;

beforeEach( async () => {
	root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-preview-promotion-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', path.join( root, 'config' ) );
	fs.mkdirSync( path.join( root, 'config' ) );
	sitePath = path.join( root, 'site' );
	fs.mkdirSync( path.join( sitePath, 'wp-content' ), { recursive: true } );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'style.css' ), 'initial' );
	const versionId = await getSiteVersion( 'local', sitePath );
	fs.writeFileSync(
		getConfigPath(),
		JSON.stringify( {
			version: 1,
			providers: {
				configs: {
					wpcom: {
						token: 'token',
						expiresAt: Date.now() + 60_000,
						user: { id: 7, email: 'user@example.com', displayName: 'User' },
					},
				},
			},
			sites: [ { id: 'local', name: 'Site', path: sitePath, port: 8881, phpVersion: '8.3' } ],
			snapshots: [
				{
					atomicSiteId: 42,
					localSiteId: 'local',
					userId: 7,
					url: 'preview.wpcomstaging.com',
					date: Date.now() - 10_000,
					syncedAt: Date.now() - 10_000,
					versionId,
				},
			],
		} )
	);
	vi.mocked( wpcomPreviews.list ).mockResolvedValue( [] );
	vi.mocked( fetchSyncableSites ).mockResolvedValue( [ remote ] );
} );

afterEach( () => {
	vi.unstubAllEnvs();
	fs.rmSync( root, { recursive: true, force: true } );
} );

it( 'retains the comparison baseline when a purchased preview becomes a connected site', async () => {
	await syncPreviewsWithServer( 7, 'token' );
	expect( ( await readConfig() ).snapshots ).toEqual( [] );
	expect(
		await getDestinationStatus( { siteFolder: sitePath, remoteSiteId: 42, provider: 'wpcom' } )
	).toMatchObject( { localChanged: false } );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'style.css' ), 'edited' );
	expect(
		await getDestinationStatus( { siteFolder: sitePath, remoteSiteId: 42, provider: 'wpcom' } )
	).toMatchObject( { localChanged: true } );
} );

it( 'does not restore a preview baseline invalidated by a later partial transfer', async () => {
	await rememberRemoteSite( 'wpcom', 'local', remote, { synced: 'pull', localVersionId: null } );
	await syncPreviewsWithServer( 7, 'token' );
	expect( ( await getRemoteSites( 'wpcom', 'local' ) )[ 0 ].localVersionId ).toBeNull();
	expect(
		await getDestinationStatus( { siteFolder: sitePath, remoteSiteId: 42, provider: 'wpcom' } )
	).toMatchObject( { localChanged: null } );
} );

it( 'promotes the preview for the account that fetched it even if the user switches accounts', async () => {
	vi.mocked( fetchSyncableSites ).mockImplementationOnce( async () => {
		await updateConfig( ( config ) => {
			delete config.providers.configs.wpcom;
		} );
		return [ remote ];
	} );
	await syncPreviewsWithServer( 7, 'token' );
	const config = await readConfig();
	expect( config.snapshots ).toEqual( [] );
	expect( config.sites[ 0 ].connections ).toHaveLength( 1 );
	expect( config.sites[ 0 ].connections![ 0 ] ).toMatchObject( {
		account: '7',
		site: { id: 42, name: 'Hosted' },
		localVersionId: expect.any( String ),
	} );
	expect( config.sites[ 0 ].connections![ 0 ] ).not.toHaveProperty( 'preview' );
} );
