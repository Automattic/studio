import { useState, useEffect, useCallback } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useAuth } from './use-auth';
import { useSiteDetails } from './use-site-details';

export type SyncSupport = 'unsupported' | 'syncable' | 'needs-transfer' | 'already-connected';

export interface SyncSite {
	id: number;
	localSiteId?: string;
	name: string;
	url: string;
	isStaging: boolean;
	stagingSiteIds: number[];
	syncSupport: SyncSupport;
}

const FAKE_SITES: SyncSite[] = [
	{
		id: 1,
		name: 'My First Site',
		url: 'https://developer.wordpress.com',
		isStaging: false,
		stagingSiteIds: [],
		syncSupport: 'syncable',
	},
	{
		id: 2,
		name: 'My Blog',
		url: 'https://developer.wordpress.com',
		isStaging: false,
		stagingSiteIds: [],
		syncSupport: 'unsupported',
	},
	{
		id: 3,
		name: 'My Project',
		url: 'https://developer.wordpress.com',
		isStaging: false,
		stagingSiteIds: [ 4 ],
		syncSupport: 'syncable',
	},
	{
		id: 4,
		name: 'My Project',
		url: 'https:/developer.wordpress.com/studio/',
		isStaging: true,
		stagingSiteIds: [],
		syncSupport: 'syncable',
	},
	{
		id: 5,
		name: 'My Project Site with a suuuuuuper long long long name that should appear in multiple lines with a nice padding on the side, so it keeps being readable',
		url: 'https:/developer.wordpress.com/studio/',
		isStaging: false,
		stagingSiteIds: [],
		syncSupport: 'syncable',
	},
	{
		id: 6,
		name: 'My simple business site that needs a transfer',
		url: 'https:/developer.wordpress.com/studio/',
		isStaging: false,
		stagingSiteIds: [],
		syncSupport: 'needs-transfer',
	},
	...Array.from( { length: 10 }, ( _, index ) => ( {
		id: index + 7,
		name: `My Pro site ${ index + 7 }`,
		url: `https://developer.wordpress.com/`,
		isStaging: false,
		stagingSiteIds: [],
		syncSupport: 'syncable' as SyncSupport,
	} ) ),
];

const useSyncSites = () => {
	const [ syncSites, setSyncSites ] = useState< SyncSite[] >( [] );
	const [ connectedSites, setConnectedSites ] = useState< SyncSite[] >( [] );
	const { isAuthenticated } = useAuth();
	const { selectedSite } = useSiteDetails();
	const localSiteId = selectedSite?.id;

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

	const connectSite = async ( site: SyncSite ) => {
		if ( ! localSiteId ) {
			return;
		}
		try {
			await getIpcApi().connectWpcomSite( site, localSiteId );
			setConnectedSites( ( prevSites ) => [ ...prevSites, site ] );
		} catch ( error ) {
			console.error( 'Failed to connect site:', error );
			throw error;
		}
	};

	useEffect( () => {
		setSyncSites( FAKE_SITES );
		loadConnectedSites();
	}, [ isAuthenticated, loadConnectedSites ] );

	const isSiteAlreadyConnected = ( siteId: number ) =>
		connectedSites.some( ( site ) => site.id === siteId );

	return {
		syncSites: syncSites.map( ( site ) => ( {
			...site,
			syncSupport: isSiteAlreadyConnected( site.id ) ? 'already-connected' : site.syncSupport,
		} ) ),
		connectedSites,
		connectSite,
	};
};

export { useSyncSites };
