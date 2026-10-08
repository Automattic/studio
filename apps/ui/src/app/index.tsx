import { RouterProvider } from '@tanstack/react-router';
import { useMemo } from 'react';
import { queryClient } from '@/data/core';
import { useTextContextMenu } from '@/hooks/use-text-context-menu';
import { createAppRouter } from '@/router/router';
import { AppProviders } from './app-providers';
import type { Connector } from '@/data/core';

interface AppProps {
	connector: Connector;
}

export function App( { connector }: AppProps ) {
	return (
		<AppProviders connector={ connector }>
			<AppRouter connector={ connector } />
		</AppProviders>
	);
}

function AppRouter( { connector }: AppProps ) {
	const router = useMemo( () => createAppRouter( { queryClient, connector } ), [ connector ] );
	useTextContextMenu();
	return <RouterProvider router={ router } />;
}
