import { QueryClientProvider } from '@tanstack/react-query';
import { ConnectorProvider, queryClient, type Connector } from '@/data/core';
import { useSyncLibraryWithHost } from '@/data/queries/use-library';
import { useApplyHostContext } from '@/hooks/use-apply-host-context';
import { SearchQueryProvider } from '@/hooks/use-search-query';
import type { PropsWithChildren } from 'react';

function HostBridge() {
	useApplyHostContext();
	useSyncLibraryWithHost();
	return null;
}

export function AppProviders( {
	children,
	connector,
}: PropsWithChildren< { connector: Connector } > ) {
	return (
		<ConnectorProvider connector={ connector }>
			<QueryClientProvider client={ queryClient }>
				<HostBridge />
				<SearchQueryProvider>{ children }</SearchQueryProvider>
			</QueryClientProvider>
		</ConnectorProvider>
	);
}
