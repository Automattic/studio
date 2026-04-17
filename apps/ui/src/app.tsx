import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { privateApis } from '@wordpress/theme';
import { ConnectorProvider, queryClient } from '@/data/core';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import { unlock } from '@/lock-unlock';
import { createAppRouter } from '@/router/router';
import '@wordpress/theme/design-tokens.css';
import '@/index.css';
import type { Connector } from '@/data/core';

const { ThemeProvider } = unlock( privateApis );

interface AppProps {
	connector: Connector;
}

export function App( { connector }: AppProps ) {
	const router = createAppRouter( { queryClient, connector } );
	const colorScheme = usePrefersColorScheme();
	const themeColor = colorScheme === 'dark' ? { bg: '#1e1e1e' } : undefined;

	return (
		<ConnectorProvider connector={ connector }>
			<QueryClientProvider client={ queryClient }>
				<ThemeProvider isRoot color={ themeColor }>
					<RouterProvider router={ router } />
				</ThemeProvider>
			</QueryClientProvider>
		</ConnectorProvider>
	);
}
