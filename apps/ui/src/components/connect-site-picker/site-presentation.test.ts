import { describe, expect, it } from 'vitest';
import { presentRemoteSites, searchRemoteSites } from './site-presentation';
import type { SyncSite } from '@/data/core';

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
	it( 'keeps previously connected sites available and separates unsupported sites', () => {
		const remoteSites = [
			remoteSite( 1 ),
			remoteSite( 2, { syncSupport: 'already-connected' } ),
			remoteSite( 3, { syncSupport: 'needs-upgrade' } ),
			remoteSite( 4, { syncSupport: 'missing-permissions' } ),
		];

		expect( presentRemoteSites( remoteSites ) ).toMatchObject( [
			{ group: 'available' },
			{ group: 'available' },
			{ group: 'needs-upgrade' },
			{ group: 'unavailable' },
		] );
	} );

	it( 'keeps Pressable sites visible and searchable by provider and environment', () => {
		const sites = presentRemoteSites( [
			remoteSite( 1, {
				name: 'Production Store',
				isPressable: true,
				environmentType: 'development',
			} ),
			remoteSite( 2 ),
		] );

		expect( searchRemoteSites( sites, 'Pressable' ) ).toHaveLength( 1 );
		expect( searchRemoteSites( sites, 'development' ) ).toHaveLength( 1 );
	} );
} );
