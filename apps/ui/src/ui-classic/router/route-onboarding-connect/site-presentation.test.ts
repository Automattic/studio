import { describe, expect, it } from 'vitest';
import { presentRemoteSites, searchRemoteSites } from './site-presentation';
import type { SiteDetails, SyncSite } from '@/data/core';

function remoteSite( id: number, overrides: Partial< SyncSite > = {} ): SyncSite {
	return {
		id,
		localSiteId: '',
		name: `Site ${ id }`,
		url: `https://site-${ id }.example.com`,
		isStaging: false,
		isPressable: false,
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		...overrides,
	};
}

describe( 'remote site presentation', () => {
	it( 'separates available, connected, and unavailable sites', () => {
		const remoteSites = [
			remoteSite( 1 ),
			remoteSite( 2 ),
			remoteSite( 3, { syncSupport: 'needs-upgrade' } ),
			remoteSite( 4, { syncSupport: 'missing-permissions' } ),
		];
		const connections = [ remoteSite( 2, { localSiteId: 'local-1' } ) ];
		const localSites = [ { id: 'local-1', name: 'My local site' } as SiteDetails ];

		expect( presentRemoteSites( remoteSites, connections, localSites ) ).toMatchObject( [
			{ group: 'available' },
			{ group: 'connected', connectedLocalSiteNames: [ 'My local site' ] },
			{ group: 'needs-upgrade' },
			{ group: 'unavailable' },
		] );
	} );

	it( 'keeps Pressable sites visible and searchable by provider and environment', () => {
		const sites = presentRemoteSites(
			[
				remoteSite( 1, {
					name: 'Production Store',
					isPressable: true,
					environmentType: 'development',
				} ),
				remoteSite( 2 ),
			],
			[],
			[]
		);

		expect( searchRemoteSites( sites, 'Pressable' ) ).toHaveLength( 1 );
		expect( searchRemoteSites( sites, 'development' ) ).toHaveLength( 1 );
	} );
} );
