import { useEffect, useCallback } from 'react';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useAuth } from '../use-auth';
import { FetchSites, useFetchWpComSites } from '../use-fetch-wpcom-sites';
import { useSiteDetails } from '../use-site-details';
import type { SyncSite } from '../use-fetch-wpcom-sites/types';

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
	const { syncSites, isFetching, refetchSites } = useFetchWpComSites(
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
	}, [ isAuthenticated, syncSites, loadConnectedSites ] );

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
