import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readConfig, updateConfig } from '../config/store';
import { getOrCreateAnalyticsInstallId, identifyTracksEvent } from '../install';

async function setUp( {
	loggedIn = true,
	expired = false,
	noticeSeen = true,
}: { loggedIn?: boolean; expired?: boolean; noticeSeen?: boolean } = {} ) {
	await updateConfig( ( { providers, preferences } ) => {
		if ( loggedIn ) {
			providers.configs.wpcom = {
				token: 'token',
				expiresAt: Date.now() + ( expired ? -60_000 : 60_000 ),
				user: { id: 123, email: 'user@example.com', displayName: 'User' },
			};
		}
		if ( noticeSeen ) {
			preferences.usageNoticeSeen = true;
		}
	} );
}

const linked = { linkAccount: true };

let configDir: string;

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-install-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
} );

afterEach( () => {
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

it( 'mints the analytics install id once, even for concurrent callers', async () => {
	const ids = await Promise.all( [
		getOrCreateAnalyticsInstallId(),
		getOrCreateAnalyticsInstallId(),
	] );

	expect( ids[ 0 ] ).toBeTruthy();
	expect( ids[ 1 ] ).toBe( ids[ 0 ] );
	expect( ( await readConfig() ).install.analyticsId ).toBe( ids[ 0 ] );
	expect( await getOrCreateAnalyticsInstallId() ).toBe( ids[ 0 ] );
} );

it( 'attributes events to the WordPress.com user once the usage notice is seen, without the install id', async () => {
	const installId = await getOrCreateAnalyticsInstallId();
	await setUp();

	const { identity, props } = await identifyTracksEvent( { channel: 'studio-ui' }, linked );

	expect( identity ).toEqual( { type: 'wpcom:user_id', id: '123' } );
	expect( props ).toEqual( { channel: 'studio-ui' } );
	expect( JSON.stringify( { identity, props } ) ).not.toContain( installId );
} );

it( 'keeps events anonymous when logged out', async () => {
	await setUp( { loggedIn: false } );

	const { identity } = await identifyTracksEvent( {}, linked );

	expect( identity ).toEqual( { type: 'anon', id: ( await readConfig() ).install.analyticsId } );
} );

it( 'keeps events anonymous when the token has expired', async () => {
	await setUp( { expired: true } );

	const { identity } = await identifyTracksEvent( {}, linked );

	expect( identity ).toEqual( { type: 'anon', id: await getOrCreateAnalyticsInstallId() } );
} );

it( 'keeps logged-in events anonymous until the usage notice is seen', async () => {
	await setUp( { noticeSeen: false } );

	const { identity } = await identifyTracksEvent( {}, linked );

	expect( identity ).toEqual( { type: 'anon', id: await getOrCreateAnalyticsInstallId() } );
} );

it( 'keeps logged-in events anonymous where the account is not linked, like the standalone CLI', async () => {
	await setUp();

	const { identity } = await identifyTracksEvent( {}, { linkAccount: false } );

	expect( identity ).toEqual( { type: 'anon', id: await getOrCreateAnalyticsInstallId() } );
} );

it( 'gives logged-in events their own join ids, so they never join the anonymous ones', async () => {
	await setUp();
	const props = {
		site_id: 'site-uuid',
		journey_id: 'journey-uuid',
		ai_session_id: 'session-uuid',
		journey_started_at: 1700000000000,
		channel: 'studio-ui',
	};

	const anonymous = await identifyTracksEvent( props, { linkAccount: false } );
	const first = await identifyTracksEvent( props, linked );
	const second = await identifyTracksEvent( props, linked );

	expect( anonymous.props ).toEqual( props );
	expect( first.props.channel ).toBe( 'studio-ui' );
	expect( first.props ).not.toHaveProperty( 'journey_started_at' );
	for ( const prop of [ 'site_id', 'journey_id', 'ai_session_id' ] as const ) {
		expect( first.props[ prop ] ).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
		);
		expect( first.props[ prop ] ).not.toBe( props[ prop ] );
		expect( second.props[ prop ] ).toBe( first.props[ prop ] );
	}
	const key = ( await readConfig() ).install.accountTracksKey;
	expect( key ).toBeTruthy();
	expect( JSON.stringify( first ) ).not.toContain( key );
} );
