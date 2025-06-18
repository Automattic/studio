import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

export type WpListType = 'plugins' | 'themes';
export type WpListEntry = { name: string; type: 'file' | 'folder' };
export type WpListResult = { items: WpListEntry[]; isLoading: boolean; error: Error | null };

export function useWpList(
	siteId: string,
	types: WpListType[]
): Record< WpListType, WpListResult > {
	const [ results, setResults ] = useState< Record< WpListType, WpListResult > >( () => {
		const initialResults = {
			plugins: { items: [], isLoading: true, error: null },
			themes: { items: [], isLoading: true, error: null },
		} as Record< WpListType, WpListResult >;

		return initialResults;
	} );

	useEffect( () => {
		async function fetchLists() {
			const promises = types.map( async ( type ) => {
				try {
					setResults( ( prev ) => ( {
						...prev,
						[ type ]: { ...prev[ type ], isLoading: true, error: null },
					} ) );

					const entries = await getIpcApi().listWpContentFolders( siteId, type );
					const sortedEntries = entries.slice().sort( ( a, b ) => {
						if ( a.type !== b.type ) {
							return a.type === 'folder' ? -1 : 1;
						}
						return a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1;
					} );

					setResults( ( prev ) => ( {
						...prev,
						[ type ]: { items: sortedEntries, isLoading: false, error: null },
					} ) );
				} catch ( err ) {
					Sentry.captureException( err );
					const error = err instanceof Error ? err : new Error( `Failed to fetch ${ type }s` );
					setResults( ( prev ) => ( {
						...prev,
						[ type ]: { ...prev[ type ], isLoading: false, error },
					} ) );
				}
			} );

			await Promise.allSettled( promises );
		}

		void fetchLists();
	}, [ siteId, types ] );

	return results;
}
