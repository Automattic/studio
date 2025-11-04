import { reconcileConnectedSites } from 'src/hooks/use-fetch-wpcom-sites/reconcile-connected-sites';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

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
				hasJetpack: true,
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
				hasJetpack: true,
			},
		];
		const result = reconcileConnectedSites( connectedSites, freshWpComSites );
		expect( result.updatedConnectedSites ).toEqual( [ freshWpComSites[ 0 ] ] );
	} );
} );
