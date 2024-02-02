import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';

interface SiteDetailsContext {
	selectedSite: SiteDetails | null;
	data: SiteDetails[];
	snapshots: Snapshot[];
	addSnapshot: ( snapshot: Snapshot ) => void;
	removeSnapshot: ( snapshot: Snapshot ) => void;
	setSelectedSiteId: ( selectedSiteId: string ) => void;
	createSite: ( path: string ) => Promise< void >;
	startServer: ( id: string ) => Promise< void >;
	stopServer: ( id: string ) => Promise< void >;
	loading: boolean;
}

const siteDetailsContext = createContext< SiteDetailsContext >( {
	selectedSite: null,
	data: [],
	snapshots: [],
	addSnapshot: () => undefined,
	removeSnapshot: () => undefined,
	setSelectedSiteId: () => undefined,
	createSite: async () => undefined,
	startServer: async () => undefined,
	stopServer: async () => undefined,
	loading: false,
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

function useSnapshots() {
	const [ snapshots, setSnapshots ] = useState< Snapshot[] >( [] );
	const addSnapshot = useCallback(
		( snapshot: Snapshot ) => setSnapshots( ( snapshots ) => [ ...snapshots, snapshot ] ),
		[]
	);
	const removeSnapshot = useCallback(
		( snapshot: Snapshot ) =>
			setSnapshots( ( snapshots ) =>
				snapshots.filter( ( snapshotI ) => snapshotI.atomicSiteId !== snapshot.atomicSiteId )
			),
		[]
	);
	return {
		snapshots,
		addSnapshot,
		removeSnapshot,
	};
}

export function SiteDetailsProvider( { children }: SiteDetailsProviderProps ) {
	const { Provider } = siteDetailsContext;

	const [ data, setData ] = useState< SiteDetails[] >( [] );
	const [ loading, setLoading ] = useState( false );
	const { selectedSiteId, setSelectedSiteId } = useSelectedSite();
	const { snapshots, addSnapshot, removeSnapshot } = useSnapshots();

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
			if ( selectedSiteId === id ) {
				setLoading( true );
			}
			const updatedSite = await getIpcApi().startServer( id );
			if ( updatedSite ) {
				const newData = data.map( ( site ) => ( site.id === id ? updatedSite : site ) );
				setData( newData );
			}
			if ( selectedSiteId === id ) {
				setLoading( false );
			}
		},
		[ data, selectedSiteId ]
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
			data,
			snapshots,
			addSnapshot,
			removeSnapshot,
			setSelectedSiteId,
			createSite,
			startServer,
			stopServer,
			loading,
		} ),
		[ data, setSelectedSiteId, loading ]
	);

	return <Provider value={ context }>{ children }</Provider>;
}
