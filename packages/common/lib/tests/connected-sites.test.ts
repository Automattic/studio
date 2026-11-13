import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	markConnectedWpcomSiteSynced,
	removeAllConnectedWpcomSitesForLocalSite,
} from '../connected-sites';
import { getCurrentUserId } from '../shared-config';
import type { SyncSite } from '../../types/sync';

vi.mock( '../shared-config', async ( actual ) => ( {
	...( await actual< typeof import('../shared-config') >() ),
	getCurrentUserId: vi.fn(),
} ) );

function connection( id: number, localSiteId: string ): SyncSite {
	return {
		id,
		localSiteId,
		name: `Site ${ id }`,
		url: `https://site-${ id }.example.com`,
		isStaging: false,
		isPressable: false,
		syncSupport: 'already-connected',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	};
}

describe( 'removeAllConnectedWpcomSitesForLocalSite', () => {
	let configDir: string;
	const writeConnections = ( connectedWpcomSites: Record< string, SyncSite[] > ) =>
		writeFileSync(
			path.join( configDir, 'shared.json' ),
			JSON.stringify( { version: 1, connectedWpcomSites } )
		);
	const readConfig = () =>
		JSON.parse( readFileSync( path.join( configDir, 'shared.json' ), 'utf8' ) );

	beforeEach( () => {
		configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-connected-sites-' ) );
		process.env.DEV_CONFIG_DIR = configDir;
	} );

	afterEach( () => {
		delete process.env.DEV_CONFIG_DIR;
		rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'saves a successful transfer baseline with its timestamp for just that connection', async () => {
		vi.mocked( getCurrentUserId ).mockResolvedValue( 7 );
		writeConnections( {
			'7': [ connection( 1, 'local-a' ), connection( 2, 'local-a' ), connection( 1, 'local-b' ) ],
			'8': [ connection( 1, 'local-a' ) ],
		} );
		await markConnectedWpcomSiteSynced( 'local-a', 1, 'push', 'sent-version' );
		const saved = readConfig().connectedWpcomSites;
		expect( saved[ '7' ][ 0 ] ).toMatchObject( {
			localVersionId: 'sent-version',
			lastPushTimestamp: expect.any( String ),
		} );
		expect( saved[ '7' ][ 1 ] ).not.toHaveProperty( 'localVersionId' );
		expect( saved[ '7' ][ 2 ] ).not.toHaveProperty( 'localVersionId' );
		expect( saved[ '8' ][ 0 ] ).not.toHaveProperty( 'localVersionId' );
		await markConnectedWpcomSiteSynced( 'local-a', 1, 'pull' );
		expect( readConfig().connectedWpcomSites[ '7' ][ 0 ] ).toMatchObject( {
			localVersionId: null,
			lastPullTimestamp: expect.any( String ),
		} );
	} );

	it( 'removes every connection for the local site across account buckets', async () => {
		writeConnections( {
			'7': [ connection( 1, 'local-a' ), connection( 2, 'local-b' ), connection( 3, 'local-a' ) ],
			'8': [ connection( 4, 'local-a' ) ],
		} );

		await removeAllConnectedWpcomSitesForLocalSite( 'local-a' );

		expect( readConfig().connectedWpcomSites ).toEqual( { '7': [ connection( 2, 'local-b' ) ] } );
	} );

	it( 'prunes the connection map when no connections remain', async () => {
		writeConnections( { '7': [ connection( 1, 'local-a' ) ] } );

		await removeAllConnectedWpcomSitesForLocalSite( 'local-a' );

		expect( readConfig() ).not.toHaveProperty( 'connectedWpcomSites' );
	} );
} );
