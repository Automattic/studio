import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import { useMemo } from 'react';
import { queryClient as defaultQueryClient } from '@/data/core';
import { useTextContextMenu } from '@/features/chats';
import { createAppRouter } from '@/router/router';
import { AppProviders } from './app-providers';
import type { Connector } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

interface AppProps {
	connector: Connector;
	queryClient?: QueryClient;
	history?: RouterHistory;
}

export function App( { connector, queryClient = defaultQueryClient, history }: AppProps ) {
	return (
		<AppProviders connector={ connector } queryClient={ queryClient }>
			<AppRouter connector={ connector } queryClient={ queryClient } history={ history } />
		</AppProviders>
	);
}

function AppRouter( {
	connector,
	queryClient,
	history,
}: Required< Pick< AppProps, 'connector' | 'queryClient' > > & Pick< AppProps, 'history' > ) {
	const router = useMemo(
		() => createAppRouter( { queryClient, connector }, history ),
		[ queryClient, connector, history ]
	);
	useTextContextMenu();
	return <RouterProvider router={ router } />;
}
