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

it.each( events )( 'omits unresolved IDs and still sends %s', async ( event ) => {
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

it.each(
	events.flatMap( ( event ) =>
		(
			[
				'lockCliConfigFile',
				'readCliConfigFileRaw',
				'writeCliConfigFileRaw',
				'unlockCliConfigFile',
			] as const
		 ).map( ( operation ) => ( { event, operation } ) )
	)
)( 'preserves $event when ID $operation fails', async ( { event, operation } ) => {
	vi.spyOn( configFile, operation ).mockRejectedValueOnce( new Error( 'Storage unavailable' ) );
	await expect(
		recordAnalyticsEvent( ipcEvent, event, { success: false }, operationalId )
	).resolves.toBeUndefined();
	expect( send ).toHaveBeenCalledTimes( 1 );
	const payload = new URL( send.mock.calls[ 0 ][ 0 ] ).searchParams;
	expect( payload.has( 'site_id' ) ).toBe( false );
	expect( payload.get( 'success' ) ).toBe( 'false' );
} );

it( 'serializes desktop initialization and keeps different sites distinct', async () => {
	await Promise.all(
		events.map( ( event ) =>
			recordAnalyticsEvent( ipcEvent, event, { success: true }, operationalId )
		)
	);
	const ids = send.mock.calls.map( ( [ url ] ) => new URL( url ).searchParams.get( 'site_id' ) );
	expect( ids[ 0 ] ).toMatch( uuid );
	expect( new Set( ids ).size ).toBe( 1 );
	const config = await configFile.readCliConfigFileRaw();
	( config.sites as object[] ).push( {
		id: 'other',
		path: '/another/path',
		name: 'Another title',
	} );
	await configFile.lockCliConfigFile();
	try {
		await configFile.writeCliConfigFileRaw( config );
	} finally {
		await configFile.unlockCliConfigFile();
	}
	await recordAnalyticsEvent( ipcEvent, TRACKS_EVENTS.SYNC_CONNECT, { success: true }, 'other' );
	expect( new URL( send.mock.calls[ 3 ][ 0 ] ).searchParams.get( 'site_id' ) ).not.toBe( ids[ 0 ] );
} );

it.each( events )( 'honors desktop opt-out and every disable path for %s', async ( event ) => {
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
