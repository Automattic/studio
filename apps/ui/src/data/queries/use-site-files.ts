import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';

export const SITE_FILES_QUERY_KEY = [ 'site-files' ] as const;

/**
 * The session workspace's deployable files for a client-side Playground preview.
 * Re-fetches whenever the connector signals the session's files changed (after
 * an agent turn), so the live preview follows the agent's work.
 *
 * Disabled when `sessionId` is undefined. Connectors without a browser-
 * previewable workspace (IPC/SecEx today) return an empty list.
 */
export function useSiteFiles( sessionId: string | undefined ) {
	const connector = useConnector();
	const queryClient = useQueryClient();

	useEffect( () => {
		let timer: ReturnType< typeof setTimeout > | undefined;
		const unsubscribe = connector.onPreviewChanged( ( changedSessionId ) => {
			if ( changedSessionId !== sessionId ) {
				return;
			}
			// The agent's run signals completion (run.exited) before its background
			// durability step — sandbox snapshot + pause + per-user state write — has
			// finished. Exporting immediately can read a one-turn-stale snapshot
			// (the export resolves the sandbox from state that hasn't been updated
			// yet), so the preview lags a turn behind. Wait for that tail to settle
			// before re-fetching the files. (The proper fix is server-side: have the
			// export read the live sandbox rather than restore a snapshot.)
			clearTimeout( timer );
			timer = setTimeout( () => {
				void queryClient.invalidateQueries( {
					queryKey: [ ...SITE_FILES_QUERY_KEY, sessionId ],
				} );
			}, 12_000 );
		} );
		return () => {
			clearTimeout( timer );
			unsubscribe();
		};
	}, [ connector, queryClient, sessionId ] );

	return useQuery( {
		queryKey: [ ...SITE_FILES_QUERY_KEY, sessionId ],
		queryFn: () => connector.getSiteFiles( sessionId as string ),
		enabled: !! sessionId,
		// Each export is a fresh snapshot of the site's files (incl. the SQLite DB).
		// React Query's default structural sharing can return the previous array
		// reference when its deep-equality pass treats the large base64 payloads as
		// unchanged, so the preview's `[files]` effect never re-runs after an agent
		// turn. Disable it: every refetch yields a new reference, so the live preview
		// re-overlays and reloads. Re-overlaying identical files is harmless.
		structuralSharing: false,
	} );
}
