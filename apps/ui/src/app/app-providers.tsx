import { QueryClientProvider } from '@tanstack/react-query';
import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { useLayoutEffect } from 'react';
import { AgentRunProvider } from '@/data/agent-runs/provider';
import { ConnectorProvider, queryClient } from '@/data/core';
import { useColorScheme } from '@/data/host/use-color-scheme';
import { useSyncAppUpdateStatus } from '@/data/queries/use-app-update';
import { useAuthChangeToasts } from '@/data/queries/use-auth-user';
import { useSyncSessionsWithEvents } from '@/data/queries/use-sessions';
import { useAutoStartSites, useSyncSitesWithEvents } from '@/data/queries/use-sites';
import { useSyncSnapshotsWithEvents } from '@/data/queries/use-snapshots';
import { useSyncActivityEvents } from '@/data/queries/use-sync-site';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { OnboardingGuideProvider } from '@/features/onboarding';
import { useSyncConnectSiteListener } from '@/features/sync';
import { applyTheme } from '@/lib/theme';
import { TooltipProvider } from '@/lib/ui';
import type { Connector } from '@/data/core';
import type { PropsWithChildren } from 'react';

interface AppProvidersProps extends PropsWithChildren {
	connector: Connector;
}

function SiteEventsBridge() {
	useSyncSitesWithEvents();
	useSyncSnapshotsWithEvents();
	useSyncSessionsWithEvents();
	useSyncActivityEvents();
	useSyncConnectSiteListener();
	useAutoStartSites();
	useSyncAppUpdateStatus();
	useAuthChangeToasts();
	return null;
}

// Themes the app from the resolved color scheme and the appearance tint. Lives
// inside the connector + query providers so it can read the saved color-scheme
// preference (not just the OS setting), which is what makes the in-app
// dark/light toggle work in the browser, where there's no Electron
// `nativeTheme` to mirror it.
function ThemedApp( { children }: PropsWithChildren ) {
	const colorScheme = useColorScheme();
	const { accentColor, tintIntensity, contrast } = useUserPreferences().data ?? {};
	useLayoutEffect(
		() => applyTheme( colorScheme, { accentColor, tintIntensity, contrast } ),
		[ colorScheme, accentColor, tintIntensity, contrast ]
	);
	return (
		<TooltipProvider>
			<OnboardingGuideProvider>{ children }</OnboardingGuideProvider>
		</TooltipProvider>
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
