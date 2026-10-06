import { QueryClientProvider } from '@tanstack/react-query';
import { useSyncSitesWithHost } from '@/data/queries/use-library';
import { queryClient } from '@/data/query-client';
import { useApplyHostContext } from '@/hooks/use-apply-host-context';
import type { PropsWithChildren } from 'react';

function HostBridge() {
	useApplyHostContext();
	useSyncSitesWithHost();
	return null;
}

export function AppProviders( { children }: PropsWithChildren ) {
	return (
		<QueryClientProvider client={ queryClient }>
			<HostBridge />
			{ children }
		</QueryClientProvider>
	);
}
