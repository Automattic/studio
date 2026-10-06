import { QueryClientProvider } from '@tanstack/react-query';
import { ConnectorProvider, queryClient, type Connector } from '@/data/core';
import { useSyncSitesWithHost } from '@/data/queries/use-library';
import { useApplyHostContext } from '@/hooks/use-apply-host-context';
import type { PropsWithChildren } from 'react';

function HostBridge() {
	useApplyHostContext();
	useSyncSitesWithHost();
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
				{ children }
			</QueryClientProvider>
		</ConnectorProvider>
	);
}
