import type { SyncSite } from '@studio/common/types/sync';

export type WpcomSiteWorkspace = {
	id: string;
	name: string;
	localSite?: SiteDetails;
	primarySite: SyncSite;
	productionSite?: SyncSite;
	stagingSites: SyncSite[];
	sites: SyncSite[];
};

const normalizeSiteName = ( name: string ) => name.trim().toLowerCase().replace( /\s+/g, ' ' );

const getWorkspaceNameKey = ( name: string ) =>
	normalizeSiteName( name ).replace( /\s+(staging|stage)$/, '' );

export const createWpcomSiteWorkspaceId = ( site: SyncSite ) =>
	`wpcom-site-workspace:${ site.productionSiteId ?? site.id }`;

const mergeSiteLists = ( sites: SyncSite[], connectedSites: SyncSite[] = [] ) => {
	const connectedSitesById = new Map( connectedSites.map( ( site ) => [ site.id, site ] ) );
	const mergedSites = sites.map( ( site ) => {
		const connectedSite = connectedSitesById.get( site.id );
		if ( ! connectedSite ) {
			return site;
		}

		return {
			...connectedSite,
			...site,
			localSiteId: connectedSite.localSiteId,
			lastPullTimestamp: connectedSite.lastPullTimestamp,
			lastPushTimestamp: connectedSite.lastPushTimestamp,
		};
	} );
	const mergedSiteIds = new Set( mergedSites.map( ( site ) => site.id ) );

	return [ ...mergedSites, ...connectedSites.filter( ( site ) => ! mergedSiteIds.has( site.id ) ) ];
};

export const mergeWpcomSitesWithConnectedSites = mergeSiteLists;

const getLocalSiteForWorkspace = ( workspaceSites: SyncSite[], localSites: SiteDetails[] = [] ) => {
	const localSiteIds = workspaceSites
		.map( ( site ) => site.localSiteId )
		.filter( ( localSiteId ): localSiteId is string => Boolean( localSiteId ) );

	return localSites.find( ( localSite ) => localSiteIds.includes( localSite.id ) );
};

const getWorkspaceId = ( site: SyncSite, localSite?: SiteDetails ) =>
	localSite?.id ? `studio-workspace:${ localSite.id }` : createWpcomSiteWorkspaceId( site );

export const createWpcomSiteWorkspaces = (
	sites: SyncSite[],
	localSites: SiteDetails[] = []
): WpcomSiteWorkspace[] => {
	const sitesById = new Map( sites.map( ( site ) => [ site.id, site ] ) );
	const stagingSitesByProductionSiteId = new Map< number, SyncSite[] >();
	const groupedSiteIds = new Set< number >();
	const workspaces: WpcomSiteWorkspace[] = [];
	const unlinkedStagingSites = sites.filter(
		( site ) => site.isStaging && ! site.productionSiteId
	);

	for ( const site of sites ) {
		if ( site.isStaging && site.productionSiteId ) {
			stagingSitesByProductionSiteId.set( site.productionSiteId, [
				...( stagingSitesByProductionSiteId.get( site.productionSiteId ) ?? [] ),
				site,
			] );
		}
	}

	sites.forEach( ( site ) => {
		if ( site.isStaging || groupedSiteIds.has( site.id ) ) {
			return;
		}

		const stagingSites = [
			...( stagingSitesByProductionSiteId.get( site.id ) ?? [] ),
			...( site.stagingSiteIds ?? [] )
				.map( ( stagingSiteId ) => sitesById.get( stagingSiteId ) )
				.filter( ( stagingSite ): stagingSite is SyncSite => Boolean( stagingSite ) ),
		];
		const fallbackStagingSites = unlinkedStagingSites.filter(
			( stagingSite ) =>
				getWorkspaceNameKey( stagingSite.name ) === getWorkspaceNameKey( site.name )
		);
		const allStagingSites = [ ...stagingSites, ...fallbackStagingSites ].filter(
			( stagingSite, index, allSites ) =>
				index === allSites.findIndex( ( candidate ) => candidate.id === stagingSite.id )
		);

		groupedSiteIds.add( site.id );
		allStagingSites.forEach( ( stagingSite ) => groupedSiteIds.add( stagingSite.id ) );
		const workspaceSites = [ site, ...allStagingSites ];
		const localSite = getLocalSiteForWorkspace( workspaceSites, localSites );

		workspaces.push( {
			id: getWorkspaceId( site, localSite ),
			name: site.name,
			localSite,
			primarySite: site,
			productionSite: site,
			stagingSites: allStagingSites,
			sites: workspaceSites,
		} );
	} );

	sites.forEach( ( site ) => {
		if ( groupedSiteIds.has( site.id ) ) {
			return;
		}

		const localSite = getLocalSiteForWorkspace( [ site ], localSites );

		workspaces.push( {
			id: getWorkspaceId( site, localSite ),
			name: site.name,
			localSite,
			primarySite: site,
			productionSite: site.isStaging ? undefined : site,
			stagingSites: site.isStaging ? [ site ] : [],
			sites: [ site ],
		} );
	} );

	return workspaces;
};

export const getWpcomSiteWorkspaceForSite = (
	sites: SyncSite[],
	selectedSite: SyncSite,
	localSites: SiteDetails[] = []
) =>
	createWpcomSiteWorkspaces(
		sites.some( ( site ) => site.id === selectedSite.id ) ? sites : [ ...sites, selectedSite ],
		localSites
	).find( ( workspace ) => workspace.sites.some( ( site ) => site.id === selectedSite.id ) );

export const getWpcomSiteWorkspaceForLocalSite = (
	sites: SyncSite[],
	localSite: SiteDetails,
	localSites: SiteDetails[] = [ localSite ]
) =>
	createWpcomSiteWorkspaces( sites, localSites ).find(
		( workspace ) => workspace.localSite?.id === localSite.id
	);

const getWorkspaceTargetStorageKey = ( workspaceId: string ) =>
	`dolly_wpcom_workspace_target:${ workspaceId }`;

export const getSavedWpcomWorkspaceTarget = ( workspace: WpcomSiteWorkspace ) => {
	const savedSiteId = Number(
		localStorage.getItem( getWorkspaceTargetStorageKey( workspace.id ) )
	);
	if ( Number.isFinite( savedSiteId ) ) {
		return workspace.sites.find( ( site ) => site.id === savedSiteId );
	}

	return undefined;
};

export const setSavedWpcomWorkspaceTarget = ( workspaceId: string, siteId: number ) => {
	localStorage.setItem( getWorkspaceTargetStorageKey( workspaceId ), String( siteId ) );
};

export const setSavedWpcomWorkspaceLocalTarget = ( workspaceId: string ) => {
	localStorage.setItem( getWorkspaceTargetStorageKey( workspaceId ), 'local' );
};

export const isSavedWpcomWorkspaceLocalTarget = ( workspace: WpcomSiteWorkspace ) =>
	localStorage.getItem( getWorkspaceTargetStorageKey( workspace.id ) ) === 'local';

export const getDefaultWpcomWorkspaceTarget = ( workspace: WpcomSiteWorkspace ) =>
	getSavedWpcomWorkspaceTarget( workspace ) ?? workspace.productionSite ?? workspace.primarySite;
