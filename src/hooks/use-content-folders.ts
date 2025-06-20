import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

export type WpContentFolder = 'plugins' | 'themes';
export type WpContentFolderEntry = { name: string; type: 'file' | 'folder' };
export type WpContentFolderResult = {
	items: WpContentFolderEntry[];
	isLoading: boolean;
	error: Error | null;
};

export function useContentFolders(
	siteId: string,
	types: WpContentFolder[]
): Record< WpContentFolder, WpContentFolderResult > {
	const [ results, setResults ] = useState< Record< WpContentFolder, WpContentFolderResult > >(
		() => {
			const initialResults: Record< WpContentFolder, WpContentFolderResult > = {
				plugins: { items: [], isLoading: true, error: null },
				themes: { items: [], isLoading: true, error: null },
			};

			return initialResults;
		}
	);

	useEffect( () => {
		types.forEach( async ( type ) => {
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
				const error = err instanceof Error ? err : new Error( `Failed to fetch ${ type }` );
				setResults( ( prev ) => ( {
					...prev,
					[ type ]: { ...prev[ type ], isLoading: false, error },
				} ) );
			}
		} );
	}, [ siteId, types ] );

	return results;
}
