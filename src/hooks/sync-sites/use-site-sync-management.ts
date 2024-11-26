import { useEffect, useCallback } from 'react';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useAuth } from '../use-auth';
import { SyncSite, useFetchWpComSites } from '../use-fetch-wpcom-sites';
import { useSiteDetails } from '../use-site-details';

type UpToDateConnectedSitesReturn = {
	updatedConnectedSites: SyncSite[];
	toAdd: SyncSite[];
	toDelete: { id: number; localSiteId: string }[];
};

export const upToDateConnectedSites = (
	connectedSites: SyncSite[],
	originalSitesFromWpCom: SyncSite[]
): UpToDateConnectedSitesReturn => {
	const updatedConnectedSites = connectedSites.reduce( ( acc: SyncSite[], connectedSite ) => {
		const site = originalSitesFromWpCom.find( ( site ) => site.id === connectedSite.id );

		if ( ! site ) {
			acc.push( {
				...connectedSite,
				syncSupport: 'deleted',
			} );
		} else {
			acc.push( {
				...connectedSite,
				name: site.name,
				url: site.url,
				syncSupport: site.syncSupport,
				stagingSiteIds: site.stagingSiteIds,
			} );
		}

		return acc;
	}, [] );

	const { toAdd, toDelete } = connectedSites.reduce(
		( acc: Omit< UpToDateConnectedSitesReturn, 'updatedConnectedSites' >, prevSiteState ) => {
			const newSiteState = updatedConnectedSites.find( ( site ) => site.id === prevSiteState.id );

			if ( ! prevSiteState.stagingSiteIds.length && ! newSiteState?.stagingSiteIds.length ) {
				return acc;
			}

			const toAdd =
				newSiteState?.stagingSiteIds
					.filter( ( id ) => ! prevSiteState.stagingSiteIds.includes( id ) )
					.reduce( ( acc: SyncSite[], id ) => {
						const site = originalSitesFromWpCom.find( ( site ) => site.id === id );

						if ( site ) {
							acc.push( {
								...site,
								localSiteId: prevSiteState.localSiteId,
								syncSupport: 'already-connected',
							} );
						}

						return acc;
					}, [] ) || [];

			const toDelete = prevSiteState.stagingSiteIds
				.filter( ( id ) => ! newSiteState?.stagingSiteIds.includes( id ) )
				.map( ( id ) => ( {
					id,
					localSiteId: prevSiteState.localSiteId,
				} ) );

			acc.toAdd.push( ...toAdd );
			acc.toDelete.push( ...toDelete );

			return acc;
		},
		{ toAdd: [], toDelete: [] }
	);

	return {
		updatedConnectedSites,
		toAdd,
		toDelete,
	};
};

export const useSiteSyncManagement = ( {
	connectedSites,
	setConnectedSites,
}: {
	connectedSites: SyncSite[];
	setConnectedSites: React.Dispatch< React.SetStateAction< SyncSite[] > >;
} ) => {
	const { isAuthenticated } = useAuth();
	const { syncSites, isFetching, isInitialized, refetchSites } = useFetchWpComSites(
		connectedSites.map( ( { id } ) => id )
	);
	const { selectedSite } = useSiteDetails();
	const localSiteId = selectedSite?.id;

	const loadConnectedSites = useCallback( async () => {
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
				const { updatedConnectedSites, toAdd, toDelete } = upToDateConnectedSites(
					allConnectedSites,
					syncSites
				);

				await getIpcApi().updateConnectedWpcomSites( updatedConnectedSites );
				debugger;
				if ( toDelete.length ) {
					for ( const data of toDelete ) {
						await getIpcApi().disconnectWpcomSite( [ data.id ], data.localSiteId );
					}
				}

				if ( toAdd.length ) {
					for ( const site of toAdd ) {
						await getIpcApi().connectWpcomSite( [ site ], site.localSiteId );
					}
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

	const connectSite = useCallback(
		async ( site: SyncSite ) => {
			if ( ! localSiteId ) {
				return;
			}
			try {
				const stagingSites = site.stagingSiteIds.flatMap(
					( id ) => syncSites.find( ( s ) => s.id === id ) ?? []
				);
				const sitesToConnect = [ site, ...stagingSites ];

				const newConnectedSites = await getIpcApi().connectWpcomSite( sitesToConnect, localSiteId );
				setConnectedSites( newConnectedSites );
			} catch ( error ) {
				console.error( 'Failed to connect site:', error );
				throw error;
			}
		},
		[ localSiteId, syncSites, setConnectedSites ]
	);

	const disconnectSite = useCallback(
		async ( siteId: number ) => {
			if ( ! localSiteId ) {
				return;
			}
			try {
				const siteToDisconnect = connectedSites.find( ( site ) => site.id === siteId );
				if ( ! siteToDisconnect ) {
					throw new Error( 'Site not found' );
				}

				const sitesToDisconnect = [ siteId, ...siteToDisconnect.stagingSiteIds ];
				const newDisconnectedSites = await getIpcApi().disconnectWpcomSite(
					sitesToDisconnect,
					localSiteId
				);

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
	} as const;
};
