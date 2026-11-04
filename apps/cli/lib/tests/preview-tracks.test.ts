// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as configFile from '@studio/common/lib/cli-config-file';
import { getSiteTracksProps, resolveSiteTracksEventProps } from '@studio/common/lib/site-tracks';
import { getCliConfigPath, getSharedConfigPath } from '@studio/common/lib/well-known-paths';
import { vi } from 'vitest';
import * as configStore from 'cli/lib/cli-config/core';
import {
	deleteSnapshotFromConfig,
	reconcilePreviews,
	saveSnapshotToConfig,
	setSnapshotInConfig,
	updateSnapshotInConfig,
} from 'cli/lib/cli-config/snapshots';
import { getPreviewTracksProps } from 'cli/lib/preview-tracks';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';

vi.unmock( 'lockfile' );

const site = {
	id: 'caller-supplied-user@example.com',
	name: 'Private site title',
	path: '/private/site/path',
	adminUsername: 'private-user',
	port: 8881,
	phpVersion: '8.3',
};
const preview = {
	atomicSiteId: 12345,
	userId: 42,
	localSiteId: site.id,
	url: 'private-preview.wpcomstaging.com',
	shareUrl: 'https://private-preview.wpcomstaging.com/?share=private-token',
	date: Date.now(),
};
const siteEvents = [
	TRACKS_EVENTS.SITE_EXPORT,
	TRACKS_EVENTS.SYNC_CONNECT,
	TRACKS_EVENTS.SYNC_PUSH,
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let directory: string;

beforeEach( async () => {
	directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-preview-tracks-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', directory );
	vi.stubEnv( 'E2E', '' );
	vi.stubEnv( 'STUDIO_FORCE_CLI_TELEMETRY', '' );
	vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', true );
	vi.stubGlobal( '__STUDIO_CLI_VERSION__', 'test' );
	await fs.writeFile(
		getCliConfigPath(),
		JSON.stringify( {
			version: 1,
			sites: [ site ],
			snapshots: [ preview ],
			otherSettings: { preserved: true },
		} )
	);
} );

afterEach( async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await fs.rm( directory, { recursive: true, force: true } );
} );

it( 'backfills legacy records with distinct UUIDs and persists them across reads', async () => {
	const props = await getPreviewTracksProps( site.path, preview );
	expect( props ).toEqual( {
		site_id: expect.stringMatching( uuid ),
		preview_id: expect.stringMatching( uuid ),
	} );
	expect( props.site_id ).not.toBe( props.preview_id );
	expect( await getPreviewTracksProps( site.path, preview ) ).toEqual( props );
	const config = await configStore.readCliConfig();
	expect( config.version ).toBe( 1 );
	expect( config.sites[ 0 ].tracksId ).toBe( props.site_id );
	expect( config.snapshots[ 0 ].tracksId ).toBe( props.preview_id );
	for ( const value of [
		site.id,
		site.name,
		site.path,
		site.adminUsername,
		preview.url,
		preview.shareUrl,
		String( preview.atomicSiteId ),
		String( preview.userId ),
	] ) {
		expect( Object.values( props ) ).not.toContain( value );
	}
} );

it( 'initializes one UUID across concurrent CLI and host lookups', async () => {
	const results = await Promise.all( [
		getPreviewTracksProps( site.path, preview ),
		getPreviewTracksProps( site.path, preview ),
		getSiteTracksProps( { siteId: site.id } ),
		...siteEvents.map( ( event ) =>
			resolveSiteTracksEventProps( event, { success: true }, site.id )
		),
	] );
	expect( results[ 0 ].site_id ).toMatch( uuid );
	expect( results[ 0 ].preview_id ).toMatch( uuid );
	expect( results[ 1 ] ).toEqual( results[ 0 ] );
	for ( const result of results.slice( 2 ) ) {
		expect( result.site_id ).toBe( results[ 0 ].site_id );
		expect( result ).not.toHaveProperty( 'preview_id' );
	}
	const config = await configFile.readCliConfigFileRaw();
	expect( config.version ).toBe( 1 );
	expect( config.otherSettings ).toEqual( { preserved: true } );
} );

it( 'preserves IDs across renames, updates, reconciliation and saving a discovered preview', async () => {
	const props = await getPreviewTracksProps( site.path, preview );
	const config = await configStore.readCliConfig();
	config.sites[ 0 ].name = 'Renamed';
	await configStore.lockCliConfig();
	try {
		await configStore.saveCliConfig( config );
	} finally {
		await configStore.unlockCliConfig();
	}
	await setSnapshotInConfig( preview.url, { name: 'Renamed preview' } );
	await updateSnapshotInConfig( preview.atomicSiteId, site.path );
	await reconcilePreviews(
		preview.userId,
		new Map( [
			[
				preview.atomicSiteId,
				{
					hostname: preview.url,
					expiresAt: Date.now() + 10000,
					shareUrl: preview.shareUrl,
				},
			],
		] ),
		Date.now() + 1
	);
	await saveSnapshotToConfig(
		site.path,
		preview.atomicSiteId,
		preview.url,
		preview.userId,
		'Saved'
	);
	expect( await getPreviewTracksProps( site.path, preview ) ).toEqual( props );
} );

it( 'gives separate previews and a recreated preview distinct IDs for the same site', async () => {
	const first = await getPreviewTracksProps( site.path, preview );
	const next = await saveSnapshotToConfig(
		site.path,
		67890,
		'another.wp.build',
		preview.userId,
		'Another'
	);
	const second = await getPreviewTracksProps( site.path, next );
	expect( second.site_id ).toBe( first.site_id );
	expect( second.preview_id ).toMatch( uuid );
	expect( second.preview_id ).not.toBe( first.preview_id );
	await deleteSnapshotFromConfig( preview.url );
	const recreated = await saveSnapshotToConfig(
		site.path,
		preview.atomicSiteId,
		preview.url,
		preview.userId,
		'Recreated'
	);
	const third = await getPreviewTracksProps( site.path, recreated );
	expect( third.site_id ).toBe( first.site_id );
	expect( third.preview_id ).not.toBe( first.preview_id );
} );

it( 'uses the source site UUID on overwrite and keeps the preview UUID', async () => {
	const first = await getPreviewTracksProps( site.path, preview );
	const config = await configStore.readCliConfig();
	const other = { ...site, id: 'duplicate-site', path: '/other/site' };
	config.sites.push( other );
	await configStore.lockCliConfig();
	try {
		await configStore.saveCliConfig( config );
	} finally {
		await configStore.unlockCliConfig();
	}
	await updateSnapshotInConfig( preview.atomicSiteId, other.path );
	const props = await getPreviewTracksProps( other.path, preview );
	expect( props.site_id ).toMatch( uuid );
	expect( props.site_id ).not.toBe( first.site_id );
	expect( props.preview_id ).toBe( first.preview_id );
} );

it( 'omits unresolved IDs and never creates a preview record for an attempt', async () => {
	expect( await getPreviewTracksProps( '/missing', { ...preview, atomicSiteId: 0 } ) ).toEqual(
		{}
	);
	expect( await getPreviewTracksProps( site.path ) ).toEqual( {
		site_id: expect.stringMatching( uuid ),
	} );
	expect(
		await getPreviewTracksProps( site.path, { ...preview, userId: 999 } )
	).not.toHaveProperty( 'preview_id' );
	const config = await configStore.readCliConfig();
	expect( config.snapshots ).toEqual( [ preview ] );
} );

it( 'replaces malformed stored identifiers without sending their contents', async () => {
	const config = await configStore.readCliConfig();
	config.sites[ 0 ].tracksId = site.id;
	config.snapshots[ 0 ].tracksId = preview.url;
	await configStore.lockCliConfig();
	try {
		await configStore.saveCliConfig( config );
	} finally {
		await configStore.unlockCliConfig();
	}
	expect( await getPreviewTracksProps( site.path, preview ) ).toEqual( {
		site_id: expect.stringMatching( uuid ),
		preview_id: expect.stringMatching( uuid ),
	} );
} );

it( 'omits IDs on a storage failure and releases the lock for the next operation', async () => {
	vi.spyOn( configStore, 'saveCliConfig' ).mockRejectedValueOnce( new Error( 'Cannot write' ) );
	expect( await getPreviewTracksProps( site.path, preview ) ).toEqual( {} );
	expect( await getPreviewTracksProps( site.path, preview ) ).toEqual( {
		site_id: expect.stringMatching( uuid ),
		preview_id: expect.stringMatching( uuid ),
	} );
} );

it( 'does not unlock another writer when acquiring the lock fails', async () => {
	vi.spyOn( configStore, 'lockCliConfig' ).mockRejectedValueOnce( new Error( 'Locked' ) );
	const unlock = vi.spyOn( configStore, 'unlockCliConfig' );
	expect( await getPreviewTracksProps( site.path, preview ) ).toEqual( {} );
	expect( unlock ).not.toHaveBeenCalled();
} );

it.each( [ TRACKS_EVENTS.PREVIEW_SITE_CREATE, TRACKS_EVENTS.PREVIEW_SITE_UPDATE ] )(
	'sends opaque props through the existing anonymous wrapper for %s and honors every gate',
	async ( event ) => {
		vi.stubEnv( 'NODE_ENV', 'production' );
		const send = vi.fn().mockResolvedValue( {} );
		vi.stubGlobal( 'fetch', send );
		const props = await getPreviewTracksProps( site.path, preview );
		await recordTracksEvent( event, props );
		expect( send ).toHaveBeenCalledTimes( 1 );
		const url = new URL( send.mock.calls[ 0 ][ 0 ] );
		expect( url.searchParams.get( 'site_id' ) ).toBe( props.site_id );
		expect( url.searchParams.get( 'preview_id' ) ).toBe( props.preview_id );
		expect( url.searchParams.get( '_ut' ) ).toBe( 'anon' );
		const shared = JSON.parse( await fs.readFile( getSharedConfigPath(), 'utf8' ) );
		expect( url.searchParams.get( '_ui' ) ).toBe( shared.analyticsInstallId );
		expect( Object.fromEntries( url.searchParams ) ).toEqual( {
			_en: event,
			_ut: 'anon',
			_ui: shared.analyticsInstallId,
			_ts: expect.any( String ),
			platform: process.platform,
			arch: process.arch,
			app_version: 'test',
			is_a11n: 'false',
			...props,
		} );
		send.mockClear();
		await fs.writeFile(
			getSharedConfigPath(),
			JSON.stringify( { ...shared, analyticsOptOut: true } )
		);
		await recordTracksEvent( event, props );
		expect( send ).not.toHaveBeenCalled();
		await fs.writeFile( getSharedConfigPath(), JSON.stringify( shared ) );
		vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', false );
		await recordTracksEvent( event, props );
		expect( send ).not.toHaveBeenCalled();
		vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', true );
		for ( const mode of [ 'development', 'test' ] ) {
			vi.stubEnv( 'NODE_ENV', mode );
			await recordTracksEvent( event, props );
			expect( send ).not.toHaveBeenCalled();
		}
		vi.stubEnv( 'NODE_ENV', 'production' );
		vi.stubEnv( 'E2E', 'true' );
		await recordTracksEvent( event, props );
		expect( send ).not.toHaveBeenCalled();
	}
);

it.each( siteEvents )(
	'rejects caller IDs and omits unresolved records for %s',
	async ( event ) => {
		const props = { success: false, site_id: crypto.randomUUID(), preview_id: preview.url };
		expect( await resolveSiteTracksEventProps( event, props, 'missing' ) ).toEqual( {
			success: false,
		} );
		expect( await resolveSiteTracksEventProps( event, props ) ).toEqual( { success: false } );
		const resolved = await resolveSiteTracksEventProps( event, props, site.id );
		expect( resolved ).toEqual( { success: false, site_id: expect.stringMatching( uuid ) } );
		expect( resolved.site_id ).not.toBe( props.site_id );
	}
);

it.each( [
	'lockCliConfigFile',
	'readCliConfigFileRaw',
	'writeCliConfigFileRaw',
	'unlockCliConfigFile',
] as const )( 'preserves event props when shared ID %s fails', async ( operation ) => {
	vi.spyOn( configFile, operation ).mockRejectedValueOnce( new Error( 'Storage unavailable' ) );
	expect(
		await resolveSiteTracksEventProps( TRACKS_EVENTS.SYNC_CONNECT, { success: false }, site.id )
	).toEqual( { success: false } );
} );

it( 'sends preview and site events with the same stored UUID', async () => {
	vi.stubEnv( 'NODE_ENV', 'production' );
	const send = vi.fn().mockResolvedValue( {} );
	vi.stubGlobal( 'fetch', send );
	for ( const event of [ TRACKS_EVENTS.PREVIEW_SITE_CREATE, TRACKS_EVENTS.PREVIEW_SITE_UPDATE ] ) {
		await recordTracksEvent( event, await getPreviewTracksProps( site.path, preview ) );
	}
	for ( const event of siteEvents ) {
		await recordTracksEvent(
			event,
			await resolveSiteTracksEventProps( event, { success: true }, site.id )
		);
	}
	const payloads = send.mock.calls.map( ( [ url ] ) => new URL( url ).searchParams );
	const config = await configStore.readCliConfig();
	expect( payloads.map( ( payload ) => payload.get( '_en' ) ) ).toEqual( [
		TRACKS_EVENTS.PREVIEW_SITE_CREATE,
		TRACKS_EVENTS.PREVIEW_SITE_UPDATE,
		...siteEvents,
	] );
	for ( const payload of payloads )
		expect( payload.get( 'site_id' ) ).toBe( config.sites[ 0 ].tracksId );
	for ( const payload of payloads.slice( 2 ) ) expect( payload.has( 'preview_id' ) ).toBe( false );
} );
