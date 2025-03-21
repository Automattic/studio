import { useState, useEffect, useCallback } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

interface UseLastSeenVersion {
	lastSeenVersion: string | undefined;
	isNewVersion: boolean;
	updateLastSeenVersion: () => Promise< void >;
	isLoading: boolean;
}

export function useLastSeenVersion(): UseLastSeenVersion {
	const [ lastSeenVersion, setLastSeenVersion ] = useState< string | undefined >( undefined );
	const [ isLoading, setIsLoading ] = useState( true );
	const currentVersion = window.appGlobals.appVersion;

	useEffect( () => {
		const fetchLastSeenVersion = async () => {
			try {
				const version = await getIpcApi().getLastSeenVersion();
				setLastSeenVersion( version );
			} catch ( error ) {
				console.error( 'Failed to get last seen version:', error );
			} finally {
				setIsLoading( false );
			}
		};
		fetchLastSeenVersion();
	}, [] );

	const updateLastSeenVersion = useCallback( async () => {
		try {
			await getIpcApi().saveLastSeenVersion( currentVersion );
			setLastSeenVersion( currentVersion );
		} catch ( error ) {
			console.error( 'Failed to save last seen version:', error );
		}
	}, [ currentVersion ] );

	const isNewVersion = ! isLoading && !! currentVersion && lastSeenVersion !== currentVersion;

	return {
		lastSeenVersion,
		isNewVersion,
		updateLastSeenVersion,
		isLoading,
	};
}
