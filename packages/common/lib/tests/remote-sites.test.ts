import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getRemoteSites, rememberRemoteSite } from '../remote-sites';
import type { SyncSite } from '../../types/sync';

// As the account's site list returns it: without sync times.
const listedSite: SyncSite = {
	id: 1,
	localSiteId: '',
	name: 'Live',
	url: 'https://live.example.com',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
};

let configDir: string;

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-remote-sites-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	writeFileSync(
		path.join( configDir, 'shared.json' ),
		JSON.stringify( {
			version: 1,
			authToken: {
				accessToken: 'token',
				expirationTime: Date.now() + 60_000,
				expiresIn: 60,
				id: 7,
				email: 'user@example.com',
				displayName: 'User',
			},
		} )
	);
} );

afterEach( () => {
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

it( 'records each sync and keeps the times of the others', async () => {
	await rememberRemoteSite( 'wpcom', 'local-a', listedSite, 'pull' );
	await rememberRemoteSite( 'wpcom', 'local-a', { ...listedSite, name: 'Renamed' }, 'push' );

	const [ site ] = await getRemoteSites( 'wpcom', 'local-a' );
	expect( site ).toMatchObject( {
		name: 'Renamed',
		localSiteId: 'local-a',
		syncSupport: 'already-connected',
		lastPullTimestamp: expect.any( String ),
		lastPushTimestamp: expect.any( String ),
	} );
} );
