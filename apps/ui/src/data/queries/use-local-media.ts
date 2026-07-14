import { readBlobAsDataUrl } from '@studio/common/ai/composer-attachments';
import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const LOCAL_MEDIA_QUERY_KEY = [ 'local-media' ] as const;

// Resolves a local media file to a `data:` URL. A data URL needs no
// revocation lifecycle (unlike object URLs, which break under StrictMode's
// double-invoked effects) and is allowed by the desktop renderer CSP.
export function useLocalMediaDataUrl( path: string | null ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: [ ...LOCAL_MEDIA_QUERY_KEY, path ],
		queryFn: async () => {
			const file = await connector.readLocalMediaFile( path! );
			return readBlobAsDataUrl( new Blob( [ file.data ], { type: file.mimeType } ) );
		},
		enabled: !! path,
		// Screenshot files are immutable once written, so a cached read stays
		// valid for the lifetime of the app; the cache also prevents re-reading
		// multi-MB files over IPC when the conversation remounts.
		staleTime: Infinity,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: false,
	} );
}
