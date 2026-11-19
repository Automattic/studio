import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getConfigPath, readConfig, updateConfig } from '../config/store';
import { forgetRemoteSite, getRemoteSites, rememberRemoteSite } from '../remote-sites';
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

const signIn = ( id: number ) => ( {
	token: 'token',
	expiresAt: Date.now() + 60_000,
	user: { id, email: 'user@example.com', displayName: 'User' },
} );

let configDir: string;

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-remote-sites-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	writeFileSync(
		getConfigPath(),
		JSON.stringify( {
			version: 1,
			providers: { configs: { wpcom: signIn( 7 ) } },
			sites: [ { id: 'local-a', name: 'Site', path: '/sites/a', port: 8881, phpVersion: '8.3' } ],
		} )
	);
} );

afterEach( () => {
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

it( 'keeps publish intent across refreshes and failed launches until explicitly cleared', async () => {
	await rememberRemoteSite( 'wpcom', 'local-a', { ...listedSite, launchAfterPush: true } );
	await rememberRemoteSite( 'wpcom', 'local-a', listedSite, 'push' );
	expect( ( await getRemoteSites( 'wpcom', 'local-a' ) )[ 0 ].launchAfterPush ).toBe( true );
	await rememberRemoteSite( 'wpcom', 'local-a', { ...listedSite, launchAfterPush: false }, 'push' );
	expect( ( await getRemoteSites( 'wpcom', 'local-a' ) )[ 0 ].launchAfterPush ).toBe( false );
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

it( 'lists only the signed-in account’s WordPress.com connections', async () => {
	await rememberRemoteSite( 'wpcom', 'local-a', listedSite );
	await updateConfig( ( { providers } ) => {
		providers.configs.wpcom = signIn( 8 );
	} );

	expect( await getRemoteSites( 'wpcom', 'local-a' ) ).toEqual( [] );
	await rememberRemoteSite( 'wpcom', 'local-a', { ...listedSite, id: 2 } );
	expect( ( await getRemoteSites( 'wpcom' ) ).map( ( site ) => site.id ) ).toEqual( [ 2 ] );
	expect(
		( await readConfig() ).sites[ 0 ].connections?.map( ( { account } ) => account )
	).toEqual( [ '7', '8' ] );

	await updateConfig( ( { providers } ) => {
		delete providers.configs.wpcom;
	} );
	expect( await getRemoteSites( 'wpcom' ) ).toEqual( [] );
} );

it( 'keeps the Spaces a site publishes to, and forgets them', async () => {
	const space = {
		id: 'spc_1',
		name: 'Site',
		url: 'https://site.space.fast',
		slug: 'site',
		teamId: 't',
	};
	await rememberRemoteSite( 'spacefast', 'local-a', space, 'push' );
	await rememberRemoteSite( 'spacefast', 'local-a', { ...space, name: 'Renamed' } );

	expect( await getRemoteSites( 'spacefast', 'local-a' ) ).toEqual( [
		{
			...space,
			name: 'Renamed',
			localSiteId: 'local-a',
			lastPushTimestamp: expect.any( String ),
			lastPullTimestamp: null,
		},
	] );

	await forgetRemoteSite( 'spacefast', 'local-a', 'spc_1' );
	expect( await getRemoteSites( 'spacefast', 'local-a' ) ).toEqual( [] );
	expect( ( await readConfig() ).sites[ 0 ] ).not.toHaveProperty( 'connections' );
} );
