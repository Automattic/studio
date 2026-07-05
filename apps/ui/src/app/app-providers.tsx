import { QueryClientProvider } from '@tanstack/react-query';
import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { privateApis } from '@wordpress/theme';
import { Tooltip } from '@wordpress/ui';
import { ConnectorProvider, queryClient } from '@/data/core';
import { AgentRunProvider } from '@/data/queries/use-agent-run';
import { useSyncAppUpdateStatus } from '@/data/queries/use-app-update';
import { useChatNotifications } from '@/data/queries/use-chat-notifications';
import { useLiveSyncActivityMonitor } from '@/data/queries/use-live-sync-monitor';
import { useSyncSessionsWithEvents } from '@/data/queries/use-sessions';
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
	useSyncSessionsWithEvents();
	useSyncConnectSiteListener();
	useLiveSyncActivityMonitor();
	useSyncAppUpdateStatus();
	useChatNotifications();
	return null;
}

export function AppProviders( { children, connector }: AppProvidersProps ) {
	const colorScheme = usePrefersColorScheme();
	const themeColor = colorScheme === 'dark' ? { bg: '#1e1e1e' } : undefined;

	return (
		<ConnectorProvider connector={ connector }>
			<QueryClientProvider client={ queryClient }>
				<AgentRunProvider>
					<SiteEventsBridge />
					<I18nProvider i18n={ defaultI18n }>
						<ThemeProvider isRoot color={ themeColor } density="compact">
							<Tooltip.Provider>{ children }</Tooltip.Provider>
						</ThemeProvider>
					</I18nProvider>
				</AgentRunProvider>
			</QueryClientProvider>
		</ConnectorProvider>
	);
}
