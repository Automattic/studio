import { sortSites } from '@studio/common/lib/sort-sites';
import type { SyncSite } from '@studio/common/types/sync';
import type {
	BuildStudioWorkspacesInput,
	RemoteTarget,
	StudioWorkspace,
	WorkspaceSyncLink,
	WorkspaceTargetId,
} from 'src/modules/workspaces/types';

type WorkspaceGroup = {
	remoteSites: SyncSite[];
	localSiteIds: Set< string >;
	productionSiteId?: number;
};

const createProductionGroupKey = ( productionSiteId: number ) => `production:${ productionSiteId }`;

const createLocalGroupKey = ( localSiteId: string ) => `local:${ localSiteId }`;

const createRemoteGroupKey = ( remoteSiteId: number ) => `remote:${ remoteSiteId }`;

export function createStudioWorkspaceId( {
	productionSiteId,
	localSiteId,
	stagingSiteId,
}: {
	productionSiteId?: number;
	localSiteId?: string;
	stagingSiteId?: number;
} ) {
	if ( productionSiteId ) {
		return `studio-workspace:wpcom:${ productionSiteId }`;
	}

	if ( localSiteId ) {
		return `studio-workspace:local:${ localSiteId }`;
	}

	return `studio-workspace:wpcom:${ stagingSiteId }`;
}

export function mergeWpcomSitesWithConnectedSites(
	wpcomSites: SyncSite[] = [],
	connectedSites: SyncSite[] = []
) {
	const connectedSitesById = new Map( connectedSites.map( ( site ) => [ site.id, site ] ) );
	const mergedSites = wpcomSites.map( ( site ) => {
		const connectedSite = connectedSitesById.get( site.id );
		if ( ! connectedSite ) {
			return site;
		}

		return {
			...connectedSite,
			...site,
			localSiteId: connectedSite.localSiteId || site.localSiteId,
			productionSiteId: site.productionSiteId ?? connectedSite.productionSiteId,
			stagingSiteIds: site.stagingSiteIds ?? connectedSite.stagingSiteIds,
			syncSupport:
				connectedSite.syncSupport === 'already-connected'
					? connectedSite.syncSupport
					: site.syncSupport,
			lastPullTimestamp: connectedSite.lastPullTimestamp ?? site.lastPullTimestamp,
			lastPushTimestamp: connectedSite.lastPushTimestamp ?? site.lastPushTimestamp,
		};
	} );
	const mergedSiteIds = new Set( mergedSites.map( ( site ) => site.id ) );

	return [ ...mergedSites, ...connectedSites.filter( ( site ) => ! mergedSiteIds.has( site.id ) ) ];
}

function createRemoteRelationshipIndex( remoteSites: SyncSite[] ) {
	const productionSiteIdByStagingSiteId = new Map< number, number >();

	remoteSites.forEach( ( site ) => {
		if ( site.isStaging ) {
			return;
		}

		site.stagingSiteIds?.forEach( ( stagingSiteId ) => {
			if ( ! productionSiteIdByStagingSiteId.has( stagingSiteId ) ) {
				productionSiteIdByStagingSiteId.set( stagingSiteId, site.id );
			}
		} );
	} );

	return productionSiteIdByStagingSiteId;
}

function getKnownProductionSiteId(
	site: SyncSite,
	productionSiteIdByStagingSiteId: Map< number, number >
) {
	if ( ! site.isStaging ) {
		return site.id;
	}

	return site.productionSiteId ?? productionSiteIdByStagingSiteId.get( site.id );
}

function getOrCreateGroup( groups: Map< string, WorkspaceGroup >, key: string ) {
	const existingGroup = groups.get( key );
	if ( existingGroup ) {
		return existingGroup;
	}

	const group = {
		remoteSites: [],
		localSiteIds: new Set< string >(),
	};
	groups.set( key, group );
	return group;
}

function addRemoteSiteToGroup( group: WorkspaceGroup, site: SyncSite, productionSiteId?: number ) {
	if ( ! group.remoteSites.some( ( remoteSite ) => remoteSite.id === site.id ) ) {
		group.remoteSites.push( site );
	}

	if ( site.localSiteId ) {
		group.localSiteIds.add( site.localSiteId );
	}

	if ( productionSiteId && ! group.productionSiteId ) {
		group.productionSiteId = productionSiteId;
	}
}

function createWorkspaceSyncLinks( targets: StudioWorkspace[ 'targets' ] ): WorkspaceSyncLink[] {
	const links: Array< [ WorkspaceTargetId, WorkspaceTargetId ] > = [];

	if ( targets.local && targets.production ) {
		links.push( [ 'local', 'production' ] );
	}

	if ( targets.local && targets.staging ) {
		links.push( [ 'local', 'staging' ] );
	}

	if ( targets.production && targets.staging ) {
		links.push( [ 'production', 'staging' ] );
	}

	return links.map( ( [ source, target ] ) => ( {
		id: `${ source }:${ target }`,
		source,
		target,
		status: 'available',
	} ) );
}

function createRemoteTarget( id: RemoteTarget[ 'id' ], site?: SyncSite ) {
	if ( ! site ) {
		return undefined;
	}

	return {
		id,
		kind: 'remote' as const,
		siteId: site.id,
		site,
	};
}

function getFirstLocalSite(
	localSiteIds: Set< string >,
	localSitesById: Map< string, SiteDetails >,
	localSiteOrder: string[]
) {
	const localSiteId = localSiteOrder.find( ( siteId ) => localSiteIds.has( siteId ) );
	if ( localSiteId ) {
		return localSitesById.get( localSiteId );
	}

	return undefined;
}

function createStudioWorkspace(
	group: WorkspaceGroup,
	localSitesById: Map< string, SiteDetails >,
	localSiteOrder: string[]
): StudioWorkspace | undefined {
	const localSite = getFirstLocalSite( group.localSiteIds, localSitesById, localSiteOrder );
	const productionSite = group.remoteSites
		.filter( ( site ) => ! site.isStaging )
		.sort( ( a, b ) => a.name.localeCompare( b.name, undefined, { numeric: true } ) )[ 0 ];
	const stagingSite = group.remoteSites
		.filter( ( site ) => site.isStaging )
		.sort( ( a, b ) => a.name.localeCompare( b.name, undefined, { numeric: true } ) )[ 0 ];

	if ( ! localSite && ! productionSite && ! stagingSite ) {
		return undefined;
	}

	const targets: StudioWorkspace[ 'targets' ] = {};
	if ( localSite ) {
		targets.local = {
			id: 'local',
			kind: 'local',
			siteId: localSite.id,
			site: localSite,
		};
	}
	const productionTarget = createRemoteTarget( 'production', productionSite );
	if ( productionTarget ) {
		targets.production = productionTarget;
	}
	const stagingTarget = createRemoteTarget( 'staging', stagingSite );
	if ( stagingTarget ) {
		targets.staging = stagingTarget;
	}
	const productionSiteId =
		productionSite?.id ?? group.productionSiteId ?? stagingSite?.productionSiteId;
	const workspace = {
		id: createStudioWorkspaceId( {
			productionSiteId,
			localSiteId: localSite?.id,
			stagingSiteId: stagingSite?.id,
		} ),
		name: localSite?.name ?? productionSite?.name ?? stagingSite?.name ?? '',
		sortOrder: localSite?.sortOrder,
		targets,
		syncLinks: createWorkspaceSyncLinks( targets ),
		activity: {
			status: 'idle' as const,
		},
	};

	return workspace;
}

export function buildStudioWorkspaces( {
	localSites = [],
	wpcomSites = [],
	connectedSites = [],
}: BuildStudioWorkspacesInput ): StudioWorkspace[] {
	const remoteSites = mergeWpcomSitesWithConnectedSites( wpcomSites, connectedSites );
	const localSitesById = new Map( localSites.map( ( site ) => [ site.id, site ] ) );
	const localSiteOrder = localSites.map( ( site ) => site.id );
	const productionSiteIdByStagingSiteId = createRemoteRelationshipIndex( remoteSites );
	const groups = new Map< string, WorkspaceGroup >();
	const groupedRemoteSiteIds = new Set< number >();
	const groupKeysByLocalSiteId = new Map< string, string >();

	remoteSites.forEach( ( site ) => {
		const productionSiteId = getKnownProductionSiteId( site, productionSiteIdByStagingSiteId );
		if ( ! productionSiteId ) {
			return;
		}

		const groupKey = createProductionGroupKey( productionSiteId );
		const group = getOrCreateGroup( groups, groupKey );
		addRemoteSiteToGroup( group, site, productionSiteId );
		groupedRemoteSiteIds.add( site.id );

		if ( site.localSiteId ) {
			groupKeysByLocalSiteId.set( site.localSiteId, groupKey );
		}
	} );

	remoteSites.forEach( ( site ) => {
		if ( groupedRemoteSiteIds.has( site.id ) ) {
			return;
		}

		const groupKey =
			( site.localSiteId && groupKeysByLocalSiteId.get( site.localSiteId ) ) ||
			( site.localSiteId
				? createLocalGroupKey( site.localSiteId )
				: createRemoteGroupKey( site.id ) );
		const group = getOrCreateGroup( groups, groupKey );
		addRemoteSiteToGroup( group, site );
		groupedRemoteSiteIds.add( site.id );

		if ( site.localSiteId ) {
			groupKeysByLocalSiteId.set( site.localSiteId, groupKey );
		}
	} );

	const localSiteIdsWithRemoteTargets = new Set< string >();
	groups.forEach( ( group ) => {
		group.localSiteIds.forEach( ( siteId ) => localSiteIdsWithRemoteTargets.add( siteId ) );
	} );

	localSites.forEach( ( site ) => {
		if ( localSiteIdsWithRemoteTargets.has( site.id ) ) {
			return;
		}

		const group = getOrCreateGroup( groups, createLocalGroupKey( site.id ) );
		group.localSiteIds.add( site.id );
	} );

	return sortSites(
		Array.from( groups.values() )
			.map( ( group ) => createStudioWorkspace( group, localSitesById, localSiteOrder ) )
			.filter( ( workspace ): workspace is StudioWorkspace => Boolean( workspace ) )
	);
}
