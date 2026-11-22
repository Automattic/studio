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
	router?: ReturnType< typeof createAppRouter >;
}

export function App( { connector, queryClient = defaultQueryClient, history, router }: AppProps ) {
	return (
		<AppProviders connector={ connector } queryClient={ queryClient }>
			<AppRouter
				connector={ connector }
				queryClient={ queryClient }
				history={ history }
				router={ router }
			/>
		</AppProviders>
	);
}

function AppRouter( {
	connector,
	queryClient,
	history,
	router: initialRouter,
}: Required< Pick< AppProps, 'connector' | 'queryClient' > > &
	Pick< AppProps, 'history' | 'router' > ) {
	const router = useMemo(
		() => initialRouter ?? createAppRouter( { queryClient, connector }, history ),
		[ queryClient, connector, history, initialRouter ]
	);
	useTextContextMenu();
	return <RouterProvider router={ router } />;
}
