import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';

interface SiteDetailsContext {
	selectedSite: SiteDetails | null;
	setSelectedSiteId: ( selectedSiteId: string ) => void;
	data: SiteDetails[];
	createSite: ( path: string ) => Promise< void >;
	startServer: ( id: string ) => Promise< void >;
	stopServer: ( id: string ) => Promise< void >;
}

const siteDetailsContext = createContext< SiteDetailsContext >( {
	selectedSite: null,
	setSelectedSiteId: () => undefined,
	data: [],
	createSite: async () => undefined,
	startServer: async () => undefined,
	stopServer: async () => undefined,
} );

interface SiteDetailsProviderProps {
	children?: React.ReactNode;
}

export function useSiteDetails() {
	return useContext( siteDetailsContext );
}

function useSelectedSite() {
	const SELECTED_SITE_ID_KEY = 'selectedSiteId';
	const selectedSiteIdFromLocal = localStorage.getItem( SELECTED_SITE_ID_KEY ) || null;
	const [ selectedSiteId, setSelectedSiteId ] = useState< string | null >(
		selectedSiteIdFromLocal
	);

	return {
		selectedSiteId,
		setSelectedSiteId: ( id: string ) => {
			setSelectedSiteId( id );
			localStorage.setItem( SELECTED_SITE_ID_KEY, id );
		},
	};
}

export function SiteDetailsProvider( { children }: SiteDetailsProviderProps ) {
	const { Provider } = siteDetailsContext;

	const [ data, setData ] = useState< SiteDetails[] >( [] );
	const { selectedSiteId, setSelectedSiteId } = useSelectedSite();

	useEffect( () => {
		let cancel = false;
		getIpcApi()
			.getSiteDetails()
			.then( ( data ) => {
				if ( ! cancel ) {
					setData( data );
				}
			} );

		return () => {
			cancel = true;
		};
	}, [] );

	const createSite = useCallback( async ( path: string ) => {
		const data = await getIpcApi().createSite( path );
		setData( data );
		const newSite = data.find( ( site ) => site.path === path );
		if ( newSite?.id ) {
			setSelectedSiteId( newSite.id );
		}
	}, [] );

	const startServer = useCallback(
		async ( id: string ) => {
			const updatedSite = await getIpcApi().startServer( id );
			if ( updatedSite ) {
				const newData = data.map( ( site ) => ( site.id === id ? updatedSite : site ) );
				setData( newData );
			}
		},
		[ data ]
	);

	const stopServer = useCallback(
		async ( id: string ) => {
			const updatedSite = await getIpcApi().stopServer( id );
			if ( updatedSite ) {
				const newData = data.map( ( site ) => ( site.id === id ? updatedSite : site ) );
				setData( newData );
			}
		},
		[ data ]
	);

	const context = useMemo(
		() => ( {
			selectedSite: data.find( ( site ) => site.id === selectedSiteId ) || null,
			setSelectedSiteId,
			data,
			createSite,
			startServer,
			stopServer,
		} ),
		[ data, setSelectedSiteId ]
	);

	return <Provider value={ context }>{ children }</Provider>;
}
