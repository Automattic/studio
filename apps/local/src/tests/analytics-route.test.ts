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

	it.each( [
		[ TRACKS_EVENTS.BLUEPRINT_VIEWED, { blueprint_slug: 'substrata', use_case: 'blog' } ],
		[ TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED, { use_case: 'all' } ],
		[
			TRACKS_EVENTS.BLUEPRINT_PREVIEW_IN_BROWSER,
			{ blueprint_slug: 'substrata', placement: 'add_site_blueprint_details' },
		],
		[
			TRACKS_EVENTS.BLUEPRINT_CREATE_SITE_INTENT,
			{ blueprint_slug: 'substrata', placement: 'add_site_blueprint_details' },
		],
		[ TRACKS_EVENTS.BLANK_SITE_SELECTED, { placement: 'add_site_blueprint_gallery' } ],
	] )(
		'forwards Blueprint dialog event %s through the browser recorder',
		async ( eventName, props ) => {
			const response = await postEvent( { eventName, props } );
			expect( response.status ).toBe( 204 );
			expect( recordTracksEvent ).toHaveBeenCalledExactlyOnceWith( eventName, props );
		}
	);

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
it( 'omits an unresolved site ID and preserves the event', async () => {
	await postEvent( {
		eventName: TRACKS_EVENTS.SYNC_CONNECT,
		siteId: 'missing',
		props: { success: false, site_id: '/private/path' },
	} );
	expect( recordTracksEvent ).toHaveBeenLastCalledWith( TRACKS_EVENTS.SYNC_CONNECT, {
		success: false,
	} );
} );
it( 'preserves the event when site ID persistence fails', async () => {
	vi.spyOn( configFile, 'writeCliConfigFileRaw' ).mockRejectedValueOnce(
		new Error( 'Storage unavailable' )
	);
	const response = await postEvent( {
		eventName: TRACKS_EVENTS.SYNC_CONNECT,
		siteId: operationalId,
		props: { success: false, site_id: operationalId },
	} );
	expect( response.status ).toBe( 204 );
	expect( recordTracksEvent ).toHaveBeenLastCalledWith( TRACKS_EVENTS.SYNC_CONNECT, {
		success: false,
	} );
} );
