import { buildStudioWorkspaces } from 'src/modules/workspaces';
import type { SyncSite } from '@studio/common/types/sync';

const createLocalSite = ( overrides: Partial< SiteDetails > = {} ): SiteDetails =>
	( {
		id: 'local-site-id',
		name: 'Auro Atelier',
		path: '/tmp/auro-atelier',
		port: 8881,
		running: false,
		phpVersion: '8.4',
		...overrides,
	} ) as SiteDetails;

const createSyncSite = ( overrides: Partial< SyncSite > = {} ): SyncSite => ( {
	id: 101,
	localSiteId: '',
	name: 'Auro Atelier',
	url: 'https://auro.example',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
	...overrides,
} );

describe( 'buildStudioWorkspaces', () => {
	it( 'builds a local-only workspace', () => {
		const localSite = createLocalSite();

		const workspaces = buildStudioWorkspaces( { localSites: [ localSite ] } );

		expect( workspaces ).toHaveLength( 1 );
		expect( workspaces[ 0 ] ).toMatchObject( {
			id: 'studio-workspace:local:local-site-id',
			name: 'Auro Atelier',
			targets: {
				local: { siteId: 'local-site-id' },
			},
			syncLinks: [],
			activity: { status: 'idle' },
		} );
		expect( workspaces[ 0 ].targets.production ).toBeUndefined();
		expect( workspaces[ 0 ].targets.staging ).toBeUndefined();
	} );

	it( 'builds a production-only workspace', () => {
		const productionSite = createSyncSite();

		const workspaces = buildStudioWorkspaces( { wpcomSites: [ productionSite ] } );

		expect( workspaces ).toHaveLength( 1 );
		expect( workspaces[ 0 ] ).toMatchObject( {
			id: 'studio-workspace:wpcom:101',
			targets: {
				production: { siteId: 101 },
			},
			syncLinks: [],
		} );
		expect( workspaces[ 0 ].targets.local ).toBeUndefined();
		expect( workspaces[ 0 ].targets.staging ).toBeUndefined();
	} );

	it( 'groups production and staging targets', () => {
		const productionSite = createSyncSite( { id: 101, stagingSiteIds: [ 202 ] } );
		const stagingSite = createSyncSite( {
			id: 202,
			name: 'Auro Atelier Staging',
			url: 'https://auro-staging.example',
			isStaging: true,
			productionSiteId: 101,
		} );

		const workspaces = buildStudioWorkspaces( {
			wpcomSites: [ productionSite, stagingSite ],
		} );

		expect( workspaces ).toHaveLength( 1 );
		expect( workspaces[ 0 ] ).toMatchObject( {
			id: 'studio-workspace:wpcom:101',
			targets: {
				production: { siteId: 101 },
				staging: { siteId: 202 },
			},
		} );
		expect( workspaces[ 0 ].syncLinks ).toEqual( [
			{ id: 'production:staging', source: 'production', target: 'staging', status: 'available' },
		] );
	} );

	it( 'groups local and production targets', () => {
		const localSite = createLocalSite();
		const productionSite = createSyncSite( {
			id: 101,
			localSiteId: localSite.id,
			syncSupport: 'already-connected',
		} );

		const workspaces = buildStudioWorkspaces( {
			localSites: [ localSite ],
			wpcomSites: [ productionSite ],
		} );

		expect( workspaces ).toHaveLength( 1 );
		expect( workspaces[ 0 ] ).toMatchObject( {
			id: 'studio-workspace:wpcom:101',
			targets: {
				local: { siteId: 'local-site-id' },
				production: { siteId: 101 },
			},
		} );
		expect( workspaces[ 0 ].syncLinks ).toEqual( [
			{ id: 'local:production', source: 'local', target: 'production', status: 'available' },
		] );
	} );

	it( 'groups local and staging targets', () => {
		const localSite = createLocalSite();
		const stagingSite = createSyncSite( {
			id: 202,
			localSiteId: localSite.id,
			name: 'Auro Atelier Staging',
			isStaging: true,
			productionSiteId: 101,
			syncSupport: 'already-connected',
		} );

		const workspaces = buildStudioWorkspaces( {
			localSites: [ localSite ],
			wpcomSites: [ stagingSite ],
		} );

		expect( workspaces ).toHaveLength( 1 );
		expect( workspaces[ 0 ] ).toMatchObject( {
			id: 'studio-workspace:wpcom:101',
			targets: {
				local: { siteId: 'local-site-id' },
				staging: { siteId: 202 },
			},
		} );
		expect( workspaces[ 0 ].syncLinks ).toEqual( [
			{ id: 'local:staging', source: 'local', target: 'staging', status: 'available' },
		] );
	} );

	it( 'groups local, production, and staging targets', () => {
		const localSite = createLocalSite();
		const productionSite = createSyncSite( {
			id: 101,
			localSiteId: localSite.id,
			stagingSiteIds: [ 202 ],
			syncSupport: 'already-connected',
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			localSiteId: localSite.id,
			name: 'Auro Atelier Staging',
			isStaging: true,
			productionSiteId: 101,
			syncSupport: 'already-connected',
		} );

		const workspaces = buildStudioWorkspaces( {
			localSites: [ localSite ],
			wpcomSites: [ productionSite, stagingSite ],
		} );

		expect( workspaces ).toHaveLength( 1 );
		expect( workspaces[ 0 ] ).toMatchObject( {
			id: 'studio-workspace:wpcom:101',
			targets: {
				local: { siteId: 'local-site-id' },
				production: { siteId: 101 },
				staging: { siteId: 202 },
			},
		} );
		expect( workspaces[ 0 ].syncLinks ).toEqual( [
			{ id: 'local:production', source: 'local', target: 'production', status: 'available' },
			{ id: 'local:staging', source: 'local', target: 'staging', status: 'available' },
			{ id: 'production:staging', source: 'production', target: 'staging', status: 'available' },
		] );
	} );

	it( 'groups production and staging by shared local site when explicit staging metadata is absent', () => {
		const localSite = createLocalSite();
		const productionSite = createSyncSite( {
			id: 101,
			localSiteId: localSite.id,
			syncSupport: 'already-connected',
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			localSiteId: localSite.id,
			name: 'Auro Atelier Staging',
			isStaging: true,
			syncSupport: 'already-connected',
		} );

		const workspaces = buildStudioWorkspaces( {
			localSites: [ localSite ],
			wpcomSites: [ productionSite, stagingSite ],
		} );

		expect( workspaces ).toHaveLength( 1 );
		expect( workspaces[ 0 ] ).toMatchObject( {
			id: 'studio-workspace:wpcom:101',
			targets: {
				local: { siteId: 'local-site-id' },
				production: { siteId: 101 },
				staging: { siteId: 202 },
			},
		} );
	} );

	it( 'does not group production and staging by name alone', () => {
		const productionSite = createSyncSite( {
			id: 101,
			name: 'Auro Atelier',
		} );
		const stagingSite = createSyncSite( {
			id: 202,
			name: 'Auro Atelier Staging',
			isStaging: true,
		} );

		const workspaces = buildStudioWorkspaces( {
			wpcomSites: [ productionSite, stagingSite ],
		} );

		expect( workspaces ).toHaveLength( 2 );
		expect( workspaces.map( ( workspace ) => workspace.id ) ).toEqual( [
			'studio-workspace:wpcom:101',
			'studio-workspace:wpcom:202',
		] );
	} );

	it( 'groups connected staging when WP.com staging details are missing', () => {
		const localSite = createLocalSite();
		const productionSite = createSyncSite( {
			id: 101,
			stagingSiteIds: [ 202 ],
		} );
		const connectedStagingSite = createSyncSite( {
			id: 202,
			localSiteId: localSite.id,
			name: 'Auro Atelier Staging',
			url: 'https://auro-staging.example',
			isStaging: true,
			productionSiteId: 101,
			syncSupport: 'already-connected',
			lastPullTimestamp: '2026-05-14T12:00:00.000Z',
		} );

		const workspaces = buildStudioWorkspaces( {
			localSites: [ localSite ],
			wpcomSites: [ productionSite ],
			connectedSites: [ connectedStagingSite ],
		} );

		expect( workspaces ).toHaveLength( 1 );
		expect( workspaces[ 0 ] ).toMatchObject( {
			id: 'studio-workspace:wpcom:101',
			targets: {
				local: { siteId: 'local-site-id' },
				production: { siteId: 101 },
				staging: {
					siteId: 202,
					site: expect.objectContaining( {
						localSiteId: localSite.id,
						lastPullTimestamp: '2026-05-14T12:00:00.000Z',
					} ),
				},
			},
		} );
	} );

	it( 'does not duplicate a local-backed workspace', () => {
		const localSite = createLocalSite();
		const productionSite = createSyncSite( {
			id: 101,
			localSiteId: localSite.id,
			syncSupport: 'already-connected',
		} );

		const workspaces = buildStudioWorkspaces( {
			localSites: [ localSite ],
			wpcomSites: [ productionSite ],
			connectedSites: [ productionSite ],
		} );

		expect( workspaces ).toHaveLength( 1 );
		expect( workspaces[ 0 ].targets.local?.siteId ).toBe( localSite.id );
		expect( workspaces[ 0 ].targets.production?.siteId ).toBe( productionSite.id );
	} );
} );
