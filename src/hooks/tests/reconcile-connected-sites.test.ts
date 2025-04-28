import { reconcileConnectedSites } from 'src/hooks/use-fetch-wpcom-sites/reconcile-connected-sites';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

describe( 'reconcileConnectedSites', () => {
	test( 'should update relevant properties', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [],
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
				stagingSiteIds: [],
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

	test( 'should add staging site, if it was added in wordpress.com', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [],
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
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: true,
				isPressable: false,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'syncable',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		];
		const result = reconcileConnectedSites( connectedSites, freshWpComSites );
		expect( result.stagingSitesToAdd ).toEqual( [
			{
				...freshWpComSites[ 1 ],
				syncSupport: 'already-connected',
			},
		] );
		expect( result.stagingSitesToDelete ).toEqual( [] );
	} );

	test( 'should delete staging site, if it was removed in wordpress.com', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: true,
				isPressable: false,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		];
		const freshWpComSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [],
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
		const result = reconcileConnectedSites( connectedSites, freshWpComSites );
		expect( result.stagingSitesToDelete ).toEqual( [ { id: 2, localSiteId: 'local-site-id' } ] );
		expect( result.stagingSitesToAdd ).toEqual( [] );
	} );

	test( 'should add new staging site and delete the old one, if staging site was recreated in wordpress.com', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: true,
				isPressable: false,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		];
		const freshWpComSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [ 3 ],
				localSiteId: 'local-site-id',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 3,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: true,
				isPressable: false,
				name: 'new-staging-site1',
				url: 'new-staging-site1.com',
				syncSupport: 'syncable',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		];
		const result = reconcileConnectedSites( connectedSites, freshWpComSites );
		expect( result.stagingSitesToDelete ).toEqual( [ { id: 2, localSiteId: 'local-site-id' } ] );
		expect( result.stagingSitesToAdd ).toEqual( [
			{
				...freshWpComSites[ 1 ],
				syncSupport: 'already-connected',
			},
		] );
	} );

	test( 'should not add or delete staging site, if it was not changed in wordpress.com', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: true,
				isPressable: false,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		];
		const freshWpComSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: true,
				isPressable: false,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		];
		const result = reconcileConnectedSites( connectedSites, freshWpComSites );
		expect( result.stagingSitesToDelete ).toEqual( [] );
		expect( result.stagingSitesToAdd ).toEqual( [] );
	} );

	test( 'should add staging site, if original site was initially connected to two different local sites, but initially w/o staging site', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-1',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 1,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-2',
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
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id-1',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id-2',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-1',
				isStaging: true,
				isPressable: false,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'syncable',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-2',
				isStaging: true,
				isPressable: false,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'syncable',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		];
		const result = reconcileConnectedSites( connectedSites, freshWpComSites );
		expect( result.stagingSitesToAdd ).toEqual( [
			{
				...freshWpComSites[ 2 ],
				syncSupport: 'already-connected',
			},
			{
				...freshWpComSites[ 3 ],
				syncSupport: 'already-connected',
			},
		] );
		expect( result.stagingSitesToDelete ).toEqual( [] );
		expect( result.updatedConnectedSites ).toEqual( [
			{
				...freshWpComSites[ 0 ],
				syncSupport: 'already-connected',
			},
			{
				...freshWpComSites[ 1 ],
				syncSupport: 'already-connected',
			},
		] );
	} );
	test( 'should delete staging site, if original site was initially connected to two different local sites, but initially with staging site', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id-1',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id-2',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-1',
				isStaging: true,
				isPressable: false,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-2',
				isStaging: true,
				isPressable: false,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		];
		const freshWpComSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-1',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
			{
				id: 1,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-2',
				isStaging: false,
				isPressable: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		];
		const result = reconcileConnectedSites( connectedSites, freshWpComSites );
		expect( result.updatedConnectedSites ).toEqual( [
			{
				...freshWpComSites[ 0 ],
				syncSupport: 'already-connected',
			},
			{
				...freshWpComSites[ 1 ],
				syncSupport: 'already-connected',
			},
			{
				...connectedSites[ 2 ],
				syncSupport: 'deleted',
			},
			{
				...connectedSites[ 3 ],
				syncSupport: 'deleted',
			},
		] );
		expect( result.stagingSitesToDelete ).toEqual( [
			{
				id: 2,
				localSiteId: 'local-site-id-1',
			},
			{
				id: 2,
				localSiteId: 'local-site-id-2',
			},
		] );
		expect( result.stagingSitesToAdd ).toEqual( [] );
	} );
} );
