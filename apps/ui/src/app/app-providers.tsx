import { QueryClientProvider } from '@tanstack/react-query';
import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { privateApis } from '@wordpress/theme';
import { Tooltip } from '@wordpress/ui';
import { useEffect } from 'react';
import { CoachmarkAnchorProvider } from '@/components/coachmarks/anchor-registry';
import { CoachmarkProvider } from '@/components/coachmarks/coachmark-provider';
import { DevMessageLab } from '@/components/dev-message-lab';
import { OnboardingGuideProvider } from '@/components/onboarding-guide/use-onboarding-guide';
import { ConnectorProvider, queryClient } from '@/data/core';
import { useOnboardingEvents } from '@/data/onboarding/use-onboarding-events';
import { AgentRunProvider } from '@/data/queries/use-agent-run';
import { useSyncAppUpdateStatus } from '@/data/queries/use-app-update';
import { useChatNotifications } from '@/data/queries/use-chat-notifications';
import { useLiveSyncActivityMonitor } from '@/data/queries/use-live-sync-monitor';
import { useSyncSessionsWithEvents } from '@/data/queries/use-sessions';
import { useSyncSitesWithEvents } from '@/data/queries/use-sites';
import { useColorScheme } from '@/hooks/use-color-scheme';
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

// Onboarding completion watchers + one-shot publish coachmark. Rendered inside
// CoachmarkProvider (below) because it drives the coachmark API.
function OnboardingBridge() {
	useOnboardingEvents();
	return null;
}

// Themes the app from the resolved color scheme. Lives inside the connector +
// query providers so it can read the saved color-scheme preference (not just
// the OS setting), which is what makes the in-app dark/light toggle work in the
// browser, where there's no Electron `nativeTheme` to mirror it.
function ThemedApp( { children }: PropsWithChildren ) {
	const colorScheme = useColorScheme();
	const themeColor = colorScheme === 'dark' ? { bg: '#1e1e1e' } : undefined;
	useEffect( () => {
		document.documentElement.style.colorScheme = colorScheme;
	}, [ colorScheme ] );
	return (
		<ThemeProvider isRoot color={ themeColor } density="compact">
			<Tooltip.Provider>
				<CoachmarkAnchorProvider>
					<CoachmarkProvider>
						<OnboardingGuideProvider>
							<OnboardingBridge />
							{ /* Dev-only QA panel for firing toasts/cards on demand. */ }
							{ import.meta.env.DEV ? <DevMessageLab /> : null }
							{ children }
						</OnboardingGuideProvider>
					</CoachmarkProvider>
				</CoachmarkAnchorProvider>
			</Tooltip.Provider>
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
