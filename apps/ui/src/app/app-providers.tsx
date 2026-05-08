import { QueryClientProvider } from '@tanstack/react-query';
import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { privateApis } from '@wordpress/theme';
import { ConnectorProvider, queryClient } from '@/data/core';
import { useSyncSitesWithEvents } from '@/data/queries/use-sites';
import { usePrefersColorScheme } from '@/hooks/use-prefers-color-scheme';
import { useSyncConnectSiteListener } from '@/hooks/use-sync-connect-site-listener';
import { unlock } from '@/lock-unlock';
import type { Connector } from '@/data/core';
import type { PropsWithChildren } from 'react';

const { ThemeProvider } = unlock( privateApis );

interface AppProvidersProps extends PropsWithChildren {
	connector: Connector;
}

function SiteEventsBridge() {
	useSyncSitesWithEvents();
	useSyncConnectSiteListener();
	return null;
}

export function AppProviders( { children, connector }: AppProvidersProps ) {
	const colorScheme = usePrefersColorScheme();
	const themeColor = colorScheme === 'dark' ? { bg: '#1e1e1e' } : undefined;

	return (
		<ConnectorProvider connector={ connector }>
			<QueryClientProvider client={ queryClient }>
				<SiteEventsBridge />
				<I18nProvider i18n={ defaultI18n }>
					<ThemeProvider isRoot color={ themeColor } density="compact">
						{ children }
					</ThemeProvider>
				</I18nProvider>
			</QueryClientProvider>
		</ConnectorProvider>
	);
}
