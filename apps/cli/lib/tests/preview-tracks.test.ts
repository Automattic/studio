// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';

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

it( 'serializes concurrent initialization without changing either ID', async () => {
	const props = await Promise.all( [
		getPreviewTracksProps( site.path, preview ),
		getPreviewTracksProps( site.path, preview ),
		getPreviewTracksProps( site.path, preview ),
	] );
	expect( props[ 0 ].preview_id ).toMatch( uuid );
	expect( props[ 1 ] ).toEqual( props[ 0 ] );
	expect( props[ 2 ] ).toEqual( props[ 0 ] );
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

it.each(
	[ '', 'studio-ui:v2' ].flatMap( ( origin ) =>
		[
			TRACKS_EVENTS.PREVIEW_SITE_CREATE,
			TRACKS_EVENTS.PREVIEW_SITE_UPDATE,
			TRACKS_EVENTS.SITE_EXPORT,
			TRACKS_EVENTS.SYNC_CONNECT,
			TRACKS_EVENTS.SYNC_PUSH,
		].map( ( event ) => ( { origin, event } ) )
	)
)(
	'sends opaque props through the existing anonymous wrapper for $event ($origin) and honors every gate',
	async ( { origin, event } ) => {
		vi.stubEnv( 'STUDIO_TRACKS_ORIGIN', origin );
		vi.stubEnv( 'NODE_ENV', 'production' );
		const send = vi.fn().mockResolvedValue( {} );
		vi.stubGlobal( 'fetch', send );
		const props = {
			...( await getPreviewTracksProps(
				site.path,
				event === TRACKS_EVENTS.PREVIEW_SITE_CREATE || event === TRACKS_EVENTS.PREVIEW_SITE_UPDATE
					? preview
					: undefined
			) ),
			...getTracksOrigin(),
		};
		await recordTracksEvent( event, props );
		expect( send ).toHaveBeenCalledTimes( 1 );
		const url = new URL( send.mock.calls[ 0 ][ 0 ] );
		expect( url.searchParams.get( 'site_id' ) ).toBe( props.site_id );
		expect( url.searchParams.get( 'preview_id' ) ).toBe( props.preview_id ?? null );
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

const siteEvents = [
	TRACKS_EVENTS.SITE_EXPORT,
	TRACKS_EVENTS.SYNC_CONNECT,
	TRACKS_EVENTS.SYNC_PUSH,
];

it( 'uses the preview UUID across CLI and host lookups, including concurrent legacy initialization', async () => {
	const results = await Promise.all( [
		getPreviewTracksProps( site.path, preview ),
		getSiteTracksProps( { siteId: site.id } ),
		getPreviewTracksProps( site.path ),
		...siteEvents.map( ( event ) =>
			resolveSiteTracksEventProps( event, { success: true }, site.id )
		),
	] );
	const id = results[ 0 ].site_id;
	expect( id ).toMatch( uuid );
	for ( const result of results ) expect( result.site_id ).toBe( id );
	for ( const result of results.slice( 1 ) ) expect( result ).not.toHaveProperty( 'preview_id' );
	const config = await configStore.readCliConfig();
	expect( config.version ).toBe( 1 );
	expect( config.sites ).toHaveLength( 1 );
	expect( config.sites[ 0 ].tracksId ).toBe( id );
} );

it.each( siteEvents )( 'ignores caller props and omits unresolved IDs for %s', async ( event ) => {
	const props = { success: false, site_id: crypto.randomUUID(), preview_id: preview.url };
	expect( await resolveSiteTracksEventProps( event, props, '/missing' ) ).toEqual( {
		success: false,
	} );
	expect( await resolveSiteTracksEventProps( event, props ) ).toEqual( { success: false } );
	const resolved = await resolveSiteTracksEventProps( event, props, site.id );
	expect( resolved ).toEqual( { success: false, site_id: expect.stringMatching( uuid ) } );
	expect( resolved.site_id ).not.toBe( props.site_id );
	expect( resolved.site_id ).not.toBe( site.id );
	expect( resolved.site_id ).not.toBe( site.path );
	expect( resolved.site_id ).not.toBe( site.name );
} );

it.each( [ '', 'studio-ui:v2' ] )(
	'sends the same site UUID for create, preview, export, connect and push (origin %s)',
	async ( origin ) => {
		vi.stubEnv( 'STUDIO_TRACKS_ORIGIN', origin );
		vi.stubEnv( 'NODE_ENV', 'production' );
		const send = vi.fn().mockResolvedValue( {} );
		vi.stubGlobal( 'fetch', send );
		const created = await getPreviewTracksProps( site.path );
		await recordTracksEvent( TRACKS_EVENTS.SITE_CREATE, { ...created, ...getTracksOrigin() } );
		await recordTracksEvent(
			TRACKS_EVENTS.PREVIEW_SITE_CREATE,
			await getPreviewTracksProps( site.path, preview )
		);
		await recordTracksEvent(
			TRACKS_EVENTS.PREVIEW_SITE_UPDATE,
			await getPreviewTracksProps( site.path, preview )
		);
		for ( const event of siteEvents ) {
			const props = await resolveSiteTracksEventProps( event, { success: true }, site.id );
			await recordTracksEvent( event, { ...props, ...getTracksOrigin() } );
		}
		const payloads = send.mock.calls.map( ( [ url ] ) => new URL( url ).searchParams );
		expect( payloads ).toHaveLength( 6 );
		for ( const payload of payloads ) expect( payload.get( 'site_id' ) ).toBe( created.site_id );
		for ( const payload of payloads.slice( 3 ) )
			expect( payload.has( 'preview_id' ) ).toBe( false );
		const config = await configStore.readCliConfig();
		config.sites.push( { ...site, id: 'another-id', path: '/another/path' } );
		await configStore.lockCliConfig();
		try {
			await configStore.saveCliConfig( config );
		} finally {
			await configStore.unlockCliConfig();
		}
		const other = await getSiteTracksProps( { siteId: 'another-id' } );
		expect( other.site_id ).toMatch( uuid );
		expect( other.site_id ).not.toBe( created.site_id );
	}
);
