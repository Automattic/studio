import type { SyncSite } from '@studio/common/types/sync';

export type WpcomSiteWorkspace = {
	id: string;
	name: string;
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

export const createWpcomSiteWorkspaces = ( sites: SyncSite[] ): WpcomSiteWorkspace[] => {
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

		workspaces.push( {
			id: createWpcomSiteWorkspaceId( site ),
			name: site.name,
			primarySite: site,
			productionSite: site,
			stagingSites: allStagingSites,
			sites: [ site, ...allStagingSites ],
		} );
	} );

	sites.forEach( ( site ) => {
		if ( groupedSiteIds.has( site.id ) ) {
			return;
		}

		workspaces.push( {
			id: createWpcomSiteWorkspaceId( site ),
			name: site.name,
			primarySite: site,
			productionSite: site.isStaging ? undefined : site,
			stagingSites: site.isStaging ? [ site ] : [],
			sites: [ site ],
		} );
	} );

	return workspaces;
};

export const getWpcomSiteWorkspaceForSite = ( sites: SyncSite[], selectedSite: SyncSite ) =>
	createWpcomSiteWorkspaces(
		sites.some( ( site ) => site.id === selectedSite.id ) ? sites : [ ...sites, selectedSite ]
	).find( ( workspace ) => workspace.sites.some( ( site ) => site.id === selectedSite.id ) );

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

export const getDefaultWpcomWorkspaceTarget = ( workspace: WpcomSiteWorkspace ) =>
	getSavedWpcomWorkspaceTarget( workspace ) ?? workspace.productionSite ?? workspace.primarySite;
