import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removeAllConnectedWpcomSitesForLocalSite } from '../connected-sites';
import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
} from '../shared-config';
import type { SyncSite } from '../../types/sync';

vi.mock( '../shared-config', () => ( {
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

	it( 'prunes the user and top-level connection maps when no connections remain', async () => {
		const config = {
			version: 1 as const,
			connectedWpcomSites: { '7': [ connection( 1, 'local-a' ) ] },
		};
		vi.mocked( readSharedConfig ).mockResolvedValue( config );

		await removeAllConnectedWpcomSitesForLocalSite( 'local-a' );

		expect( config ).not.toHaveProperty( 'connectedWpcomSites' );
	} );
} );
