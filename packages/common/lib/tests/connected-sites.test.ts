import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	removeAllConnectedWpcomSitesForLocalSite,
	updateConnectedWpcomSites,
} from '../connected-sites';
import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
} from '../shared-config';
import type { SyncSite } from '../../types/sync';

vi.mock( '../shared-config', () => ( {
	getCurrentUserId: vi.fn().mockResolvedValue( 7 ),
	lockSharedConfig: vi.fn(),
	readSharedConfig: vi.fn(),
	saveSharedConfig: vi.fn(),
	unlockSharedConfig: vi.fn(),
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
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'removes every connection for the local site across account buckets while locked', async () => {
		const config = {
			version: 1 as const,
			connectedWpcomSites: {
				'7': [ connection( 1, 'local-a' ), connection( 2, 'local-b' ), connection( 3, 'local-a' ) ],
				'8': [ connection( 4, 'local-a' ) ],
			},
		};
		vi.mocked( readSharedConfig ).mockResolvedValue( config );

		await removeAllConnectedWpcomSitesForLocalSite( 'local-a' );

		expect( lockSharedConfig ).toHaveBeenCalledOnce();
		expect( saveSharedConfig ).toHaveBeenCalledWith( config );
		expect( unlockSharedConfig ).toHaveBeenCalledOnce();
		expect( config.connectedWpcomSites[ '7' ] ).toEqual( [ connection( 2, 'local-b' ) ] );
		expect( config.connectedWpcomSites ).not.toHaveProperty( '8' );
	} );

	it( 'prunes the connection map when no connections remain', async () => {
		const config = {
			version: 1 as const,
			connectedWpcomSites: { '7': [ connection( 1, 'local-a' ) ] },
		};
		vi.mocked( readSharedConfig ).mockResolvedValue( config );

		await removeAllConnectedWpcomSitesForLocalSite( 'local-a' );

		expect( config ).not.toHaveProperty( 'connectedWpcomSites' );
	} );
} );

describe( 'updateConnectedWpcomSites', () => {
	it( 'updates the connections matching both ids and keeps the fields an update leaves out', async () => {
		const pushed = { ...connection( 1, 'local-a' ), lastPushTimestamp: '2026-10-01T00:00:00.000Z' };
		const config = {
			version: 1 as const,
			connectedWpcomSites: { '7': [ pushed, connection( 1, 'local-b' ) ] },
		};
		vi.mocked( readSharedConfig ).mockResolvedValue( config );

		await updateConnectedWpcomSites( [
			{ id: 1, localSiteId: 'local-a', name: 'Renamed', syncSupport: 'deleted' },
		] );

		expect( config.connectedWpcomSites[ '7' ] ).toEqual( [
			{ ...pushed, name: 'Renamed', syncSupport: 'deleted' },
			connection( 1, 'local-b' ),
		] );
	} );
} );
