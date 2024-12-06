import { useEffect, useCallback } from 'react';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useAuth } from '../use-auth';
import { FetchSites, SyncSite, useFetchWpComSites } from '../use-fetch-wpcom-sites';
import { useSiteDetails } from '../use-site-details';

/**
 * Generate updated site data to be stored in `appdata-v1.json` in three steps:
 *   1. Update the list of `connectedSites` with fresh data (name, URL, etc)
 *   2. Find any staging sites that have been added to an already connected site
 *   3. Find any connected staging sites that have been deleted on WordPress.com
 *
 * We treat staging sites differently from production sites because users can't connect staging
 * sites separately from production sites (they're always connected together). So, while deleted
 * production sites are still rendered in the UI (with a "deleted" notice), we need to automatically
 * keep the list of staging sites up-to-date, which is where `stagingSitesToAdd` and
 * `stagingSitesToDelete` comes in.
 */
export const reconcileConnectedSites = (
	connectedSites: SyncSite[],
	freshWpComSites: SyncSite[]
): {
	updatedConnectedSites: SyncSite[];
	stagingSitesToAdd: SyncSite[];
	stagingSitesToDelete: { id: number; localSiteId: string }[];
} => {
	const updatedConnectedSites = connectedSites.map( ( connectedSite ): SyncSite => {
		const site = freshWpComSites.find( ( site ) => site.id === connectedSite.id );

		if ( ! site ) {
			return {
				...connectedSite,
				syncSupport: 'deleted',
			};
		}

		return {
			...connectedSite,
			name: site.name,
			url: site.url,
			syncSupport: site.syncSupport,
			stagingSiteIds: site.stagingSiteIds,
		};
	}, [] );

	const stagingSitesToAdd = connectedSites.flatMap( ( connectedSite ) => {
		const updatedConnectedSite = updatedConnectedSites.find(
			( site ) => site.id === connectedSite.id
		);

		if ( ! updatedConnectedSite?.stagingSiteIds.length ) {
			return [];
		}

		const addedStagingSiteIds = updatedConnectedSite.stagingSiteIds.filter(
			( id ) => ! connectedSite.stagingSiteIds.includes( id )
		);

		return addedStagingSiteIds.flatMap( ( id ): SyncSite[] => {
			const freshSite = freshWpComSites.find( ( site ) => site.id === id );

			if ( ! freshSite ) {
				return [];
			}

			return [
				{
					...freshSite,
					localSiteId: connectedSite.localSiteId,
					syncSupport: 'already-connected',
				},
			];
		}, [] );
	} );

	const stagingSitesToDelete = connectedSites.flatMap( ( connectedSite ) => {
		const updatedConnectedSite = updatedConnectedSites.find(
			( site ) => site.id === connectedSite.id
		);

		if ( ! connectedSite?.stagingSiteIds.length ) {
			return [];
		}

		return connectedSite.stagingSiteIds
			.filter( ( id ) => ! updatedConnectedSite?.stagingSiteIds.includes( id ) )
			.map( ( id ) => {
				return {
					id,
					localSiteId: connectedSite.localSiteId,
				};
			} );
	} );

	return {
		updatedConnectedSites,
		stagingSitesToAdd,
		stagingSitesToDelete,
	};
};

type ConnectedSites = SyncSite[];
type LoadConnectedSites = () => Promise< void >;
type ConnectSite = ( site: SyncSite, overrideLocalSiteId?: string ) => Promise< void >;
type DisconnectSite = ( siteId: number ) => Promise< void >;

type UseSiteSyncManagementProps = {
	connectedSites: ConnectedSites;
	setConnectedSites: React.Dispatch< React.SetStateAction< ConnectedSites > >;
};

export type UseSiteSyncManagement = {
	connectedSites: ConnectedSites;
	loadConnectedSites: LoadConnectedSites;
	connectSite: ConnectSite;
	disconnectSite: DisconnectSite;
	syncSites: SyncSite[];
	isFetching: boolean;
	refetchSites: FetchSites;
};

export const useSiteSyncManagement = ( {
	connectedSites,
	setConnectedSites,
}: UseSiteSyncManagementProps ): UseSiteSyncManagement => {
	const { isAuthenticated } = useAuth();
	const { syncSites, isFetching, isInitialized, refetchSites } = useFetchWpComSites(
		connectedSites.map( ( { id } ) => id )
	);
	const { selectedSite } = useSiteDetails();
	const localSiteId = selectedSite?.id;

	const loadConnectedSites = useCallback< LoadConnectedSites >( async () => {
		if ( ! localSiteId ) {
			setConnectedSites( [] );
			return;
		}

		try {
			const sites = await getIpcApi().getConnectedWpcomSites( localSiteId );
			setConnectedSites( sites );
		} catch ( error ) {
			console.error( 'Failed to load connected sites:', error );
			setConnectedSites( [] );
		}
	}, [ localSiteId, setConnectedSites ] );

	useEffect( () => {
		if ( isAuthenticated ) {
			loadConnectedSites();
		}
	}, [ isAuthenticated, loadConnectedSites ] );

	// whenever array of syncSites changes, we need to update connectedSites to keep them updated with wordpress.com
	useEffect( () => {
		if ( isFetching || ! isAuthenticated || ! isInitialized ) {
			return;
		}

		getIpcApi()
			.getConnectedWpcomSites()
			.then( async ( allConnectedSites ) => {
				const { updatedConnectedSites, stagingSitesToAdd, stagingSitesToDelete } =
					reconcileConnectedSites( allConnectedSites, syncSites );

				await getIpcApi().updateConnectedWpcomSites( updatedConnectedSites );

				if ( stagingSitesToDelete.length ) {
					const data = stagingSitesToDelete.map( ( { id, localSiteId } ) => ( {
						siteIds: [ id ],
						localSiteId,
					} ) );

					await getIpcApi().disconnectWpcomSites( data );
				}

				if ( stagingSitesToAdd.length ) {
					const data = stagingSitesToAdd.map( ( site ) => ( {
						sites: [ site ],
						localSiteId: site.localSiteId,
					} ) );

					await getIpcApi().connectWpcomSites( data );
				}

				loadConnectedSites();
			} );
	}, [
		isAuthenticated,
		syncSites,
		isFetching,
		isInitialized,
		setConnectedSites,
		loadConnectedSites,
	] );

	const connectSite = useCallback< ConnectSite >(
		async ( site, overrideLocalSiteId ) => {
			const localSiteIdToConnect = overrideLocalSiteId ?? localSiteId;
			if ( ! localSiteIdToConnect ) {
				return;
			}
			try {
				const stagingSites = site.stagingSiteIds.flatMap(
					( id ) => syncSites.find( ( s ) => s.id === id ) ?? []
				);
				const sitesToConnect = [ site, ...stagingSites ];

				const newConnectedSites = await getIpcApi().connectWpcomSites( [
					{
						sites: sitesToConnect,
						localSiteId: localSiteIdToConnect,
					},
				] );
				if ( localSiteIdToConnect === localSiteId ) {
					setConnectedSites( newConnectedSites );
				}
			} catch ( error ) {
				console.error( 'Failed to connect site:', error );
				throw error;
			}
		},
		[ localSiteId, syncSites, setConnectedSites ]
	);

	const disconnectSite = useCallback< DisconnectSite >(
		async ( siteId ) => {
			if ( ! localSiteId ) {
				return;
			}
			try {
				const siteToDisconnect = connectedSites.find( ( site ) => site.id === siteId );
				if ( ! siteToDisconnect ) {
					throw new Error( 'Site not found' );
				}

				const sitesToDisconnect = [ siteId, ...siteToDisconnect.stagingSiteIds ];
				const newDisconnectedSites = await getIpcApi().disconnectWpcomSites( [
					{
						siteIds: sitesToDisconnect,
						localSiteId,
					},
				] );

				setConnectedSites( newDisconnectedSites );
			} catch ( error ) {
				console.error( 'Failed to disconnect site:', error );
				throw error;
			}
		},
		[ localSiteId, connectedSites, setConnectedSites ]
	);

	return {
		connectedSites,
		loadConnectedSites,
		connectSite,
		disconnectSite,
		syncSites,
		isFetching,
		refetchSites,
	};
};
