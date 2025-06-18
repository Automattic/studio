import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

export type WpListType = 'plugins' | 'themes';
export type WpListEntry = { name: string; type: 'file' | 'folder' };

export function useWpList( siteId: string, type: WpListType ) {
	const [ items, setItems ] = useState< WpListEntry[] >( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState< Error | null >( null );

	useEffect( () => {
		async function fetchList() {
			try {
				setIsLoading( true );
				setError( null );
				const entries = await getIpcApi().listWpContentFolders( siteId, type );
				setItems( entries );
			} catch ( err ) {
				Sentry.captureException( err );
				setError( err instanceof Error ? err : new Error( `Failed to fetch ${ type }s` ) );
			} finally {
				setIsLoading( false );
			}
		}
		void fetchList();
	}, [ siteId, type ] );

	return { items, isLoading, error };
}
