import { QueryClientProvider } from '@tanstack/react-query';
import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { privateApis } from '@wordpress/theme';
import { Tooltip } from '@wordpress/ui';
import { ConnectorProvider, queryClient } from '@/data/core';
import { AgentRunProvider } from '@/data/queries/use-agent-run';
import { useSyncSessionsWithEvents } from '@/data/queries/use-sessions';
import { useSyncSitesWithEvents } from '@/data/queries/use-sites';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSyncConnectSiteListener } from '@/hooks/use-sync-connect-site-listener';
import { unlock } from '@/lock-unlock';
import { useEffect } from 'react';
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

// Themes the app from the resolved color scheme. Lives inside the connector +
// query providers so it can read the saved color-scheme preference (not just
// the OS setting), which is what makes the in-app dark/light toggle work in the
// browser, where there's no Electron `nativeTheme` to mirror it.
function ThemedApp( { children }: PropsWithChildren ) {
	const colorScheme = useColorScheme();
	const themeColor = colorScheme === 'dark' ? { bg: '#1e1e1e' } : undefined;
	// Drive the CSS color-scheme from the resolved app theme so native controls
	// (the language <select> popup, scrollbars, etc.) match it. Without this they
	// follow prefers-color-scheme, which can differ from the in-app preference.
	useEffect( () => {
		document.documentElement.style.colorScheme = colorScheme;
	}, [ colorScheme ] );
	return (
		<ThemeProvider isRoot color={ themeColor } density="compact">
			<Tooltip.Provider>{ children }</Tooltip.Provider>
		</ThemeProvider>
	);
}

export function AppProviders( { children, connector }: AppProvidersProps ) {
	return (
		<ConnectorProvider connector={ connector }>
			<QueryClientProvider client={ queryClient }>
				<AgentRunProvider>
					<SiteEventsBridge />
					<I18nProvider i18n={ defaultI18n }>
						<ThemedApp>{ children }</ThemedApp>
					</I18nProvider>
				</AgentRunProvider>
			</QueryClientProvider>
		</ConnectorProvider>
	);
}
