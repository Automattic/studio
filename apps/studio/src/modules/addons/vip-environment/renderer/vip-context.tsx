import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getVipIpcApi } from './vip-ipc';
import type { VipCliStatus, VipEnvironment } from '../types';
import type { ReactNode } from 'react';

interface VipContextValue {
	environments: VipEnvironment[];
	selectedEnvironment: VipEnvironment | null;
	isLoading: boolean;
	error: string | null;
	isVipAvailable: boolean;
	vipCliStatus: VipCliStatus | null;
	loadingEnvironments: Record< string, boolean >;
	operationError: string | null;
	clearOperationError: () => void;
	selectEnvironment: ( slug: string | null ) => void;
	refresh: () => Promise< void >;
	startEnvironment: ( slug: string ) => Promise< boolean >;
	stopEnvironment: ( slug: string ) => Promise< boolean >;
}

export const VipContext = createContext< VipContextValue | null >( null );

export function VipProvider( { children }: { children: ReactNode } ) {
	const [ environments, setEnvironments ] = useState< VipEnvironment[] >( [] );
	const [ selectedSlug, setSelectedSlug ] = useState< string | null >( null );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState< string | null >( null );
	const [ isVipAvailable, setIsVipAvailable ] = useState( false );
	const [ vipCliStatus, setVipCliStatus ] = useState< VipCliStatus | null >( null );
	const [ loadingEnvironments, setLoadingEnvironments ] = useState< Record< string, boolean > >(
		{}
	);
	const [ operationError, setOperationError ] = useState< string | null >( null );
	const { selectedSite } = useSiteDetails();

	const clearOperationError = useCallback( () => {
		setOperationError( null );
	}, [] );

	const refresh = useCallback( async () => {
		setIsLoading( true );
		setError( null );
		try {
			const ipc = getVipIpcApi();
			if ( typeof ipc.vipIsCliAvailable !== 'function' ) {
				return;
			}
			const cliStatus = await ipc.vipIsCliAvailable();
			setVipCliStatus( cliStatus );
			setIsVipAvailable( cliStatus.available );

			if ( ! cliStatus.available ) {
				setEnvironments( [] );
				setIsLoading( false );
				return;
			}

			const envs = await ipc.vipGetEnvironments();
			setEnvironments( envs );
		} catch ( err ) {
			setError( err instanceof Error ? err.message : 'Failed to load VIP environments' );
			setEnvironments( [] );
		} finally {
			setIsLoading( false );
		}
	}, [] );

	const startEnvironment = useCallback(
		async ( slug: string ): Promise< boolean > => {
			setLoadingEnvironments( ( prev ) => ( { ...prev, [ slug ]: true } ) );
			setOperationError( null );
			try {
				const result = await getVipIpcApi().vipStartEnvironment( slug );
				if ( result.success ) {
					await refresh();
					return true;
				}
				setOperationError( result.stderr || result.stdout || 'Failed to start environment' );
				return false;
			} catch ( err ) {
				setOperationError( err instanceof Error ? err.message : 'An unexpected error occurred' );
				return false;
			} finally {
				setLoadingEnvironments( ( prev ) => ( { ...prev, [ slug ]: false } ) );
			}
		},
		[ refresh ]
	);

	const stopEnvironment = useCallback(
		async ( slug: string ): Promise< boolean > => {
			setLoadingEnvironments( ( prev ) => ( { ...prev, [ slug ]: true } ) );
			setOperationError( null );
			try {
				const result = await getVipIpcApi().vipStopEnvironment( slug );
				if ( result.success ) {
					await refresh();
					return true;
				}
				setOperationError( result.stderr || result.stdout || 'Failed to stop environment' );
				return false;
			} catch ( err ) {
				setOperationError( err instanceof Error ? err.message : 'An unexpected error occurred' );
				return false;
			} finally {
				setLoadingEnvironments( ( prev ) => ( { ...prev, [ slug ]: false } ) );
			}
		},
		[ refresh ]
	);

	useEffect( () => {
		void refresh();
	}, [ refresh ] );

	// Snapshot the site id at the time the VIP slug is set, so we can detect
	// when the user clicks a *different* Studio site and clear the VIP selection.
	const siteIdAtVipActivationRef = useRef< string | null >( null );

	const handleSelectEnvironment = useCallback(
		( slug: string | null ) => {
			setSelectedSlug( slug );
			siteIdAtVipActivationRef.current = slug !== null ? selectedSite?.id ?? null : null;
		},
		[ selectedSite?.id ]
	);

	// Clear VIP selection when the active Studio site id changes
	useEffect( () => {
		if ( selectedSlug === null ) {
			return;
		}
		if ( selectedSite?.id !== siteIdAtVipActivationRef.current ) {
			setSelectedSlug( null );
			siteIdAtVipActivationRef.current = null;
		}
	}, [ selectedSite?.id, selectedSlug ] );

	const selectedEnvironment = environments.find( ( env ) => env.slug === selectedSlug ) ?? null;

	return (
		<VipContext.Provider
			value={ {
				environments,
				selectedEnvironment,
				isLoading,
				error,
				isVipAvailable,
				vipCliStatus,
				loadingEnvironments,
				operationError,
				clearOperationError,
				selectEnvironment: handleSelectEnvironment,
				refresh,
				startEnvironment,
				stopEnvironment,
			} }
		>
			{ children }
		</VipContext.Provider>
	);
}

export function useVipContext(): VipContextValue {
	const ctx = useContext( VipContext );
	if ( ! ctx ) {
		// Return a safe default when used outside VipProvider (e.g., during SSR or tests)
		return {
			environments: [],
			selectedEnvironment: null,
			isLoading: false,
			error: null,
			isVipAvailable: false,
			vipCliStatus: null,
			loadingEnvironments: {},
			operationError: null,
			clearOperationError: () => {},
			selectEnvironment: () => {},
			refresh: async () => {},
			startEnvironment: async () => false,
			stopEnvironment: async () => false,
		};
	}
	return ctx;
}
