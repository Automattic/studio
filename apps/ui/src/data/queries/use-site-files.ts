import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';

export const SITE_FILES_QUERY_KEY = [ 'site-files' ] as const;

/**
 * The session workspace's files for a client-side Playground preview. Re-fetches
 * whenever the connector signals the session's files changed (after an agent
 * turn), so the live preview follows the agent's work.
 *
 * Disabled when `sessionId` is undefined. Connectors without a browser-
 * previewable workspace (desktop IPC) return an empty list and never signal.
 */
export function useSiteFiles( sessionId: string | undefined ) {
	const connector = useConnector();
	const queryClient = useQueryClient();

	useEffect( () => {
		const unsubscribe = connector.onPreviewChanged( ( changedSessionId ) => {
			if ( changedSessionId !== sessionId ) {
				return;
			}
			void queryClient.invalidateQueries( {
				queryKey: [ ...SITE_FILES_QUERY_KEY, sessionId ],
			} );
		} );
		return unsubscribe;
	}, [ connector, queryClient, sessionId ] );

	return useQuery( {
		queryKey: [ ...SITE_FILES_QUERY_KEY, sessionId ],
		queryFn: () => connector.getSiteFiles( sessionId as string ),
		enabled: !! sessionId,
		// Each fetch is a fresh snapshot of the workspace files (incl. the SQLite
		// DB). React Query's default structural sharing can return the previous
		// array reference when its deep-equality pass treats the large base64
		// payloads as unchanged, so the preview's `[files]` effect never re-runs
		// after an agent turn. Disable it: every refetch yields a new reference,
		// so the live preview re-overlays and reloads. Re-overlaying identical
		// files is harmless.
		structuralSharing: false,
	} );
}
