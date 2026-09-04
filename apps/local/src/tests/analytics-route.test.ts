import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

const recordTracksEvent = vi.fn( async () => undefined );

let server: LocalServer;
let configDir: string;

async function postEvent( body: unknown ): Promise< Response > {
	return fetch( `${ server.url }/api/analytics/event`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body ),
	} );
}

beforeEach( async () => {
	vi.clearAllMocks();
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-analytics-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
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
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

describe( 'PATCH /api/user-preferences database appearance', () => {
	async function saveAppearance( appearance: unknown ): Promise< Response > {
		return fetch( `${ server.url }/api/user-preferences`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { databaseAppearance: appearance } ),
		} );
	}

	it( 'records a real database appearance change', async () => {
		const response = await saveAppearance( 'phpmyadmin' );

		expect( response.status ).toBe( 204 );
		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SETTING_DATABASE_APPEARANCE_CHANGE,
			{ appearance: 'phpmyadmin', surface: 'settings' }
		);
	} );

	it( 'does not record when the database appearance is unchanged', async () => {
		const response = await saveAppearance( 'studio' );

		expect( response.status ).toBe( 204 );
		expect( recordTracksEvent ).not.toHaveBeenCalled();
	} );

	it( 'records clearing the preference as a change back to Studio', async () => {
		await saveAppearance( 'phpmyadmin' );
		recordTracksEvent.mockClear();

		const response = await saveAppearance( null );

		expect( response.status ).toBe( 204 );
		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SETTING_DATABASE_APPEARANCE_CHANGE,
			{ appearance: 'studio', surface: 'settings' }
		);
	} );

	it( 'rejects an unsupported database appearance', async () => {
		const response = await saveAppearance( 'something-else' );

		expect( response.status ).toBe( 400 );
		expect( recordTracksEvent ).not.toHaveBeenCalled();
	} );
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
