import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getIpcApi } from '../get-ipc-api';

interface SiteDetailsContext {
	data: SiteDetails[] | undefined;
	createSite: ( path: string ) => Promise< void >;
}

const siteDetailsContext = createContext< SiteDetailsContext >( {
	data: undefined,
	createSite: async () => undefined,
} );

interface SiteDetailsProviderProps {
	children?: React.ReactNode;
}

export function useSiteDetails() {
	return useContext( siteDetailsContext );
}

export function SiteDetailsProvider( { children }: SiteDetailsProviderProps ) {
	const { Provider } = siteDetailsContext;

	const [ data, setData ] = useState< SiteDetails[] | undefined >( undefined );

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

	const context = useMemo(
		() => ( {
			data,
			createSite,
		} ),
		[ data ]
	);

	return <Provider value={ context }>{ children }</Provider>;
}
