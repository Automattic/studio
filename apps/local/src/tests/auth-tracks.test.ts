import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	TRACKS_EVENTS,
	type TracksEventName,
	type TracksProps,
} from '@studio/common/lib/record-tracks-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer, type LocalServer } from '../index';

const recordTracksEvent = vi.fn(
	async ( _event: TracksEventName, _props?: TracksProps ) => undefined
);
const nativeFetch = globalThis.fetch;
let server: LocalServer;
let configDir: string;

beforeEach( async () => {
	vi.clearAllMocks();
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-auth-tracks-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
	server = await startLocalServer( {
		cliBinary: '/unused',
		sessionsRoot: configDir,
		sitesRoot: configDir,
		port: 0,
		recordTracksEvent,
	} );
} );

afterEach( async () => {
	await server.close();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	rmSync( configDir, { recursive: true, force: true } );
} );

async function start( placement = 'share' ) {
	const query = new URLSearchParams( {
		redirect_uri: `${ server.url }/auth/callback`,
		source: 'previews_tab',
		signup: '1',
		placement,
		intent: 'share',
		journey_id: crypto.randomUUID(),
		journey_started_at: '1234',
	} );
	return ( await fetch( `${ server.url }/api/auth/login-url?${ query }` ) ).json() as Promise< {
		url: string;
		authAttemptId: string;
	} >;
}

function post( route: string, body: unknown ) {
	return fetch( `${ server.url }/api/auth/${ route }`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body ),
	} );
}

describe( 'browser auth Tracks parity', () => {
	it( 'correlates reversed callbacks with their own starts and records after saving', async () => {
		const first = await start();
		const second = await start( 'settings_sharing' );
		const nested = new URL( new URL( first.url ).searchParams.get( 'oauth2_redirect' )! );
		expect( nested.searchParams.get( 'state' ) ).toBe( first.authAttemptId );
		vi.spyOn( globalThis, 'fetch' ).mockImplementation( ( input, init ) =>
			String( input ).startsWith( 'https://public-api.wordpress.com/' )
				? Promise.resolve(
						new Response(
							JSON.stringify( { ID: 1, email: 'private@example.com', display_name: 'Private' } )
						)
				  )
				: nativeFetch( input, init )
		);
		const response = await post( 'login', {
			auth_attempt_id: second.authAttemptId,
			token: 'secret',
		} );
		expect( response.status ).toBe( 200 );
		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.WPCOM_AUTH,
			expect.objectContaining( {
				auth_attempt_id: second.authAttemptId,
				placement: 'settings_sharing',
				journey_started_at: 1234,
				success: true,
			} )
		);
		await post( 'login', { auth_attempt_id: first.authAttemptId, error: 'access_denied' } );
		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.WPCOM_AUTH,
			expect.objectContaining( {
				auth_attempt_id: first.authAttemptId,
				placement: 'share',
				success: false,
				failure_reason: 'access_denied',
			} )
		);
		expect( JSON.stringify( recordTracksEvent.mock.calls ) ).not.toMatch(
			/secret|private@example/
		);
	} );

	it( 'records observed cancellation once without turning it into a callback failure', async () => {
		const attempt = await start();
		await post( 'cancel', { auth_attempt_id: attempt.authAttemptId } );
		await post( 'cancel', { auth_attempt_id: attempt.authAttemptId } );
		expect(
			recordTracksEvent.mock.calls.filter(
				( [ event ] ) => event === TRACKS_EVENTS.WPCOM_AUTH_CANCELLED
			)
		).toHaveLength( 1 );
		expect(
			recordTracksEvent.mock.calls.some( ( [ event ] ) => event === TRACKS_EVENTS.WPCOM_AUTH )
		).toBe( false );
	} );

	it( 'keeps unknown returns unattributed and classifies profile failures', async () => {
		const attempt = await start();
		vi.spyOn( globalThis, 'fetch' ).mockImplementation( ( input, init ) =>
			String( input ).startsWith( 'https://public-api.wordpress.com/' )
				? Promise.resolve( new Response( '{}', { status: 401 } ) )
				: nativeFetch( input, init )
		);
		await post( 'login', { auth_attempt_id: attempt.authAttemptId, token: 'invalid' } );
		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.WPCOM_AUTH,
			expect.objectContaining( { success: false, failure_reason: 'profile_fetch_failed' } )
		);
		await post( 'login', { error: 'access_denied' } );
		expect( recordTracksEvent ).toHaveBeenLastCalledWith( TRACKS_EVENTS.WPCOM_AUTH, {
			source: 'unknown',
			success: false,
			failure_reason: 'access_denied',
		} );
	} );
} );
