import { QueryClientProvider } from '@tanstack/react-query';
import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { privateApis } from '@wordpress/theme';
import { useEffect } from 'react';
import { ConnectorProvider, queryClient } from '@/data/core';
import { AgentRunProvider } from '@/data/queries/use-agent-run';
import { useSyncSessionsWithEvents } from '@/data/queries/use-sessions';
import { useSyncSitesWithEvents } from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
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
	return null;
}

// Mirrors the saved density preference onto `<html>` so the token overrides
// in `index.css` apply everywhere, including portals mounted on `body` that
// escape the root ThemeProvider's wrapper.
function DensityBridge() {
	const { data: preferences } = useUserPreferences();
	const density = preferences?.density ?? 'compact';
	useEffect( () => {
		document.documentElement.dataset.studioDensity = density;
	}, [ density ] );
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
					<DensityBridge />
					<I18nProvider i18n={ defaultI18n }>
						<ThemeProvider isRoot color={ themeColor } density="compact">
							{ children }
						</ThemeProvider>
					</I18nProvider>
				</AgentRunProvider>
			</QueryClientProvider>
		</ConnectorProvider>
	);
}
