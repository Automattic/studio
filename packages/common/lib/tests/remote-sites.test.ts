import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getConfigPath, readConfig, updateConfig } from '../config/store';
import {
	connectPublishingSite,
	recordRemoteSitePublish,
	forgetRemoteSite,
	getRemoteSites,
	rememberRemoteSite,
} from '../remote-sites';
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
	await rememberRemoteSite( 'wpcom', 'local-a', listedSite, { synced: 'push' } );
	expect( ( await getRemoteSites( 'wpcom', 'local-a' ) )[ 0 ].launchAfterPush ).toBe( true );
	await rememberRemoteSite(
		'wpcom',
		'local-a',
		{ ...listedSite, launchAfterPush: false },
		{ synced: 'push' }
	);
	expect( ( await getRemoteSites( 'wpcom', 'local-a' ) )[ 0 ].launchAfterPush ).toBe( false );
} );

it( 'records each sync and keeps the times of the others', async () => {
	await rememberRemoteSite( 'wpcom', 'local-a', listedSite, { synced: 'pull' } );
	await rememberRemoteSite(
		'wpcom',
		'local-a',
		{ ...listedSite, name: 'Renamed' },
		{ synced: 'push' }
	);

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
	await rememberRemoteSite( 'spacefast', 'local-a', space, { synced: 'push' } );
	await rememberRemoteSite( 'spacefast', 'local-a', { ...space, name: 'Renamed' } );

	expect( await getRemoteSites( 'spacefast', 'local-a' ) ).toEqual( [
		{
			...space,
			name: 'Renamed',
			localSiteId: 'local-a',
			localVersionId: null,
			lastPushTimestamp: expect.any( String ),
			lastPullTimestamp: null,
		},
	] );

	await forgetRemoteSite( 'spacefast', 'local-a', 'spc_1' );
	expect( await getRemoteSites( 'spacefast', 'local-a' ) ).toEqual( [] );
	expect( ( await readConfig() ).sites[ 0 ] ).not.toHaveProperty( 'connections' );
} );

it( 'keeps a full-transfer baseline through metadata refreshes and invalidates it after a partial transfer', async () => {
	await rememberRemoteSite( 'wpcom', 'local-a', listedSite, {
		synced: 'push',
		localVersionId: 'full-version',
	} );
	await rememberRemoteSite( 'wpcom', 'local-a', { ...listedSite, name: 'Updated name' } );
	expect( ( await getRemoteSites( 'wpcom', 'local-a' ) )[ 0 ].localVersionId ).toBe(
		'full-version'
	);
	await rememberRemoteSite( 'wpcom', 'local-a', listedSite, {
		synced: 'pull',
		localVersionId: null,
	} );
	expect( ( await getRemoteSites( 'wpcom', 'local-a' ) )[ 0 ].localVersionId ).toBeNull();
} );

it( 'replaces only the current publishing destination and preserves previews and other accounts', async () => {
	await updateConfig( ( { sites } ) => {
		sites[ 0 ].connections = [
			{
				provider: 'wpcom',
				account: '8',
				preview: true,
				site: { id: 91 },
				localVersionId: 'preview-version',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		];
	} );
	await rememberRemoteSite( 'wpcom', 'local-a', listedSite );
	await updateConfig( ( { providers } ) => {
		providers.configs.wpcom = signIn( 8 );
	} );
	await rememberRemoteSite( 'wpcom', 'local-a', { ...listedSite, id: 8 } );
	await connectPublishingSite( 'spacefast', 'local-a', {
		id: 'space',
		name: 'Static',
		url: 'https://example.space.fast',
		slug: 'example',
		teamId: 'team',
	} );
	expect( await getRemoteSites( 'wpcom', 'local-a' ) ).toEqual( [] );
	expect( ( await readConfig() ).sites[ 0 ].connections ).toContainEqual(
		expect.objectContaining( { preview: true, localVersionId: 'preview-version' } )
	);
	await updateConfig( ( { providers } ) => {
		providers.configs.wpcom = signIn( 7 );
	} );
	expect( ( await getRemoteSites( 'wpcom', 'local-a' ) ).map( ( remote ) => remote.id ) ).toEqual( [
		1,
	] );
	expect( await getRemoteSites( 'spacefast', 'local-a' ) ).toHaveLength( 1 );
} );

it( 'keeps the previous destination until the checkout site is published successfully', async () => {
	await rememberRemoteSite( 'wpcom', 'local-a', listedSite );
	const checkout = { ...listedSite, id: 2, launchAfterPush: true };
	await connectPublishingSite( 'wpcom', 'local-a', checkout );
	expect( await getRemoteSites( 'wpcom', 'local-a' ) ).toHaveLength( 2 );
	await recordRemoteSitePublish(
		'wpcom',
		'local-a',
		{ ...checkout, launchAfterPush: false },
		'published-version'
	);
	expect( await getRemoteSites( 'wpcom', 'local-a' ) ).toMatchObject( [
		{ id: 2, localVersionId: 'published-version', launchAfterPush: false },
	] );
} );

it( 'updates an existing destination without dropping other legacy connections', async () => {
	await rememberRemoteSite( 'wpcom', 'local-a', listedSite );
	await rememberRemoteSite( 'wpcom', 'local-a', { ...listedSite, id: 2 } );
	await recordRemoteSitePublish( 'wpcom', 'local-a', listedSite, 'new-version' );
	expect( await getRemoteSites( 'wpcom', 'local-a' ) ).toHaveLength( 2 );
} );

it( 'keeps existing connections when a new destination is pushed from the CLI', async () => {
	await rememberRemoteSite( 'wpcom', 'local-a', listedSite );
	await recordRemoteSitePublish(
		'spacefast',
		'local-a',
		{
			id: 'space',
			name: 'Static',
			url: 'https://example.space.fast',
			slug: 'example',
			teamId: 'team',
		},
		'new-version'
	);
	expect( ( await getRemoteSites( 'wpcom', 'local-a' ) ).map( ( remote ) => remote.id ) ).toEqual( [
		1,
	] );
	expect( await getRemoteSites( 'spacefast', 'local-a' ) ).toMatchObject( [
		{ id: 'space', localVersionId: 'new-version' },
	] );
} );
