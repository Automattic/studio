import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';

interface SiteDetailsContext {
	data: SiteDetails[];
	createSite: ( path: string ) => Promise< void >;
	startServer: ( id: string ) => Promise< void >;
	stopServer: ( id: string ) => Promise< void >;
}

const siteDetailsContext = createContext< SiteDetailsContext >( {
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

export function SiteDetailsProvider( { children }: SiteDetailsProviderProps ) {
	const { Provider } = siteDetailsContext;

	const [ data, setData ] = useState< SiteDetails[] >( [] );

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
			data,
			createSite,
			startServer,
			stopServer,
		} ),
		[ data ]
	);

	return <Provider value={ context }>{ children }</Provider>;
}
