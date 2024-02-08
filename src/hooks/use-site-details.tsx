import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useAuth } from './use-auth';

export interface DeleteSiteErrorResponse {
	error: string;
	status: number;
	statusCode: number;
	name: string;
	message: string;
}

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
	deleteSite: ( id: string, removeLocal: boolean ) => Promise< void >;
	loading: boolean;
	isDeleting: boolean;
	deleteError: string;
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
	deleteSite: async () => undefined,
	isDeleting: false,
	deleteError: '',
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

function useDeleteSite() {
	const [ isLoading, setIsLoading ] = useState< Record< string, boolean > >( {} );
	const [ error, setError ] = useState< Record< string, string > >( {} );
	const { client } = useAuth();

	const deleteSite = useCallback(
		async (
			siteId: string,
			removeLocal: boolean,
			snapshots: Snapshot[]
		): Promise< SiteDetails[] | undefined > => {
			if ( ! siteId ) {
				return;
			}
			const allSiteRemovePromises = Promise.allSettled(
				snapshots.map( ( snapshot ) => {
					return client.req.post( {
						path: '/jurassic-ninja/delete',
						apiNamespace: 'wpcom/v2',
						body: { site_id: snapshot.atomicSiteId },
					} );
				} )
			);

			try {
				setError( ( errors ) => ( { ...errors, [ siteId ]: '' } ) );
				setIsLoading( ( loading ) => ( { ...loading, [ siteId ]: true } ) );
				const newSites = await getIpcApi().deleteSite( siteId, removeLocal );
				// Don't put extra effort into handling per snapshot deletion failure.
				// They will expire and be removed, eventually, in case any of them failed.
				await allSiteRemovePromises;
				return newSites;
			} catch ( error ) {
				const newError = new Error( 'Failed to delete local files' );
				setError( ( errors ) => ( { ...errors, [ siteId ]: newError.message } ) );
				throw newError;
			} finally {
				setIsLoading( ( loading ) => ( { ...loading, [ siteId ]: false } ) );
			}
		},
		[ client ]
	);
	return { deleteSite, isLoading, error };
}

export function SiteDetailsProvider( { children }: SiteDetailsProviderProps ) {
	const { Provider } = siteDetailsContext;

	const [ data, setData ] = useState< SiteDetails[] >( [] );
	const [ loading, setLoading ] = useState( false );
	const { selectedSiteId, setSelectedSiteId } = useSelectedSite();
	const { snapshots, addSnapshot, removeSnapshot } = useSnapshots();
	const { deleteSite, isLoading: isDeleting, error: deleteError } = useDeleteSite();

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

	const onDeleteSite = useCallback(
		async ( id: string, removeLocal: boolean ) => {
			const siteSnapshots = snapshots.filter( ( snapshot ) => snapshot.localSiteId === id );
			const newSites = await deleteSite( id, removeLocal, siteSnapshots );
			if ( newSites ) {
				siteSnapshots.forEach( removeSnapshot );
				setData( newSites );
				setSelectedSiteId( newSites[ 0 ].id );
			}
		},
		[ deleteSite, removeSnapshot, setSelectedSiteId, snapshots ]
	);

	const createSite = useCallback(
		async ( path: string ) => {
			const data = await getIpcApi().createSite( path );
			setData( data );
			const newSite = data.find( ( site ) => site.path === path );
			if ( newSite?.id ) {
				setSelectedSiteId( newSite.id );
			}
		},
		[ setSelectedSiteId ]
	);

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
			deleteSite: onDeleteSite,
			isDeleting: selectedSiteId ? isDeleting[ selectedSiteId ] : false,
			deleteError: selectedSiteId ? deleteError[ selectedSiteId ] : '',
		} ),
		[
			data,
			snapshots,
			addSnapshot,
			onDeleteSite,
			isDeleting,
			deleteError,
			removeSnapshot,
			setSelectedSiteId,
			createSite,
			startServer,
			stopServer,
			loading,
			selectedSiteId,
		]
	);

	return <Provider value={ context }>{ children }</Provider>;
}
