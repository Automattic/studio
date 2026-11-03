import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as configFile from '@studio/common/lib/cli-config-file';
import {
	TRACKS_EVENTS,
	type TracksEventName,
	type TracksProps,
} from '@studio/common/lib/record-tracks-event';
import { getCliConfigPath } from '@studio/common/lib/well-known-paths';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

const recordTracksEvent = vi.fn<
	( event: TracksEventName, props?: TracksProps ) => Promise< void >
>( async () => undefined );

let server: LocalServer;
let directory: string;
const operationalId = 'caller@example.test';

async function postEvent( body: unknown ): Promise< Response > {
	return fetch( `${ server.url }/api/analytics/event`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body ),
	} );
}

beforeEach( async () => {
	vi.clearAllMocks();
	directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-analytics-route-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', directory );
	await fs.writeFile(
		getCliConfigPath(),
		JSON.stringify( {
			version: 1,
			sites: [ { id: operationalId, path: '/private/path', name: 'Private title' } ],
			snapshots: [],
			otherField: { preserved: true },
		} )
	);
	server = await startLocalServer( {
		cliBinary: path.join( os.tmpdir(), 'studio-test-cli.mjs' ),
		sessionsRoot: path.join( os.tmpdir(), 'studio-test-sessions' ),
		sitesRoot: path.join( os.tmpdir(), 'studio-test-sites' ),
		port: 0,
		recordTracksEvent,
	} );
} );

afterEach( async () => {
	await server.close();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await fs.rm( directory, { recursive: true, force: true } );
} );

describe( 'POST /api/analytics/event', () => {
	it( 'records a known event with its props', async () => {
		const response = await postEvent( {
			eventName: TRACKS_EVENTS.SITE_OPEN_PHPMYADMIN,
			props: { browser: 'external' },
		} );

		expect( response.status ).toBe( 204 );
		expect( recordTracksEvent ).toHaveBeenCalledWith( TRACKS_EVENTS.SITE_OPEN_PHPMYADMIN, {
			browser: 'external',
		} );
	} );

	it( 'accepts an event with no props', async () => {
		const response = await postEvent( { eventName: TRACKS_EVENTS.APP_LAUNCH } );

		expect( response.status ).toBe( 204 );
		expect( recordTracksEvent ).toHaveBeenCalledWith( TRACKS_EVENTS.APP_LAUNCH, {} );
	} );

	it( 'drops an unknown event name instead of forwarding it', async () => {
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => undefined );

		const response = await postEvent( { eventName: 'studio_not_a_real_event' } );

		expect( response.status ).toBe( 204 );
		expect( recordTracksEvent ).not.toHaveBeenCalled();
		expect( warn ).toHaveBeenCalled();
		warn.mockRestore();
	} );

	it( 'rejects a body with no event name', async () => {
		const response = await postEvent( { props: { browser: 'external' } } );

		expect( response.status ).toBe( 400 );
		expect( recordTracksEvent ).not.toHaveBeenCalled();
	} );

	it( 'strips client-supplied channel and ui_version', async () => {
		await postEvent( {
			eventName: TRACKS_EVENTS.PANEL_OPENED,
			props: { panel: 'settings', channel: 'studio-ui', ui_version: 'v1' },
		} );

		expect( recordTracksEvent ).toHaveBeenCalledWith( TRACKS_EVENTS.PANEL_OPENED, {
			panel: 'settings',
		} );
	} );

	// Tracks coerces every value to a string, so an object would be sent as "[object Object]".
	it( 'keeps only primitive prop values', async () => {
		await postEvent( {
			eventName: TRACKS_EVENTS.PANEL_OPENED,
			props: {
				panel: 'settings',
				count: 2,
				enabled: true,
				nested: { a: 1 },
				list: [ 1, 2 ],
				missing: null,
			},
		} );

		expect( recordTracksEvent ).toHaveBeenCalledWith( TRACKS_EVENTS.PANEL_OPENED, {
			panel: 'settings',
			count: 2,
			enabled: true,
		} );
	} );

	// Telemetry is fire-and-forget: a recorder failure must not surface to the UI.
	it( 'still answers 204 when recording rejects', async () => {
		recordTracksEvent.mockRejectedValueOnce( new Error( 'network down' ) );

		const response = await postEvent( { eventName: TRACKS_EVENTS.APP_LAUNCH } );

		expect( response.status ).toBe( 204 );
	} );
} );

const events = [ TRACKS_EVENTS.SITE_EXPORT, TRACKS_EVENTS.SYNC_CONNECT, TRACKS_EVENTS.SYNC_PUSH ];
it.each(
	events.flatMap( ( eventName ) =>
		[ true, false ].map( ( success ) => ( { eventName, success } ) )
	)
)(
	'resolves the stored site UUID for $eventName (success $success)',
	async ( { eventName, success } ) => {
		await postEvent( {
			eventName,
			siteId: operationalId,
			props: { success, site_id: operationalId, preview_id: 'caller-preview' },
		} );
		const config = JSON.parse( await fs.readFile( getCliConfigPath(), 'utf8' ) );
		const id = config.sites[ 0 ].tracksId;
		expect( id ).toMatch( /^[0-9a-f-]{36}$/ );
		expect( id ).not.toBe( operationalId );
		expect( config.otherField ).toEqual( { preserved: true } );
		expect( recordTracksEvent ).toHaveBeenLastCalledWith( eventName, { success, site_id: id } );
		await postEvent( { eventName, siteId: operationalId, props: { success } } );
		expect( recordTracksEvent ).toHaveBeenLastCalledWith( eventName, { success, site_id: id } );
	}
);
it.each( events )( 'omits unresolved site IDs and preserves %s', async ( eventName ) => {
	await postEvent( {
		eventName,
		siteId: 'missing',
		props: { success: false, site_id: '/private/path' },
	} );
	expect( recordTracksEvent ).toHaveBeenLastCalledWith( eventName, { success: false } );
} );
it.each(
	events.flatMap( ( eventName ) =>
		(
			[
				'lockCliConfigFile',
				'readCliConfigFileRaw',
				'writeCliConfigFileRaw',
				'unlockCliConfigFile',
			] as const
		 ).map( ( operation ) => ( { eventName, operation } ) )
	)
)( 'keeps $eventName when ID $operation fails', async ( { eventName, operation } ) => {
	vi.spyOn( configFile, operation ).mockRejectedValueOnce( new Error( 'Storage unavailable' ) );
	const response = await postEvent( {
		eventName,
		siteId: operationalId,
		props: { success: false, site_id: operationalId },
	} );
	expect( response.status ).toBe( 204 );
	expect( recordTracksEvent ).toHaveBeenLastCalledWith( eventName, { success: false } );
} );

it( 'serializes concurrent host initialization with stable and distinct site UUIDs', async () => {
	await Promise.all(
		events.map( ( eventName ) =>
			postEvent( { eventName, siteId: operationalId, props: { success: true } } )
		)
	);
	const ids = recordTracksEvent.mock.calls.map( ( args ) => args[ 1 ]?.site_id );
	expect( ids[ 0 ] ).toMatch( /^[0-9a-f-]{36}$/ );
	expect( new Set( ids ).size ).toBe( 1 );
	const config = await configFile.readCliConfigFileRaw();
	( config.sites as object[] ).push( { id: 'other', path: '/other/path', name: 'Other title' } );
	await configFile.lockCliConfigFile();
	try {
		await configFile.writeCliConfigFileRaw( config );
	} finally {
		await configFile.unlockCliConfigFile();
	}
	await postEvent( {
		eventName: TRACKS_EVENTS.SYNC_CONNECT,
		siteId: 'other',
		props: { success: true },
	} );
	expect( recordTracksEvent ).toHaveBeenLastCalledWith( TRACKS_EVENTS.SYNC_CONNECT, {
		success: true,
		site_id: expect.any( String ),
	} );
	const last = recordTracksEvent.mock.calls.at( -1 );
	expect( last?.[ 1 ]?.site_id ).not.toBe( ids[ 0 ] );
} );
