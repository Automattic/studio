import * as Sentry from '@sentry/electron/renderer';
import { useI18n } from '@wordpress/react-i18n';
import React, {
	createContext,
	useContext,
	useState,
	useCallback,
	useEffect,
	ReactNode,
	useMemo,
	useLayoutEffect,
} from 'react';
import { LIMIT_OF_ZIP_SITES_PER_USER } from '../constants';
import { getIpcApi } from '../lib/get-ipc-api';
import { useAuth } from './use-auth';
import { useOffline } from './use-offline';

interface SnapshotContextType {
	snapshots: Snapshot[];
	allSnapshots: Pick< Snapshot, 'atomicSiteId' >[] | null;
	addSnapshot: ( snapshot: Snapshot ) => void;
	updateSnapshot: ( snapshot: Partial< Snapshot > ) => void;
	removeSnapshot: ( snapshot: Pick< Snapshot, 'atomicSiteId' > ) => void;
	fetchAllSnapshots: () => Promise< Pick< Snapshot, 'atomicSiteId' >[] | null >;
	deleteSnapshot: (
		snapshot: Pick< Snapshot, 'atomicSiteId' >,
		displayAlert?: boolean
	) => Promise< void >;
	deleteAllSnapshots: ( snapshots: Pick< Snapshot, 'atomicSiteId' >[] ) => Promise< void >;
	clearFloatingSnapshots: ( allSnapshots: Pick< Snapshot, 'atomicSiteId' >[] ) => void;
	isLoading: boolean;
	loadingDeletingAllSnapshots: boolean;
	loadingServerSnapshots: boolean;
	activeSnapshotCount: number;
	snapshotQuota: number;
	fetchSnapshotUsage: () => Promise< { site_limit: number; site_count: number } | undefined >;
	isLoadingSnapshotUsage: boolean;
	initiated: boolean;
}

export enum SnapshotStatus {
	Deleted = '1',
	Active = '2',
}

export interface SnapshotStatusResponse {
	is_deleted: string;
	domain_name: string;
	atomic_site_id: string;
	status: SnapshotStatus;
}

interface FetchSnapshotResponse {
	sites: { atomic_site_id: number }[];
}

interface WpcomNetworkError extends Error {
	code?: string;
}

export const SnapshotContext = createContext< SnapshotContextType >( {
	snapshots: [],
	allSnapshots: null,
	addSnapshot: () => undefined,
	updateSnapshot: () => undefined,
	removeSnapshot: () => undefined,
	fetchAllSnapshots: async () => [],
	deleteSnapshot: async () => undefined,
	deleteAllSnapshots: async () => undefined,
	clearFloatingSnapshots: () => undefined,
	isLoading: false,
	loadingDeletingAllSnapshots: false,
	loadingServerSnapshots: false,
	activeSnapshotCount: 0,
	snapshotQuota: LIMIT_OF_ZIP_SITES_PER_USER,
	fetchSnapshotUsage: async () => undefined,
	isLoadingSnapshotUsage: false,
	initiated: false,
} );

export const SnapshotProvider: React.FC< { children: ReactNode } > = ( { children } ) => {
	const [ snapshots, setSnapshots ] = useState< Snapshot[] >( [] );
	const [ initiated, setInitiated ] = useState( false );
	const [ isLoading, setIsLoading ] = useState( false );
	const [ loadingDeletingAllSnapshots, setLoadingDeletingAllSnapshots ] = useState( false );
	const [ loadingServerSnapshots, setLoadingServerSnapshots ] = useState( false );
	const [ activeSnapshotCount, setActiveSnapshotCount ] = useState( 0 );
	const [ allSnapshots, setAllSnapshots ] = useState< Pick< Snapshot, 'atomicSiteId' >[] | null >(
		null
	);
	const [ snapshotQuota, setSnapshotQuota ] = useState( LIMIT_OF_ZIP_SITES_PER_USER );
	const [ isLoadingSnapshotUsage, setIsLoadingSnapshotUsage ] = useState( false );
	const { client } = useAuth();
	const isOffline = useOffline();
	const { __ } = useI18n();

	const removeSnapshot = useCallback( ( snapshot: Pick< Snapshot, 'atomicSiteId' > ) => {
		setSnapshots( ( prevSnapshots ) =>
			prevSnapshots.filter( ( s ) => s.atomicSiteId !== snapshot.atomicSiteId )
		);
		setActiveSnapshotCount( ( prevCount ) => ( prevCount === 0 ? prevCount : prevCount - 1 ) );
	}, [] );

	useEffect( () => {
		if ( ! initiated ) {
			return;
		}
		getIpcApi().saveSnapshotsToStorage( snapshots );
	}, [ snapshots, initiated ] );

	useLayoutEffect( () => {
		getIpcApi()
			.getSnapshots()
			.then( ( storedSnapshots ) => {
				setSnapshots( storedSnapshots );
				setInitiated( true );
			} );
	}, [] );

	useEffect( () => {
		if ( ! client?.req || isOffline ) {
			return;
		}
		const deletingSnapshots = snapshots.filter( ( snapshot ) => snapshot.isDeleting );
		if ( deletingSnapshots.length === 0 ) {
			setLoadingDeletingAllSnapshots( false );
			return;
		}
		const intervalId = setInterval( async () => {
			for ( const snapshot of deletingSnapshots ) {
				if ( snapshot.isDeleting ) {
					try {
						const resp: SnapshotStatusResponse = await client.req.get( '/jurassic-ninja/status', {
							apiNamespace: 'wpcom/v2',
							site_id: snapshot.atomicSiteId,
						} );
						if ( resp.is_deleted === SnapshotStatus.Deleted ) {
							removeSnapshot( snapshot );
						}
					} catch ( error ) {
						// This error occurs in the background, so we report it but do not
						// alert the user.
						Sentry.captureException( error );
					}
				}
			}
		}, 3000 );
		return () => {
			clearInterval( intervalId );
		};
	}, [ client?.req, isOffline, removeSnapshot, snapshots ] );

	const addSnapshot = useCallback( ( snapshot: Snapshot ) => {
		setSnapshots( ( prevSnapshots ) => [ snapshot, ...prevSnapshots ] );
		setActiveSnapshotCount( ( prevCount ) => prevCount + 1 );
	}, [] );

	const updateSnapshot = useCallback( ( snapshot: Partial< Snapshot > ) => {
		setSnapshots( ( snapshots ) => {
			const index = snapshots.findIndex(
				( snapshotI ) => snapshotI.atomicSiteId === snapshot.atomicSiteId
			);
			if ( index === -1 ) {
				if ( snapshot.isDeleting ) {
					const newSnapshots = [ ...snapshots ];
					newSnapshots.push( snapshot as Snapshot );
					return newSnapshots;
				}
				return snapshots;
			}
			const newSnapshots = [ ...snapshots ];
			newSnapshots[ index ] = { ...snapshots[ index ], ...snapshot };
			return newSnapshots;
		} );
	}, [] );

	const clearFloatingSnapshots = useCallback( function clearFloatingSnapshots(
		allSnapshots: Pick< Snapshot, 'atomicSiteId' >[]
	) {
		const siteIds = allSnapshots.map( ( snapshot ) => snapshot.atomicSiteId );
		if ( ! siteIds.length ) {
			setSnapshots( [] );
			return;
		}
		setSnapshots( ( snapshots ) =>
			snapshots.filter( ( snapshot ) => siteIds.includes( snapshot.atomicSiteId ) )
		);
	}, [] );

	useEffect( () => {
		if ( initiated && ! loadingServerSnapshots && allSnapshots ) {
			clearFloatingSnapshots( allSnapshots );
		}
	}, [ allSnapshots, clearFloatingSnapshots, initiated, loadingServerSnapshots ] );

	const fetchAllSnapshots = useCallback( async () => {
		if ( ! client?.req || isOffline || ! initiated ) {
			return null;
		}
		setLoadingServerSnapshots( true );
		try {
			const response: FetchSnapshotResponse = await client.req.get( {
				path: '/jurassic-ninja/list',
				apiNamespace: 'wpcom/v2',
			} );
			const sites: Pick< Snapshot, 'atomicSiteId' >[] =
				response.sites?.map( ( { atomic_site_id } ) => ( { atomicSiteId: atomic_site_id } ) ) ?? [];
			return sites;
		} catch ( error ) {
			Sentry.captureException( error );
		} finally {
			setLoadingServerSnapshots( false );
		}
		return null;
	}, [ client?.req, initiated, isOffline ] );

	useEffect( () => {
		if ( ! client || ! initiated ) {
			return;
		}
		const fetchSnapshots = async () => {
			const sites = await fetchAllSnapshots();
			if ( ! sites ) {
				return;
			}
			setAllSnapshots( sites );
		};
		fetchSnapshots();
	}, [ client, fetchAllSnapshots, activeSnapshotCount, initiated ] );

	const deleteSnapshot = useCallback(
		async ( snapshot: Pick< Snapshot, 'atomicSiteId' >, displayAlert = true ) => {
			if ( ! client ) {
				return;
			}
			setIsLoading( true );
			try {
				await client.req.post( {
					path: '/jurassic-ninja/delete',
					apiNamespace: 'wpcom/v2',
					body: { site_id: snapshot.atomicSiteId },
				} );
				updateSnapshot( {
					...snapshot,
					isDeleting: true,
				} );
			} catch ( error ) {
				if ( ( error as WpcomNetworkError )?.code === 'rest_site_already_deleted' ) {
					removeSnapshot( snapshot );
					return;
				}
				if ( displayAlert ) {
					alert( __( 'Error removing demo site. Please try again or contact support.' ) );
				}
				Sentry.captureException( error );
			} finally {
				setIsLoading( false );
			}
		},
		[ client, updateSnapshot, removeSnapshot, __ ]
	);

	const deleteAllSnapshots = useCallback(
		async ( snapshotsToDelete: Pick< Snapshot, 'atomicSiteId' >[] ) => {
			setLoadingDeletingAllSnapshots( true );
			try {
				await Promise.all(
					snapshotsToDelete.map( ( snapshot ) => deleteSnapshot( snapshot, false ) )
				);
			} finally {
				setLoadingDeletingAllSnapshots( false );
			}
		},
		[ deleteSnapshot ]
	);

	const fetchSnapshotUsage = useCallback( async () => {
		if ( ! client?.req || isOffline ) {
			return;
		}
		setIsLoading( true );
		try {
			const response: { site_count: number; site_limit: number } = await client.req.get( {
				path: '/jurassic-ninja/usage',
				apiNamespace: 'wpcom/v2',
			} );
			return response;
		} catch ( error ) {
			Sentry.captureException( error );
		} finally {
			setIsLoading( false );
		}
	}, [ client?.req, isOffline ] );

	useEffect( () => {
		if ( ! initiated ) {
			return;
		}
		// If client is not ready, fail early
		// However, we still want to show the user the snapshots they have locally
		// to provide a better user experience
		if ( ! client ) {
			setActiveSnapshotCount( snapshots.length );
			setSnapshotQuota( LIMIT_OF_ZIP_SITES_PER_USER );
			return;
		}
		const fetchStats = async () => {
			const response = await fetchSnapshotUsage();
			if ( ! response ) {
				// Fetching failed, fallback to what we have in the client
				setIsLoadingSnapshotUsage( false );
				setActiveSnapshotCount( snapshots.length );
				setSnapshotQuota( LIMIT_OF_ZIP_SITES_PER_USER );
				return;
			}
			const { site_count, site_limit } = response;
			setActiveSnapshotCount( site_count );
			setSnapshotQuota( site_limit );
		};
		fetchStats();
	}, [ client, fetchSnapshotUsage, initiated, snapshots.length ] );

	const value: SnapshotContextType = useMemo(
		() => ( {
			snapshots,
			allSnapshots,
			addSnapshot,
			updateSnapshot,
			removeSnapshot,
			fetchAllSnapshots,
			deleteSnapshot,
			deleteAllSnapshots,
			clearFloatingSnapshots,
			isLoading,
			loadingDeletingAllSnapshots,
			loadingServerSnapshots,
			activeSnapshotCount,
			snapshotQuota,
			fetchSnapshotUsage,
			isLoadingSnapshotUsage,
			initiated,
		} ),
		[
			activeSnapshotCount,
			addSnapshot,
			clearFloatingSnapshots,
			deleteAllSnapshots,
			deleteSnapshot,
			fetchAllSnapshots,
			fetchSnapshotUsage,
			isLoading,
			isLoadingSnapshotUsage,
			loadingDeletingAllSnapshots,
			loadingServerSnapshots,
			removeSnapshot,
			snapshotQuota,
			snapshots,
			allSnapshots,
			updateSnapshot,
			initiated,
		]
	);

	return <SnapshotContext.Provider value={ value }>{ children }</SnapshotContext.Provider>;
};

export const useSnapshots = () => {
	const context = useContext( SnapshotContext );
	if ( ! context ) {
		throw new Error( 'useSnapshots must be used within a SnapshotProvider' );
	}
	return context;
};
