import { reconcileConnectedSites } from 'src/modules/sync/lib/reconcile-connected-sites';
import type { SyncSite } from '@studio/common/types/sync';

const baseSite = ( overrides: Partial< SyncSite > = {} ): SyncSite => ( {
	id: 1,
	localSiteId: 'local-site-id',
	isStaging: false,
	isPressable: false,
	name: 'site1',
	url: 'site1.com',
	syncSupport: 'already-connected',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
	...overrides,
} );

describe( 'reconcileConnectedSites', () => {
	test( 'should update relevant properties when site is found in fresh list', () => {
		const connectedSites: SyncSite[] = [ baseSite() ];
		const freshWpComSites: SyncSite[] = [
			baseSite( {
				isStaging: true,
				name: 'site1-updated',
				url: 'site1-updated.com',
				syncSupport: 'unsupported',
			} ),
		];
		const result = reconcileConnectedSites( connectedSites, freshWpComSites );
		expect( result.updatedConnectedSites ).toEqual( [ freshWpComSites[ 0 ] ] );
	} );

	test( 'preserves site when missing from fresh list and not verified deleted', () => {
		// Pagination case: connected site isn't on the fetched page.
		const connectedSites: SyncSite[] = [ baseSite() ];
		const result = reconcileConnectedSites( connectedSites, [] );
		expect( result.updatedConnectedSites ).toEqual( connectedSites );
	} );

	test( 'marks site deleted when id is in verifiedDeletedIds', () => {
		const connectedSites: SyncSite[] = [ baseSite() ];
		const result = reconcileConnectedSites( connectedSites, [], new Set( [ 1 ] ) );
		expect( result.updatedConnectedSites[ 0 ].syncSupport ).toBe( 'deleted' );
	} );

	test( 'prefers fresh data over verifiedDeletedIds when site is present', () => {
		const connectedSites: SyncSite[] = [ baseSite() ];
		const freshWpComSites: SyncSite[] = [ baseSite( { syncSupport: 'already-connected' } ) ];
		const result = reconcileConnectedSites( connectedSites, freshWpComSites, new Set( [ 1 ] ) );
		expect( result.updatedConnectedSites[ 0 ].syncSupport ).toBe( 'already-connected' );
	} );
} );
