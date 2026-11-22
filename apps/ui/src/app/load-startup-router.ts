import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { createAppRouter } from '@/router/router';
import type { Connector } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';
import type { RouterHistory } from '@tanstack/react-router';

export async function loadStartupRouter(
	connector: Connector,
	queryClient: QueryClient,
	history?: RouterHistory
) {
	const router = createAppRouter( { connector, queryClient }, history );
	// Failures belong to the workspace's retry/error views, not an endless startup screen.
	await Promise.allSettled( [
		queryClient.fetchQuery( {
			queryKey: SITES_QUERY_KEY,
			queryFn: () => connector.getSites(),
		} ),
		queryClient.fetchQuery( {
			queryKey: SESSIONS_QUERY_KEY,
			queryFn: () => connector.getSessions(),
		} ),
		router.load(),
	] );
	return router;
}
