import { QueryClientProvider } from '@tanstack/react-query';
import { CatchBoundary, RouterProvider } from '@tanstack/react-router';
import { StrictMode, Suspense, use, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { AppErrorFallback } from '@/components/app-error-fallback';
import { ConnectorProvider, persistPromise, queryClient } from '@/data/core';
import { useTextContextMenu } from '@/hooks/use-text-context-menu';
import { applyLocale } from '@/lib/apply-locale';
import { createAppRouter } from '@/router/router';
import { AppProviders } from './app-providers';
import '@wordpress/components/build-style/style.css';
import '@wordpress/dataviews/build-style/style.css';
import '@wordpress/theme/design-tokens.css';
import '@/index.css';
import type { Connector } from '@/data/core';

interface AppProps {
	connector: Connector;
}

export function startApp( connector: Connector ) {
	const ready = Promise.all( [ connector.init?.(), applyLocale( connector ), persistPromise ] );
	createRoot( document.getElementById( 'root' )! ).render(
		<StrictMode>
			<ConnectorProvider connector={ connector }>
				<QueryClientProvider client={ queryClient }>
					<CatchBoundary getResetKey={ () => 0 } errorComponent={ AppErrorFallback }>
						<Suspense>
							<App connector={ connector } ready={ ready } />
						</Suspense>
					</CatchBoundary>
				</QueryClientProvider>
			</ConnectorProvider>
		</StrictMode>
	);
}

function App( { connector, ready }: AppProps & { ready: Promise< unknown > } ) {
	// A failed start throws into the boundary above instead of leaving a blank window.
	use( ready );
	return (
		<AppProviders>
			<AppRouter connector={ connector } />
		</AppProviders>
	);
}

function AppRouter( { connector }: AppProps ) {
	const router = useMemo( () => createAppRouter( { queryClient, connector } ), [ connector ] );
	useTextContextMenu();
	return <RouterProvider router={ router } />;
}
