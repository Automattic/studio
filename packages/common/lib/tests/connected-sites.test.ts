import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeAllConnectedWpcomSitesForLocalSite } from '../connected-sites';
import type { SyncSite } from '../../types/sync';

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
