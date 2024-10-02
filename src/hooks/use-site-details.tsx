import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import {
	ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { sortSites } from '../lib/sort-sites';
import { useSnapshots } from './use-snapshots';

interface SiteDetailsContext {
	selectedSite: SiteDetails | null;
	updateSite: ( site: SiteDetails ) => Promise< void >;
	data: SiteDetails[];
	setSelectedSiteId: ( selectedSiteId: string ) => void;
	createSite: (
		path: string,
		siteName?: string,
		callback?: ( site: SiteDetails | void ) => Promise< void >
	) => Promise< SiteDetails | void >;
	startServer: ( id: string ) => Promise< void >;
	stopServer: ( id: string ) => Promise< void >;
	stopAllRunningSites: () => Promise< void >;
	deleteSite: ( id: string, removeLocal: boolean ) => Promise< void >;
	loadingServer: Record< string, boolean >;
	loadingSites: boolean;
	isDeleting: boolean;
	uploadingSites: { [ siteId: string ]: boolean };
	setUploadingSites: React.Dispatch< React.SetStateAction< { [ siteId: string ]: boolean } > >;
}

export const siteDetailsContext = createContext< SiteDetailsContext >( {
	selectedSite: null,
	data: [],
	updateSite: async () => undefined,
	setSelectedSiteId: () => undefined,
	createSite: async () => undefined,
	startServer: async () => undefined,
	stopServer: async () => undefined,
	stopAllRunningSites: async () => undefined,
	deleteSite: async () => undefined,
	isDeleting: false,
	loadingServer: {},
	loadingSites: true,
	uploadingSites: {},
	setUploadingSites: () => undefined,
} );

interface SiteDetailsProviderProps {
	children?: ReactNode;
}

export function useSiteDetails() {
	const context = useContext( siteDetailsContext );
	if ( ! context ) {
		throw new Error( 'useSiteDetails must be used within a SiteDetailsProvider' );
	}
	return context;
}

function useSelectedSite( firstSiteId: string | null ) {
	const SELECTED_SITE_ID_KEY = 'selectedSiteId';
	const selectedSiteIdFromLocal = localStorage.getItem( SELECTED_SITE_ID_KEY ) || null;
	const [ selectedSiteId, setSelectedSiteId ] = useState< string | null >(
		selectedSiteIdFromLocal
	);
	useEffect( () => {
		if ( selectedSiteId ) {
			localStorage.setItem( SELECTED_SITE_ID_KEY, selectedSiteId );
		}
	} );

	return {
		selectedSiteId: selectedSiteId || firstSiteId,
		setSelectedSiteId,
	};
}

function useDeleteSite() {
	const [ isLoading, setIsLoading ] = useState< Record< string, boolean > >( {} );
	const { deleteSnapshot, snapshots } = useSnapshots();

	const deleteSite = useCallback(
		async ( siteId: string, removeLocal: boolean ): Promise< SiteDetails[] | undefined > => {
			const siteSnapshots = snapshots.filter( ( snapshot ) => snapshot.localSiteId === siteId );

			if ( ! siteId ) {
				return;
			}
			const allSiteRemovePromises = Promise.allSettled(
				siteSnapshots.map( ( snapshot ) => deleteSnapshot( snapshot, removeLocal ) )
			);

			try {
				setIsLoading( ( loading ) => ( { ...loading, [ siteId ]: true } ) );
				const newSites = await getIpcApi().deleteSite( siteId, removeLocal );
				await allSiteRemovePromises;
				return newSites;
			} finally {
				setIsLoading( ( loading ) => ( { ...loading, [ siteId ]: false } ) );
			}
		},
		[ deleteSnapshot, snapshots ]
	);
	return { deleteSite, isLoading };
}

export function SiteDetailsProvider( { children }: SiteDetailsProviderProps ) {
	const { Provider } = siteDetailsContext;

	const [ data, setData ] = useState< SiteDetails[] >( [] );
	const [ loadingSites, setLoadingSites ] = useState< boolean >( true );
	const firstSite = data[ 0 ] || null;
	const [ loadingServer, setLoadingServer ] = useState< Record< string, boolean > >(
		firstSite?.id
			? {
					[ firstSite?.id ]: true,
			  }
			: {}
	);
	const { selectedSiteId, setSelectedSiteId } = useSelectedSite( firstSite?.id );
	const [ uploadingSites, setUploadingSites ] = useState< { [ siteId: string ]: boolean } >( {} );
	const { deleteSite, isLoading: isDeleting } = useDeleteSite();

	const toggleLoadingServerForSite = useCallback( ( siteId: string ) => {
		setLoadingServer( ( currentLoading ) => ( {
			...currentLoading,
			[ siteId ]: ! currentLoading[ siteId ] || false,
		} ) );
	}, [] );

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
			const newSites = await deleteSite( id, removeLocal );
			if ( newSites ) {
				setData( newSites );
				const selectedSite = newSites.length ? newSites[ 0 ].id : '';
				setSelectedSiteId( selectedSite );
			}
		},
		[ deleteSite, setSelectedSiteId ]
	);

	const createSite = useCallback(
		async (
			path: string,
			siteName?: string,
			callback?: ( site: SiteDetails | void ) => Promise< void >
		) => {
			// Function to handle error messages and cleanup
			const showError = ( error?: unknown ) => {
				console.error( 'Failed to create site' );
				getIpcApi().showErrorMessageBox( {
					title: __( 'Failed to create site' ),
					message: __(
						'An error occurred while creating the site. Verify your selected local path is an empty directory or an existing WordPress folder and try again. If this problem persists, please contact support.'
					),
					error,
				} );

				// Remove the temporary site immediately, but with a minor delay to ensure state updates properly
				setTimeout( () => {
					setData( ( prevData ) =>
						sortSites( prevData.filter( ( site ) => site.id !== tempSiteId ) )
					);
				}, 2000 );
			};

			const tempSiteId = crypto.randomUUID();
			setData( ( prevData ) =>
				sortSites( [
					...prevData,
					{
						id: tempSiteId,
						name: siteName || path,
						path,
						running: false,
						isAddingSite: true,
						phpVersion: '',
					},
				] )
			);
			setSelectedSiteId( tempSiteId ); // Set the temporary ID as the selected site

			try {
				const data = await getIpcApi().createSite( path, siteName );
				const newSite = data.find( ( site ) => site.path === path );
				if ( ! newSite ) {
					showError();
					return;
				}
				// Update the selected site to the new site's ID if the user didn't change it
				setSelectedSiteId( ( prevSelectedSiteId ) => {
					if ( prevSelectedSiteId === tempSiteId ) {
						return newSite.id;
					}
					return prevSelectedSiteId;
				} );
				// It replaces the temporary site created in React
				// with the new site generated in the backend, but keeps isAddingSite to true
				newSite.isAddingSite = true;
				setData( ( prevData ) =>
					prevData.map( ( site ) => ( site.id === tempSiteId ? newSite : site ) )
				);

				if ( callback ) {
					await callback( newSite );
				}

				setData( ( prevData ) =>
					prevData.map( ( site ) =>
						site.id === newSite.id ? { ...site, isAddingSite: false } : site
					)
				);

				return newSite;
			} catch ( error ) {
				showError( error );
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
			toggleLoadingServerForSite( id );
			let updatedSite: SiteDetails | null = null;

			try {
				updatedSite = await getIpcApi().startServer( id );
			} catch ( error ) {
				Sentry.captureException( error );
				getIpcApi().showErrorMessageBox( {
					title: __( 'Failed to start the site server' ),
					message: __(
						"Please verify your site's local path directory contains the standard WordPress installation files and try again. If this problem persists, please contact support."
					),
					error,
				} );
				getIpcApi().stopServer( id );
			}

			if ( updatedSite ) {
				setData( ( prevData ) =>
					prevData.map( ( site ) =>
						site.id === id && updatedSite ? { ...site, ...updatedSite } : site
					)
				);
			}

			toggleLoadingServerForSite( id );
		},
		[ toggleLoadingServerForSite ]
	);

	const stopServer = useCallback(
		async ( id: string ) => {
			toggleLoadingServerForSite( id );
			const updatedSite = await getIpcApi().stopServer( id );
			if ( updatedSite ) {
				setData( ( prevData ) =>
					prevData.map( ( site ) => ( site.id === id ? { ...site, ...updatedSite } : site ) )
				);
			}
			toggleLoadingServerForSite( id );
		},
		[ toggleLoadingServerForSite ]
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
			setSelectedSiteId,
			createSite,
			updateSite,
			startServer,
			stopServer,
			stopAllRunningSites,
			loadingServer,
			deleteSite: onDeleteSite,
			isDeleting: selectedSiteId ? isDeleting[ selectedSiteId ] : false,
			loadingSites,
			uploadingSites,
			setUploadingSites,
		} ),
		[
			data,
			firstSite,
			setSelectedSiteId,
			createSite,
			updateSite,
			startServer,
			stopServer,
			stopAllRunningSites,
			loadingServer,
			onDeleteSite,
			selectedSiteId,
			isDeleting,
			loadingSites,
			uploadingSites,
		]
	);

	return <Provider value={ context }>{ children }</Provider>;
}
