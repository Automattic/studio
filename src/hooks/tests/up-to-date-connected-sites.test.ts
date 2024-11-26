import { upToDateConnectedSites } from '../sync-sites/use-site-sync-management';
import { SyncSite } from '../use-fetch-wpcom-sites';

describe( 'upToDateConnectedSites', () => {
	test( 'should update name, url, syncSupport properties', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
		];
		const originalSitesFromWpCom: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: false,
				name: 'site1-updated',
				url: 'site1-updated.com',
				syncSupport: 'unsupported',
			},
		];
		const result = upToDateConnectedSites( connectedSites, originalSitesFromWpCom );
		expect( result.updatedConnectedSites ).toEqual( [ originalSitesFromWpCom[ 0 ] ] );
	} );

	test( 'should add staging site, if it was added in wordpress.com', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
		];
		const originalSitesFromWpCom: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: true,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'syncable',
			},
		];
		const result = upToDateConnectedSites( connectedSites, originalSitesFromWpCom );
		expect( result.toAdd ).toEqual( [
			{
				...originalSitesFromWpCom[ 1 ],
				syncSupport: 'already-connected',
			},
		] );
		expect( result.toDelete ).toEqual( [] );
	} );

	test( 'should delete staging site, if it was removed in wordpress.com', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: true,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'already-connected',
			},
		];
		const originalSitesFromWpCom: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
		];
		const result = upToDateConnectedSites( connectedSites, originalSitesFromWpCom );
		expect( result.toDelete ).toEqual( [ { id: 2, localSiteId: 'local-site-id' } ] );
		expect( result.toAdd ).toEqual( [] );
	} );

	test( 'should add new staging site and delete the old one, if staging site was recreated in wordpress.com', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: true,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'already-connected',
			},
		];
		const originalSitesFromWpCom: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [ 3 ],
				localSiteId: 'local-site-id',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 3,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: true,
				name: 'new-staging-site1',
				url: 'new-staging-site1.com',
				syncSupport: 'syncable',
			},
		];
		const result = upToDateConnectedSites( connectedSites, originalSitesFromWpCom );
		expect( result.toDelete ).toEqual( [ { id: 2, localSiteId: 'local-site-id' } ] );
		expect( result.toAdd ).toEqual( [
			{
				...originalSitesFromWpCom[ 1 ],
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
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: true,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'already-connected',
			},
		];
		const originalSitesFromWpCom: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id',
				isStaging: true,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'already-connected',
			},
		];
		const result = upToDateConnectedSites( connectedSites, originalSitesFromWpCom );
		expect( result.toDelete ).toEqual( [] );
		expect( result.toAdd ).toEqual( [] );
	} );

	test( 'should add staging site, if original site was initially connected to two different local sites, but initially w/o staging site', () => {
		const connectedSites: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-1',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 1,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-2',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
		];
		const originalSitesFromWpCom: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id-1',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id-2',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-1',
				isStaging: true,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'syncable',
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-2',
				isStaging: true,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'syncable',
			},
		];
		const result = upToDateConnectedSites( connectedSites, originalSitesFromWpCom );
		expect( result.toAdd ).toEqual( [
			{
				...originalSitesFromWpCom[ 2 ],
				syncSupport: 'already-connected',
			},
			{
				...originalSitesFromWpCom[ 3 ],
				syncSupport: 'already-connected',
			},
		] );
		expect( result.toDelete ).toEqual( [] );
		expect( result.updatedConnectedSites ).toEqual( [
			{
				...originalSitesFromWpCom[ 0 ],
				syncSupport: 'already-connected',
			},
			{
				...originalSitesFromWpCom[ 1 ],
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
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 1,
				stagingSiteIds: [ 2 ],
				localSiteId: 'local-site-id-2',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-1',
				isStaging: true,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 2,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-2',
				isStaging: true,
				name: 'staging-site1',
				url: 'staging-site1.com',
				syncSupport: 'already-connected',
			},
		];
		const originalSitesFromWpCom: SyncSite[] = [
			{
				id: 1,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-1',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
			{
				id: 1,
				stagingSiteIds: [],
				localSiteId: 'local-site-id-2',
				isStaging: false,
				name: 'site1',
				url: 'site1.com',
				syncSupport: 'already-connected',
			},
		];
		const result = upToDateConnectedSites( connectedSites, originalSitesFromWpCom );
		expect( result.updatedConnectedSites ).toEqual( [
			{
				...originalSitesFromWpCom[ 0 ],
				syncSupport: 'already-connected',
			},
			{
				...originalSitesFromWpCom[ 1 ],
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
		expect( result.toDelete ).toEqual( [
			{
				id: 2,
				localSiteId: 'local-site-id-1',
			},
			{
				id: 2,
				localSiteId: 'local-site-id-2',
			},
		] );
		expect( result.toAdd ).toEqual( [] );
	} );
} );
