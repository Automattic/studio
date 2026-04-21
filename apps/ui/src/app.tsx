import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { privateApis } from '@wordpress/theme';
import * as Tooltip from '@/components/tooltip';
import { ConnectorProvider, queryClient } from '@/data/core';
import { useSyncSitesWithEvents } from '@/data/queries/use-sites';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import { useSyncConnectSiteListener } from '@/hooks/use-sync-connect-site-listener';
import { unlock } from '@/lock-unlock';
import { createAppRouter } from '@/router/router';
import '@wordpress/components/build-style/style.css';
import '@wordpress/dataviews/build-style/style.css';
import '@wordpress/theme/design-tokens.css';
import '@/index.css';
import type { Connector } from '@/data/core';

const { ThemeProvider } = unlock( privateApis );

interface AppProps {
	connector: Connector;
}

function SiteEventsBridge() {
	useSyncSitesWithEvents();
	useSyncConnectSiteListener();
	return null;
}

export function App( { connector }: AppProps ) {
	const router = createAppRouter( { queryClient, connector } );
	const colorScheme = usePrefersColorScheme();
	const themeColor = colorScheme === 'dark' ? { bg: '#1e1e1e' } : undefined;

	return (
		<ConnectorProvider connector={ connector }>
			<QueryClientProvider client={ queryClient }>
				<SiteEventsBridge />
				<I18nProvider i18n={ defaultI18n }>
					<ThemeProvider isRoot color={ themeColor } density="compact">
						{ /* A shared provider keeps the tooltip delay consistent across
							every consumer (including @wordpress/ui's IconButton, which
							wraps its own Provider with delay=0 — those nest fine). */ }
						<Tooltip.Provider delay={ 250 }>
							<RouterProvider router={ router } />
						</Tooltip.Provider>
					</ThemeProvider>
				</I18nProvider>
			</QueryClientProvider>
		</ConnectorProvider>
	);
}
