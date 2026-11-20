import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readConfig, updateConfig } from '../config/store';
import { getOrCreateAnalyticsInstallId, getTracksIdentity } from '../install';

const signIn = ( expiresAt: number ) => ( {
	token: 'token',
	expiresAt,
	user: { id: 123, email: 'user@example.com', displayName: 'User' },
} );

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

it( 'identifies Tracks events by the WordPress.com user id when logged in, carrying the install id', async () => {
	const installId = await getOrCreateAnalyticsInstallId();
	await updateConfig( ( { providers } ) => {
		providers.configs.wpcom = signIn( Date.now() + 60_000 );
	} );

	expect( await getTracksIdentity() ).toEqual( { type: 'wpcom:user_id', id: '123', installId } );
} );

it( 'identifies Tracks events by the anonymous install id when logged out', async () => {
	const identity = await getTracksIdentity();

	expect( identity ).toEqual( { type: 'anon', id: ( await readConfig() ).install.analyticsId } );
} );

it( 'identifies Tracks events by the anonymous install id when the token has expired', async () => {
	const installId = await getOrCreateAnalyticsInstallId();
	await updateConfig( ( { providers } ) => {
		providers.configs.wpcom = signIn( Date.now() - 60_000 );
	} );

	expect( await getTracksIdentity() ).toEqual( { type: 'anon', id: installId } );
} );
