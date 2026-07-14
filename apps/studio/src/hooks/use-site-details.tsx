import { SITE_EVENTS, SiteEvent } from '@studio/common/lib/cli-events';
import { sortSites } from '@studio/common/lib/sort-sites';
import { __, sprintf } from '@wordpress/i18n';
import {
	ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { simplifyErrorForDisplay, simplifyErrorToFirstSentence } from 'src/lib/error-formatting';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { Blueprint } from 'src/stores/wpcom-api';

interface SiteDetailsContext {
	selectedSite: SiteDetails | null;
	updateSite: ( site: SiteDetails, wpVersion?: string ) => Promise< void >;
	updateSitesSortOrder: ( sites: SiteDetails[] ) => Promise< void >;
	sites: SiteDetails[];
	setSelectedSiteId: ( selectedSiteId: string ) => void;
	createSite: (
		path: string,
		siteName?: string,
		wpVersion?: string,
		customDomain?: string,
		enableHttps?: boolean,
		blueprint?: Blueprint,
		phpVersion?: string,
		callback?: ( site: SiteDetails ) => Promise< void >,
		noStart?: boolean,
		adminUsername?: string,
		adminPassword?: string,
		adminEmail?: string,
		runtime?: SiteRuntime,
		fileAccess?: SiteFileAccess
	) => Promise< SiteDetails | void >;
	copySite: ( sourceSiteId: string ) => Promise< SiteDetails | void >;
	startServer: (
		site: SiteDetails,
		options?: { suppressCapacityModal?: boolean }
	) => Promise< { capacityLimitReached: boolean } >;
	startServers: ( sites: SiteDetails[] ) => Promise< void >;
	stopServer: ( id: string ) => Promise< void >;
	stopAllRunningSites: () => Promise< void >;
	startAllStoppedSites: () => Promise< void >;
	deleteSite: ( id: string, removeLocal: boolean ) => Promise< void >;
	loadingServer: Record< string, boolean >;
	loadingSites: boolean;
	isDeleting: boolean;
	isSiteDeleting: ( siteId: string ) => boolean;
	uploadingSites: { [ siteId: string ]: boolean };
	setUploadingSites: React.Dispatch< React.SetStateAction< { [ siteId: string ]: boolean } > >;
	isEditModalOpen: boolean;
	setIsEditModalOpen: React.Dispatch< React.SetStateAction< boolean > >;
	editModalInitialTab: string;
	setEditModalInitialTab: React.Dispatch< React.SetStateAction< string > >;
	siteCreationMessages: { [ siteId: string ]: string };
}

const defaultContext: SiteDetailsContext = {
	selectedSite: null,
	updateSite: async () => undefined,
	updateSitesSortOrder: async () => undefined,
	sites: [],
	siteCreationMessages: {},
	setSelectedSiteId: () => undefined,
	createSite: async () => undefined,
	copySite: async () => undefined,
	startServer: async () => ( { capacityLimitReached: false } ),
	startServers: async () => undefined,
	stopServer: async () => undefined,
	stopAllRunningSites: async () => undefined,
	startAllStoppedSites: async () => undefined,
	deleteSite: async () => undefined,
	loadingServer: {},
	loadingSites: true,
	isDeleting: false,
	isSiteDeleting: () => false,
	uploadingSites: {},
	setUploadingSites: () => undefined,
	isEditModalOpen: false,
	setIsEditModalOpen: () => undefined,
	editModalInitialTab: 'general',
	setEditModalInitialTab: () => undefined,
};

export const siteDetailsContext = createContext< SiteDetailsContext >( defaultContext );

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

export function SiteDetailsProvider( { children }: SiteDetailsProviderProps ) {
	const { Provider } = siteDetailsContext;

	const [ sites, setSites ] = useState< SiteDetails[] >( [] );
	const [ loadingSites, setLoadingSites ] = useState< boolean >( true );
	const [ siteCreationMessages, setSiteCreationMessages ] = useState< {
		[ siteId: string ]: string;
	} >( {} );
	const firstSite = sites[ 0 ] || null;
	const [ loadingServer, setLoadingServer ] = useState< Record< string, boolean > >(
		firstSite?.id
			? {
					[ firstSite?.id ]: true,
			  }
			: {}
	);
	const { selectedSiteId, setSelectedSiteId } = useSelectedSite( firstSite?.id );
	const [ uploadingSites, setUploadingSites ] = useState< { [ siteId: string ]: boolean } >( {} );
	const [ isDeleting, setIsDeleting ] = useState< Record< string, boolean > >( {} );
	const { setSelectedTab, selectedTab } = useContentTabs();

	useIpcListener( 'on-site-create-progress', ( _, { siteId, message } ) => {
		if ( siteId && message ) {
			setSiteCreationMessages( ( prev ) => ( {
				...prev,
				[ siteId ]: message,
			} ) );
		}
	} );

	useIpcListener( 'site-event', ( _, event: SiteEvent ) => {
		const { event: eventType, siteId, site, running } = event;

		setSites( ( prevSites ) => {
			if ( eventType === SITE_EVENTS.DELETED ) {
				const newSites = prevSites.filter( ( s ) => s.id !== siteId );
				if ( selectedSiteId === siteId ) {
					setSelectedSiteId( newSites.length ? newSites[ 0 ].id : '' );
				}
				return newSites;
			}

			if ( ! site ) {
				return prevSites;
			}

			const siteDetails: SiteDetails = {
				...site,
				running,
			};

			const existingIndex = prevSites.findIndex( ( s ) => s.id === siteId );

			// Only add new sites on CREATED events to prevent duplicates
			if ( existingIndex < 0 ) {
				if ( eventType === SITE_EVENTS.CREATED ) {
					return sortSites( [ ...prevSites, siteDetails ] );
				}
				return prevSites;
			}

			const newSites = [ ...prevSites ];
			newSites[ existingIndex ] = { ...newSites[ existingIndex ], ...siteDetails };
			return newSites;
		} );

		// Clear loading state atomically with the running state update above so
		// the UI never sees loading=true with a stale running value.
		if ( eventType === SITE_EVENTS.UPDATED ) {
			setLoadingServer( ( prev ) => {
				if ( ! prev[ siteId ] ) {
					return prev;
				}
				const { [ siteId ]: _, ...rest } = prev;
				return rest;
			} );
		}
	} );

	const startLoadingForSite = useCallback( ( siteId: string ) => {
		setLoadingServer( ( prev ) => ( { ...prev, [ siteId ]: true } ) );
	}, [] );

	const clearLoadingForSite = useCallback( ( siteId: string ) => {
		setLoadingServer( ( prev ) => {
			if ( ! prev[ siteId ] ) {
				return prev;
			}
			const { [ siteId ]: _, ...rest } = prev;
			return rest;
		} );
	}, [] );

	const onDeleteSite = useCallback(
		async ( siteId: string, shouldDeleteFiles: boolean ) => {
			if ( ! siteId ) {
				return;
			}

			try {
				setIsDeleting( ( prev ) => ( { ...prev, [ siteId ]: true } ) );

				await getIpcApi().deleteSite( siteId, shouldDeleteFiles );

				// After site is deleted successfully, clean up wpcom connections
				try {
					const connectedSites = await getIpcApi().getConnectedWpcomSites( siteId );
					const connectedSiteIds = connectedSites.map( ( site ) => site.id );
					if ( connectedSiteIds.length > 0 ) {
						await getIpcApi().disconnectWpcomSites( [
							{
								siteIds: connectedSiteIds,
								localSiteId: siteId,
							},
						] );
					}
				} catch ( error ) {
					// If disconnection fails, log but don't fail the deletion
					console.error( 'Failed to disconnect wpcom sites:', error );
				}
			} catch ( error ) {
				console.error( 'Error during site deletion:', error );
				throw error;
			} finally {
				setIsDeleting( ( prev ) => ( { ...prev, [ siteId ]: false } ) );
			}

			// No need to update the `sites` state. That's handled in the `site-event` listener.

			const newSites = await getIpcApi().getSiteDetails();
			setSelectedSiteId( ( currentSelectedId ) => {
				const selectedSiteStillExists = newSites.some( ( site ) => site.id === currentSelectedId );
				if ( ! selectedSiteStillExists ) {
					return newSites.length ? newSites[ 0 ].id : '';
				}
				return currentSelectedId;
			} );
		},
		[ setSelectedSiteId ]
	);

	const createSite = useCallback(
		async (
			path: string,
			siteName?: string,
			wpVersion?: string,
			customDomain?: string,
			enableHttps?: boolean,
			blueprint?: Blueprint,
			phpVersion?: string,
			callback?: ( site: SiteDetails ) => Promise< void >,
			noStart?: boolean,
			adminUsername?: string,
			adminPassword?: string,
			adminEmail?: string,
			runtime?: SiteRuntime,
			fileAccess?: SiteFileAccess
		) => {
			// Function to handle error messages and cleanup
			const showError = ( error?: unknown, hasBlueprint?: boolean ) => {
				console.error( 'Failed to create site' );

				// Check if it's a blueprint-related error
				const errorMessage = error instanceof Error ? error.message : String( error );
				const isBlueprintError =
					errorMessage.includes( 'blueprint' ) ||
					errorMessage.includes( 'PHP.run() failed' ) ||
					errorMessage.includes( 'Could not start server' );

				let title: string;
				let message: string;
				let errorToShow = error;

				if ( isBlueprintError && hasBlueprint ) {
					title = __( 'Blueprint execution failed' );
					message = __(
						'The selected Blueprint failed to execute properly. This could be due to invalid PHP code, missing plugins, or other issues in the Blueprint file. Please check your Blueprint file and try again.'
					);
					errorToShow = simplifyErrorToFirstSentence( error );
				} else {
					title = __( 'Failed to create site' );
					message = __(
						'An error occurred while creating the site. Verify your selected local path is an empty directory or an existing WordPress folder and try again. If this problem persists, please contact support.'
					);
					// Simplify the error for user display
					errorToShow = simplifyErrorForDisplay( error );
				}

				getIpcApi().showErrorMessageBox( {
					title,
					message,
					error: errorToShow,
					showOpenLogs: true,
				} );

				// Remove the temporary site immediately, but with a minor delay to ensure state updates properly
				setTimeout( () => {
					setSites( ( prevData ) =>
						sortSites( prevData.filter( ( site ) => site.id !== tempSiteId ) )
					);
				}, 2000 );
			};

			const tempSiteId = crypto.randomUUID();
			setSites( ( prevData ) =>
				sortSites( [
					...prevData,
					{
						id: tempSiteId,
						name: siteName || path,
						path,
						port: -1, // Set a temporary port
						running: false,
						isAddingSite: true,
						phpVersion: '',
					},
				] )
			);
			setSelectedSiteId( tempSiteId ); // Set the temporary ID as the selected site

			let newSite: SiteDetails;
			try {
				newSite = await getIpcApi().createSite( path, {
					siteName,
					wpVersion,
					customDomain,
					enableHttps,
					siteId: tempSiteId,
					phpVersion,
					runtime,
					fileAccess,
					blueprint,
					adminUsername,
					adminPassword,
					adminEmail,
					noStart,
				} );
				if ( ! newSite ) {
					showError( undefined, !! blueprint );
					return;
				}
				// Update the selected site to the new site's ID if the user didn't change it
				setSelectedSiteId( ( prevSelectedSiteId ) => {
					if ( prevSelectedSiteId === tempSiteId ) {
						if ( selectedTab !== 'overview' ) {
							setSelectedTab( 'overview' );
						}
						return newSite.id;
					}
					return prevSelectedSiteId;
				} );
				setSites( ( prevData ) =>
					sortSites( [
						...prevData.filter( ( site ) => site.id !== tempSiteId && site.id !== newSite.id ),
						{ ...newSite, isAddingSite: true },
					] )
				);

				setSiteCreationMessages( ( prev ) => {
					const { [ newSite.id ]: _, ...rest } = prev;
					return rest;
				} );

				if ( callback ) {
					await callback( newSite );
				}

				setSites( ( prevData ) =>
					prevData.map( ( site ) => {
						if ( site.id === newSite.id ) {
							return { ...site, isAddingSite: false };
						}
						return site;
					} )
				);

				return newSite;
			} catch ( error ) {
				showError( error, !! blueprint );
			}
		},
		[ selectedTab, setSelectedSiteId, setSelectedTab ]
	);

	const updateSite = useCallback( async ( site: SiteDetails, wpVersion?: string ) => {
		await getIpcApi().updateSite( site, wpVersion );
		const updatedSites = await getIpcApi().getSiteDetails();
		setSites( sortSites( updatedSites ) );
	}, [] );

	const saveTimeoutRef = useRef< ReturnType< typeof setTimeout > >( undefined );
	const DEBOUNCE_SAVE_MS = 300;

	const updateSitesSortOrder = useCallback( async ( sites: SiteDetails[] ) => {
		setSites( sites );
		const updates = sites.map( ( site, index ) => ( {
			siteId: site.id,
			sortOrder: ( index + 1 ) * 1000,
		} ) );

		clearTimeout( saveTimeoutRef.current );
		saveTimeoutRef.current = setTimeout( async () => {
			await getIpcApi().updateSitesSortOrder( updates );
		}, DEBOUNCE_SAVE_MS );
	}, [] );

	const startServer = useCallback(
		async (
			site: SiteDetails,
			options?: { suppressCapacityModal?: boolean }
		): Promise< { capacityLimitReached: boolean } > => {
			const { id, name: siteName } = site;
			startLoadingForSite( id );
			let capacityLimitReached = false;

			try {
				try {
					await getIpcApi().startServer( id );
				} catch ( error ) {
					if ( error instanceof Error && error.message.includes( 'PROXY_ERROR_PORT_IN_USE' ) ) {
						getIpcApi().showErrorMessageBox( {
							title: sprintf( __( "Failed to initialize custom domains for '%s'" ), siteName ),
							message: __(
								'Studio needs to use port 80 and 443 to enable custom domains and SSL, but one of these ports are already in use by another app. Close any local development apps and restart Studio.'
							),
							showOpenLogs: false,
						} );
					} else if (
						error instanceof Error &&
						error.message.includes( 'PROXY_ERROR_START_FAILED' )
					) {
						getIpcApi().showErrorMessageBox( {
							title: sprintf( __( "Failed to initialize custom domains for '%s'" ), siteName ),
							message: __(
								'Please restart Studio and try again. If this problem persists, please contact support.'
							),
							showOpenLogs: true,
						} );
					} else if (
						error instanceof Error &&
						error.message.includes( 'WASM_ERROR_NOT_ENOUGH_MEMORY' )
					) {
						getIpcApi().showErrorMessageBox( {
							title: sprintf( __( "Not enough memory to start '%s'" ), siteName ),
							message: __(
								'Please stop some of your running sites first. If this problem persists, try closing other apps that might be using memory and try again.'
							),
							showOpenLogs: true,
						} );
					} else if ( error instanceof Error && error.message.includes( 'ERROR_PORT_IN_USE' ) ) {
						const port = error.message.match( /\d+/ );
						getIpcApi().showErrorMessageBox( {
							title: sprintf( __( "Failed to start '%s'" ), siteName ),
							message: __(
								`The site server failed to start because the port is already in use. Please close any local development apps that may be using port ${ port } and try again.`
							),
							showOpenLogs: false,
						} );
					} else if (
						error instanceof Error &&
						error.message.includes( 'CAPACITY_LIMIT_REACHED' )
					) {
						capacityLimitReached = true;
						if ( ! options?.suppressCapacityModal ) {
							getIpcApi().showErrorMessageBox( {
								title: sprintf( __( "Failed to start '%s'" ), siteName ),
								message: __(
									'The maximum number of running sites has been reached. Please stop some running sites before starting new ones.'
								),
								showOpenLogs: false,
							} );
						}
					} else if ( error instanceof Error && error.message.includes( 'MAINTENANCE_MODE' ) ) {
						getIpcApi().showErrorMessageBox( {
							title: sprintf( __( "'%s' is in maintenance mode" ), siteName ),
							message: __(
								'WordPress is currently performing an update. The maintenance lock should expire automatically within 10 minutes. Please wait for the update to finish and try starting the site again.'
							),
							showOpenLogs: false,
						} );
					} else {
						const errorToShow = simplifyErrorForDisplay( error );
						getIpcApi().showErrorMessageBox( {
							title: sprintf( __( "Failed to start '%s'" ), siteName ),
							message: __(
								"Please verify your site's local path directory contains the standard WordPress installation files and try again. If this problem persists, please contact support."
							),
							error: errorToShow,
							showOpenLogs: true,
						} );
					}
					await getIpcApi().stopServer( id );
				}
			} finally {
				clearLoadingForSite( id );
			}
			return { capacityLimitReached };
		},
		[ startLoadingForSite, clearLoadingForSite ]
	);

	const startServers = useCallback(
		async ( sitesToStart: SiteDetails[] ) => {
			let capacityModalShown = false;
			await Promise.all(
				sitesToStart.map( async ( site ) => {
					const { capacityLimitReached } = await startServer( site, {
						suppressCapacityModal: true,
					} );
					if ( capacityLimitReached && ! capacityModalShown ) {
						capacityModalShown = true;
						getIpcApi().showErrorMessageBox( {
							title: __( 'Some sites could not be started' ),
							message: __(
								'The maximum number of running sites has been reached. Please stop some running sites before starting new ones.'
							),
							showOpenLogs: false,
						} );
					}
				} )
			);
		},
		[ startServer ]
	);

	const copySite = useCallback(
		async ( sourceSiteId: string ) => {
			const sourceSite = sites.find( ( site ) => site.id === sourceSiteId );
			if ( ! sourceSite ) {
				console.error( 'Source site not found' );
				return;
			}

			const showError = ( error?: unknown ) => {
				console.error( 'Failed to copy site' );
				const errorToShow = simplifyErrorForDisplay( error );

				getIpcApi().showErrorMessageBox( {
					title: __( 'Failed to copy site' ),
					message: __(
						'An error occurred while copying the site. Please try again. If this problem persists, please contact support.'
					),
					error: errorToShow,
					showOpenLogs: true,
				} );

				setSites( ( prevData ) =>
					sortSites( prevData.filter( ( site ) => site.id !== tempSiteId ) )
				);
			};

			const finalSiteName = await getIpcApi().generateNumberedNameFromList(
				sprintf( __( '%s Copy' ), sourceSite.name ),
				sites
			);

			const tempSiteId = crypto.randomUUID();

			setSites( ( prevData ) =>
				sortSites( [
					...prevData,
					{
						id: tempSiteId,
						name: finalSiteName,
						path: '', // Path will be determined by the backend
						port: -1, // Temporary port
						running: false,
						isAddingSite: true,
						phpVersion: sourceSite.phpVersion,
					},
				] )
			);

			setSelectedSiteId( tempSiteId );
			if ( selectedTab !== 'overview' ) {
				setSelectedTab( 'overview' );
			}

			let newSite: SiteDetails;
			try {
				newSite = await getIpcApi().copySite( sourceSiteId, tempSiteId, finalSiteName );
				if ( ! newSite ) {
					showError();
					return;
				}

				setSites( ( prevData ) =>
					sortSites( [
						...prevData.filter( ( site ) => site.id !== tempSiteId ),
						{ ...newSite, isAddingSite: false },
					] )
				);

				setSelectedSiteId( newSite.id );

				getIpcApi().showNotification( {
					title: newSite.name,
					body: sprintf( __( 'Your site %s was copied successfully' ), sourceSite.name ),
				} );

				void startServer( newSite );

				return newSite;
			} catch ( error ) {
				showError( error );
			}
		},
		[ sites, selectedTab, setSelectedSiteId, setSelectedTab, startServer ]
	);

	// Auto start sites that are set to auto start when the component mounts
	useEffect( () => {
		let cancel = false;
		setLoadingSites( true );
		getIpcApi()
			.getSiteDetails()
			.then( async ( data ) => {
				if ( ! cancel ) {
					setSites( sortSites( data ) );
					setLoadingSites( false );
					const autoStartSites = data.filter( ( site ) => site.autoStart );
					void startServers( autoStartSites );
				}
			} )
			.catch( ( error ) => {
				console.error( 'Error fetching site details:', error );
				setLoadingSites( false );
			} );

		return () => {
			cancel = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [] );

	const stopServer = useCallback(
		async ( id: string ) => {
			startLoadingForSite( id );
			try {
				await getIpcApi().stopServer( id );
			} finally {
				clearLoadingForSite( id );
			}
		},
		[ startLoadingForSite, clearLoadingForSite ]
	);

	const stopAllRunningSites = useCallback( async () => {
		await getIpcApi().stopAllServers();
	}, [] );

	const startAllStoppedSites = useCallback( async () => {
		const stoppedSites = sites.filter( ( site ) => ! site.running && ! site.isAddingSite );
		await startServers( stoppedSites );
	}, [ sites, startServers ] );

	const [ isEditModalOpen, setIsEditModalOpen ] = useState( false );
	const [ editModalInitialTab, setEditModalInitialTab ] = useState( 'general' );
	const selectedSite = sites.find( ( site ) => site.id === selectedSiteId ) || firstSite;

	const isSiteDeleting = useCallback(
		( siteId: string ) => !! isDeleting[ siteId ],
		[ isDeleting ]
	);

	const context = useMemo(
		() => ( {
			selectedSite,
			sites,
			setSelectedSiteId,
			createSite,
			copySite,
			updateSite,
			updateSitesSortOrder,
			startServer,
			startServers,
			stopServer,
			stopAllRunningSites,
			startAllStoppedSites,
			loadingServer,
			deleteSite: onDeleteSite,
			isDeleting: selectedSiteId ? isDeleting[ selectedSiteId ] : false,
			isSiteDeleting,
			loadingSites,
			uploadingSites,
			setUploadingSites,
			isEditModalOpen,
			setIsEditModalOpen,
			editModalInitialTab,
			setEditModalInitialTab,
			siteCreationMessages,
		} ),
		[
			selectedSite,
			sites,
			setSelectedSiteId,
			createSite,
			copySite,
			updateSite,
			updateSitesSortOrder,
			startServer,
			startServers,
			stopServer,
			stopAllRunningSites,
			startAllStoppedSites,
			loadingServer,
			onDeleteSite,
			selectedSiteId,
			isDeleting,
			isSiteDeleting,
			loadingSites,
			uploadingSites,
			isEditModalOpen,
			setIsEditModalOpen,
			editModalInitialTab,
			siteCreationMessages,
		]
	);

	return <Provider value={ context }>{ children }</Provider>;
}
