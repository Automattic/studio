import {
	createWpcomSiteWorkspaces,
	mergeWpcomSitesWithConnectedSites,
} from 'src/modules/wpcom-site-assistant/lib/workspaces';
import type { SyncSite } from '@studio/common/types/sync';

const createSyncSite = ( overrides: Partial< SyncSite > = {} ): SyncSite => ( {
	id: 1,
	localSiteId: '',
	name: 'Production Site',
	url: 'https://production.example',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
	...overrides,
} );

const createLocalSite = ( overrides: Partial< SiteDetails > = {} ): SiteDetails =>
	( {
		id: 'local-site-id',
		name: 'Production Site',
		path: '/tmp/site',
		running: false,
		...overrides,
	} ) as SiteDetails;

describe( 'WP.com site workspaces', () => {
	it( 'merges connected site metadata before grouping production and staging targets', () => {
		const productionSite = createSyncSite( {
			id: 101,
			stagingSiteIds: [ 202 ],
		} );
		const stagingSiteFromWpcom = createSyncSite( {
			id: 202,
			name: 'Production Site Staging',
			url: 'https://staging.example',
			isStaging: true,
			productionSiteId: 101,
			lastPullTimestamp: null,
		} );
		const connectedStagingSite = createSyncSite( {
			...stagingSiteFromWpcom,
			localSiteId: 'local-site-id',
			lastPullTimestamp: '2026-05-14T12:00:00.000Z',
			syncSupport: 'already-connected',
		} );
		const localSite = createLocalSite();

		const mergedSites = mergeWpcomSitesWithConnectedSites(
			[ productionSite, stagingSiteFromWpcom ],
			[ connectedStagingSite ]
		);
		const workspaces = createWpcomSiteWorkspaces( mergedSites, [ localSite ] );

		expect( workspaces ).toHaveLength( 1 );
		expect( workspaces[ 0 ] ).toMatchObject( {
			id: 'studio-workspace:local-site-id',
			localSite,
			productionSite: expect.objectContaining( { id: 101 } ),
			stagingSites: [ expect.objectContaining( { id: 202, localSiteId: 'local-site-id' } ) ],
		} );
		expect( workspaces[ 0 ].stagingSites[ 0 ].lastPullTimestamp ).toBe(
			'2026-05-14T12:00:00.000Z'
		);
	} );

	it( 'keeps a production workspace when staging details are missing', () => {
		const productionSite = createSyncSite( {
			id: 101,
			stagingSiteIds: [ 202 ],
		} );

		const workspaces = createWpcomSiteWorkspaces( [ productionSite ] );

		expect( workspaces ).toHaveLength( 1 );
		expect( workspaces[ 0 ].productionSite?.id ).toBe( 101 );
		expect( workspaces[ 0 ].stagingSites ).toEqual( [] );
		expect( workspaces[ 0 ].productionSite?.stagingSiteIds ).toEqual( [ 202 ] );
	} );
} );
