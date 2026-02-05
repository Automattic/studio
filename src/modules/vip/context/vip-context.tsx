import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { VipEnvironment, VipCliStatus } from '../types';

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

const VipContext = createContext< VipContextValue | null >( null );

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

	const clearOperationError = useCallback( () => {
		setOperationError( null );
	}, [] );

	const refresh = useCallback( async () => {
		setIsLoading( true );
		setError( null );

		try {
			const cliStatus = await getIpcApi().isVipCliAvailable();
			setVipCliStatus( cliStatus );
			setIsVipAvailable( cliStatus.available );

			if ( ! cliStatus.available ) {
				setEnvironments( [] );
				setIsLoading( false );
				return;
			}

			const envs = await getIpcApi().getVipEnvironments();
			setEnvironments( envs );
		} catch ( err ) {
			setError( err instanceof Error ? err.message : 'Failed to load VIP environments' );
			setEnvironments( [] );
		} finally {
			setIsLoading( false );
		}
	}, [] );

	const selectEnvironment = useCallback( ( slug: string | null ) => {
		setSelectedSlug( slug );
	}, [] );

	const startEnvironment = useCallback(
		async ( slug: string ): Promise< boolean > => {
			setLoadingEnvironments( ( prev ) => ( { ...prev, [ slug ]: true } ) );
			setOperationError( null );
			try {
				const result = await getIpcApi().startVipEnv( slug );
				if ( result.success ) {
					await refresh();
					return true;
				}
				const errorMessage = result.stderr || result.stdout || 'Failed to start environment';
				setOperationError( errorMessage );
				return false;
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
				setOperationError( errorMessage );
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
				const result = await getIpcApi().stopVipEnv( slug );
				if ( result.success ) {
					await refresh();
					return true;
				}
				const errorMessage = result.stderr || result.stdout || 'Failed to stop environment';
				setOperationError( errorMessage );
				return false;
			} catch ( err ) {
				const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
				setOperationError( errorMessage );
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
				selectEnvironment,
				refresh,
				startEnvironment,
				stopEnvironment,
			} }
		>
			{ children }
		</VipContext.Provider>
	);
}

// Default context value for when used outside of VipProvider (e.g., in tests)
const defaultVipContext: VipContextValue = {
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

export function useVipContext(): VipContextValue {
	const context = useContext( VipContext );
	// Return default context if not in a VipProvider (e.g., in tests)
	return context ?? defaultVipContext;
}
