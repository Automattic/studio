import { app, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as configFile from '@studio/common/lib/cli-config-file';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { getCliConfigPath, getSharedConfigPath } from '@studio/common/lib/well-known-paths';
import { recordAnalyticsEvent } from 'src/ipc-handlers';

vi.unmock( 'atomically' );
vi.unmock( 'lockfile' );

const events = [ TRACKS_EVENTS.SITE_EXPORT, TRACKS_EVENTS.SYNC_CONNECT, TRACKS_EVENTS.SYNC_PUSH ];
const operationalId = 'caller@example.test';
const ipcEvent = {} as IpcMainInvokeEvent;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const send = vi.fn().mockResolvedValue( {} );
let directory: string;

beforeEach( async () => {
	directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-desktop-site-tracks-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', directory );
	vi.stubEnv( 'NODE_ENV', 'production' );
	for ( const key of [ 'CI', 'IS_DEV_BUILD', 'E2E' ] ) vi.stubEnv( key, '' );
	vi.stubGlobal( 'fetch', send );
	vi.mocked( app.getVersion ).mockReturnValue( 'test' );
	await fs.writeFile(
		getCliConfigPath(),
		JSON.stringify( {
			version: 1,
			sites: [ { id: operationalId, path: '/private/path', name: 'Private title' } ],
			snapshots: [],
			otherField: { preserved: true },
		} )
	);
} );
afterEach( async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	await fs.rm( directory, { recursive: true, force: true } );
} );

it.each(
	events.flatMap( ( event ) => [ true, false ].map( ( success ) => ( { event, success } ) ) )
)(
	'sends the stored opaque UUID through desktop IPC and Tracks for $event (success $success)',
	async ( { event, success } ) => {
		await recordAnalyticsEvent(
			ipcEvent,
			event,
			{ success, site_id: operationalId, preview_id: '/private/path' },
			operationalId
		);
		expect( send ).toHaveBeenCalledTimes( 1 );
		const payload = new URL( send.mock.calls[ 0 ][ 0 ] ).searchParams;
		const config = JSON.parse( await fs.readFile( getCliConfigPath(), 'utf8' ) );
		expect( payload.get( 'site_id' ) ).toMatch( uuid );
		expect( payload.get( 'site_id' ) ).toBe( config.sites[ 0 ].tracksId );
		expect( config.otherField ).toEqual( { preserved: true } );
		expect( payload.has( 'preview_id' ) ).toBe( false );
		const shared = JSON.parse( await fs.readFile( getSharedConfigPath(), 'utf8' ) );
		expect( Object.fromEntries( payload ) ).toEqual( {
			_en: event,
			_ut: 'anon',
			_ui: shared.analyticsInstallId,
			_ts: expect.any( String ),
			platform: process.platform,
			arch: process.arch,
			app_version: 'test',
			is_a11n: 'false',
			channel: 'studio-ui',
			ui_version: 'v2',
			success: String( success ),
			site_id: config.sites[ 0 ].tracksId,
		} );
		await recordAnalyticsEvent( ipcEvent, event, { success }, operationalId );
		expect( new URL( send.mock.calls[ 1 ][ 0 ] ).searchParams.get( 'site_id' ) ).toBe(
			payload.get( 'site_id' )
		);
	}
);

it( 'omits unresolved IDs and still sends the event', async () => {
	const event = TRACKS_EVENTS.SYNC_CONNECT;
	await recordAnalyticsEvent(
		ipcEvent,
		event,
		{ success: false, site_id: 'Private title' },
		'missing'
	);
	expect( send ).toHaveBeenCalledTimes( 1 );
	const payload = new URL( send.mock.calls[ 0 ][ 0 ] ).searchParams;
	expect( payload.has( 'site_id' ) ).toBe( false );
	expect( payload.get( 'success' ) ).toBe( 'false' );
} );

it( 'preserves the event when site ID persistence fails', async () => {
	vi.spyOn( configFile, 'writeCliConfigFileRaw' ).mockRejectedValueOnce(
		new Error( 'Storage unavailable' )
	);
	await expect(
		recordAnalyticsEvent( ipcEvent, TRACKS_EVENTS.SYNC_CONNECT, { success: false }, operationalId )
	).resolves.toBeUndefined();
	expect( send ).toHaveBeenCalledTimes( 1 );
	const payload = new URL( send.mock.calls[ 0 ][ 0 ] ).searchParams;
	expect( payload.has( 'site_id' ) ).toBe( false );
	expect( payload.get( 'success' ) ).toBe( 'false' );
} );

it( 'honors desktop opt-out and disable paths with site props', async () => {
	const event = TRACKS_EVENTS.SYNC_CONNECT;
	await fs.writeFile(
		getSharedConfigPath(),
		JSON.stringify( { version: 1, analyticsOptOut: true } )
	);
	await recordAnalyticsEvent( ipcEvent, event, { success: true }, operationalId );
	expect( send ).not.toHaveBeenCalled();
	await fs.writeFile( getSharedConfigPath(), '{"version":1}' );
	for ( const [ key, value ] of [
		[ 'CI', 'true' ],
		[ 'IS_DEV_BUILD', 'true' ],
		[ 'E2E', 'true' ],
		[ 'NODE_ENV', 'development' ],
		[ 'NODE_ENV', 'test' ],
	] ) {
		vi.stubEnv( key, value );
		await recordAnalyticsEvent( ipcEvent, event, { success: false }, operationalId );
		expect( send ).not.toHaveBeenCalled();
		vi.stubEnv( key, key === 'NODE_ENV' ? 'production' : '' );
	}
} );

it.each( [ 'chat', 'split', 'panel' ] )(
	'sends workspace layout %s with only opaque site attribution',
	async ( layout ) => {
		await recordAnalyticsEvent(
			ipcEvent,
			TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED,
			{ layout, site_id: operationalId, preview_id: '/private/path' },
			operationalId
		);
		const payload = new URL( send.mock.calls[ 0 ][ 0 ] ).searchParams;
		expect( payload.get( '_en' ) ).toBe( TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED );
		expect( payload.get( 'layout' ) ).toBe( layout );
		expect( payload.get( 'site_id' ) ).toMatch( uuid );
		expect( payload.get( 'channel' ) ).toBe( 'studio-ui' );
		expect( payload.has( 'preview_id' ) ).toBe( false );
		expect( payload.has( 'trigger' ) ).toBe( false );
		expect( JSON.stringify( Object.fromEntries( payload ) ) ).not.toMatch(
			/caller@example|private|Private title/
		);
	}
);

it.each( [ 'missing', 'storage' ] )(
	'preserves layout telemetry when attribution is %s',
	async ( failure ) => {
		if ( failure === 'storage' )
			vi.spyOn( configFile, 'writeCliConfigFileRaw' ).mockRejectedValueOnce(
				new Error( 'Unavailable' )
			);
		await recordAnalyticsEvent(
			ipcEvent,
			TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED,
			{ layout: 'split', site_id: operationalId },
			failure === 'missing' ? 'missing' : operationalId
		);
		const payload = new URL( send.mock.calls[ 0 ][ 0 ] ).searchParams;
		expect( payload.get( 'layout' ) ).toBe( 'split' );
		expect( payload.has( 'site_id' ) ).toBe( false );
	}
);

it.each( [ 'IS_DEV_BUILD', 'CI' ] )(
	'disables workspace layout telemetry with %s',
	async ( key ) => {
		vi.stubEnv( key, 'true' );
		await recordAnalyticsEvent(
			ipcEvent,
			TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED,
			{ layout: 'split' },
			operationalId
		);
		expect( send ).not.toHaveBeenCalled();
	}
);
