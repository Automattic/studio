import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useDeleteSnapshot } from './use-delete-snapshot';

export interface DeleteSiteErrorResponse {
	error: string;
	status: number;
	statusCode: number;
	name: string;
	message: string;
}

interface SiteDetailsContext {
	selectedSite: SiteDetails | null;
	updateSite: ( site: SiteDetails ) => Promise< void >;
	data: SiteDetails[];
	snapshots: Snapshot[];
	addSnapshot: ( snapshot: Snapshot ) => void;
	updateSnapshot: ( snapshot: Partial< Snapshot > ) => void;
	removeSnapshot: ( snapshot: Pick< Snapshot, 'atomicSiteId' > ) => void;
	setSelectedSiteId: ( selectedSiteId: string ) => void;
	createSite: ( path: string, siteName?: string ) => Promise< void >;
	startServer: ( id: string ) => Promise< void >;
	stopServer: ( id: string ) => Promise< void >;
	stopAllRunningSites: () => Promise< void >;
	deleteSite: ( id: string, removeLocal: boolean ) => Promise< void >;
	loading: boolean;
	loadingSites: boolean;
	isDeleting: boolean;
	deleteError: string;
	uploadingSites: { [ siteId: string ]: boolean };
	setUploadingSites: React.Dispatch< React.SetStateAction< { [ siteId: string ]: boolean } > >;
}

export const siteDetailsContext = createContext< SiteDetailsContext >( {
	selectedSite: null,
	data: [],
	snapshots: [],
	updateSite: async () => undefined,
	addSnapshot: () => undefined,
	updateSnapshot: () => undefined,
	removeSnapshot: () => undefined,
	setSelectedSiteId: () => undefined,
	createSite: async () => undefined,
	startServer: async () => undefined,
	stopServer: async () => undefined,
	stopAllRunningSites: async () => undefined,
	deleteSite: async () => undefined,
	isDeleting: false,
	deleteError: '',
	loading: false,
	loadingSites: true,
	uploadingSites: {},
	setUploadingSites: () => undefined,
} );

interface SiteDetailsProviderProps {
	children?: React.ReactNode;
}

export function useSiteDetails() {
	return useContext( siteDetailsContext );
}

function useSelectedSite( firstSiteId: string | null ) {
	const SELECTED_SITE_ID_KEY = 'selectedSiteId';
	const selectedSiteIdFromLocal = localStorage.getItem( SELECTED_SITE_ID_KEY ) || null;
	const [ selectedSiteId, setSelectedSiteId ] = useState< string | null >(
		selectedSiteIdFromLocal
	);
	return {
		selectedSiteId: selectedSiteId || firstSiteId,
		setSelectedSiteId: ( id: string ) => {
			setSelectedSiteId( id );
			localStorage.setItem( SELECTED_SITE_ID_KEY, id );
		},
	};
}

function useSnapshots() {
	const [ initiated, setInitiated ] = useState( false );
	const [ snapshots, setSnapshots ] = useState< Snapshot[] >( [] );

	// Load snapshots from storage
	useEffect( () => {
		getIpcApi()
			.getSnapshots()
			.then( ( snapshots ) => {
				setSnapshots( snapshots );
				setInitiated( true );
			} );
	}, [] );

	// Save snapshots to storage when they change
	useEffect( () => {
		if ( ! initiated ) {
			return;
		}
		getIpcApi().saveSnapshotsToStorage( snapshots );
	}, [ snapshots, initiated ] );

	const addSnapshot = useCallback( ( snapshot: Snapshot ) => {
		setSnapshots( ( _snapshots ) => [ snapshot, ..._snapshots ] );
	}, [] );

	const updateSnapshot = useCallback( ( snapshot: Partial< Snapshot > ) => {
		setSnapshots( ( snapshots ) => {
			const index = snapshots.findIndex(
				( snapshotI ) => snapshotI.atomicSiteId === snapshot.atomicSiteId
			);
			if ( index === -1 ) {
				return snapshots;
			}
			const newSnapshots = [ ...snapshots ];
			newSnapshots[ index ] = { ...snapshots[ index ], ...snapshot };
			return newSnapshots;
		} );
	}, [] );

	const removeSnapshot = useCallback(
		( snapshot: Pick< Snapshot, 'atomicSiteId' > ) =>
			setSnapshots( ( _snapshots ) =>
				_snapshots.filter( ( snapshotI ) => snapshotI.atomicSiteId !== snapshot.atomicSiteId )
			),
		[]
	);

	return {
		snapshots,
		addSnapshot,
		updateSnapshot,
		removeSnapshot,
	};
}

function useDeleteSite() {
	const [ isLoading, setIsLoading ] = useState< Record< string, boolean > >( {} );
	const [ error, setError ] = useState< Record< string, string > >( {} );
	const { deleteSnapshot } = useDeleteSnapshot( { displayAlert: false } );

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
				snapshots.map( ( snapshot ) => deleteSnapshot( snapshot ) )
			);

			try {
				setError( ( errors ) => ( { ...errors, [ siteId ]: '' } ) );
				setIsLoading( ( loading ) => ( { ...loading, [ siteId ]: true } ) );
				const newSites = await getIpcApi().deleteSite( siteId, removeLocal );
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
		[ deleteSnapshot ]
	);
	return { deleteSite, isLoading, error };
}

export function SiteDetailsProvider( { children }: SiteDetailsProviderProps ) {
	const { Provider } = siteDetailsContext;

	const [ data, setData ] = useState< SiteDetails[] >( [] );
	const [ loading, setLoading ] = useState( false );
	const [ loadingSites, setLoadingSites ] = useState< boolean >( true );
	const firstSite = data[ 0 ] || null;
	const { selectedSiteId, setSelectedSiteId } = useSelectedSite( firstSite?.id );
	const { snapshots, addSnapshot, removeSnapshot, updateSnapshot } = useSnapshots();
	const { deleteSite, isLoading: isDeleting, error: deleteError } = useDeleteSite();
	const [ uploadingSites, setUploadingSites ] = useState< SiteDetailsContext[ 'uploadingSites' ] >(
		{}
	);

	useEffect( () => {
		let cancel = false;
		setLoadingSites( true );
		getIpcApi()
			.getSiteDetails()
			.then( ( data ) => {
				if ( ! cancel ) {
					setData( data );
					setLoadingSites( false );
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
				setData( newSites );
				setSelectedSiteId( newSites[ 0 ].id );
			}
		},
		[ deleteSite, setSelectedSiteId, snapshots ]
	);

	const createSite = useCallback(
		async ( path: string, siteName?: string ) => {
			const data = await getIpcApi().createSite( path, siteName );
			setData( data );
			const newSite = data.find( ( site ) => site.path === path );
			if ( newSite?.id ) {
				setSelectedSiteId( newSite.id );
			}
		},
		[ setSelectedSiteId ]
	);

	const updateSite = useCallback( async ( site: SiteDetails ) => {
		const updatedSites = await getIpcApi().updateSite( site );
		setData( updatedSites );
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

	const stopAllRunningSites = useCallback( async () => {
		const runningSites = data.filter( ( site ) => site.running );
		for ( const site of runningSites ) {
			await getIpcApi().stopServer( site.id );
		}
		setData( data.map( ( site ) => ( site.running ? { ...site, running: false } : site ) ) );
	}, [ data ] );

	const context = useMemo(
		() => ( {
			selectedSite: data.find( ( site ) => site.id === selectedSiteId ) || firstSite,
			data,
			snapshots,
			addSnapshot,
			updateSnapshot,
			removeSnapshot,
			setSelectedSiteId,
			createSite,
			updateSite,
			startServer,
			stopServer,
			stopAllRunningSites,
			loading,
			deleteSite: onDeleteSite,
			isDeleting: selectedSiteId ? isDeleting[ selectedSiteId ] : false,
			deleteError: selectedSiteId ? deleteError[ selectedSiteId ] : '',
			loadingSites,
			uploadingSites,
			setUploadingSites,
		} ),
		[
			data,
			firstSite,
			snapshots,
			addSnapshot,
			updateSnapshot,
			onDeleteSite,
			isDeleting,
			deleteError,
			removeSnapshot,
			setSelectedSiteId,
			createSite,
			updateSite,
			startServer,
			stopServer,
			stopAllRunningSites,
			loading,
			loadingSites,
			selectedSiteId,
			uploadingSites,
			setUploadingSites,
		]
	);

	return <Provider value={ context }>{ children }</Provider>;
}
