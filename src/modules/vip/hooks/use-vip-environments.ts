import { useCallback, useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { VipEnvironment, VipCliStatus } from '../types';

interface UseVipEnvironments {
	environments: VipEnvironment[];
	isLoading: boolean;
	error: string | null;
	isVipAvailable: boolean;
	vipCliStatus: VipCliStatus | null;
	refresh: () => Promise< void >;
	startEnvironment: ( slug: string ) => Promise< boolean >;
	stopEnvironment: ( slug: string ) => Promise< boolean >;
}

export function useVipEnvironments(): UseVipEnvironments {
	const [ environments, setEnvironments ] = useState< VipEnvironment[] >( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState< string | null >( null );
	const [ isVipAvailable, setIsVipAvailable ] = useState( false );
	const [ vipCliStatus, setVipCliStatus ] = useState< VipCliStatus | null >( null );

	const refresh = useCallback( async () => {
		setIsLoading( true );
		setError( null );

		try {
			// First check if VIP CLI is available
			const cliStatus = await getIpcApi().isVipCliAvailable();
			setVipCliStatus( cliStatus );
			setIsVipAvailable( cliStatus.available );

			if ( ! cliStatus.available ) {
				setEnvironments( [] );
				setIsLoading( false );
				return;
			}

			// Get VIP environments
			const envs = await getIpcApi().getVipEnvironments();
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
			try {
				const result = await getIpcApi().startVipEnv( slug );
				if ( result.success ) {
					// Refresh to get updated status
					await refresh();
					return true;
				}
				return false;
			} catch {
				return false;
			}
		},
		[ refresh ]
	);

	const stopEnvironment = useCallback(
		async ( slug: string ): Promise< boolean > => {
			try {
				const result = await getIpcApi().stopVipEnv( slug );
				if ( result.success ) {
					// Refresh to get updated status
					await refresh();
					return true;
				}
				return false;
			} catch {
				return false;
			}
		},
		[ refresh ]
	);

	// Load environments on mount
	useEffect( () => {
		void refresh();
	}, [ refresh ] );

	return {
		environments,
		isLoading,
		error,
		isVipAvailable,
		vipCliStatus,
		refresh,
		startEnvironment,
		stopEnvironment,
	};
}
