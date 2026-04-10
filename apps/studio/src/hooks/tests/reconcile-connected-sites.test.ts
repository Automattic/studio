import { reconcileConnectedSites } from 'src/modules/sync/lib/reconcile-connected-sites';
import type { SyncSite } from '@studio/common/types/sync';

describe( 'reconcileConnectedSites', () => {
	test( 'should update relevant properties', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				localSiteId: 'local-site-id',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		];
		const freshWpComSites: SyncSite[] = [
			{
				id: 1,
				localSiteId: 'local-site-id',
				isStaging: true,
				isPressable: false,
				name: 'site1-updated',
				url: 'site1-updated.com',
				syncSupport: 'unsupported',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		];
		const result = reconcileConnectedSites( connectedSites, freshWpComSites );
		expect( result.updatedConnectedSites ).toEqual( [ freshWpComSites[ 0 ] ] );
	} );
} );
