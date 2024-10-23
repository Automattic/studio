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

	// Fetch connected sites
	const loadConnectedSites = useCallback( async () => {
		if ( ! localSiteId ) {
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

	// Connect a site
	const connectSite = async ( site: SyncSite ) => {
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
			// Add any additional logic for connectSite
		} catch ( error ) {
			console.error( 'Failed to connect site:', error );
			throw error;
		}
	};

	// Disconnect a site
	const disconnectSite = async ( siteId: number ) => {
		if ( ! localSiteId ) {
			return;
		}
		try {
			const newDisconnectedSites = await getIpcApi().disconnectWpcomSite( siteId, localSiteId );
			setConnectedSites( newDisconnectedSites );
		} catch ( error ) {
			console.error( 'Failed to disconnect site:', error );
			throw error;
		}
	};

	// Check if a site is already connected
	const isSiteAlreadyConnected = ( siteId: number ) => {
		return connectedSites.some( ( site ) => site.id === siteId );
	};

	return {
		connectedSites,
		loadConnectedSites,
		connectSite,
		disconnectSite,
		isSiteAlreadyConnected,
	};
};

export { useSiteSyncManagement };
