import { useState, useEffect, useCallback } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useAuth } from './use-auth';
import { SyncSite, useFetchWpComSites } from './use-fetch-wpcom-sites';
import { useSiteDetails } from './use-site-details';

const useSiteSyncManagement = () => {
	const [ connectedSites, setConnectedSites ] = useState< SyncSite[] >( [] );
	const { isAuthenticated } = useAuth();
	const { syncSites } = useFetchWpComSites( connectedSites );
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
	}, [ localSiteId ] );

	useEffect( () => {
		if ( isAuthenticated ) {
			loadConnectedSites();
		}
	}, [ isAuthenticated, loadConnectedSites ] );

	const connectSite = useCallback(
		async ( site: SyncSite ) => {
			if ( ! localSiteId ) {
				return;
			}
			try {
				const stagingSites = site.stagingSiteIds
					.map( ( id ) => syncSites?.find( ( s ) => s.id === id ) )
					.filter( ( s ): s is SyncSite => s !== undefined );

				const newConnectedSites = await getIpcApi().connectWpcomSite(
					site,
					localSiteId,
					stagingSites
				);
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
	} as const;
};

export { useSiteSyncManagement };
