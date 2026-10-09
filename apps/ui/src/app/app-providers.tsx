import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { ThemeProvider } from '@wordpress/theme';
import { Tooltip } from '@wordpress/ui';
import { useEffect } from 'react';
import { appThemeColor } from '@/components/app-theme-scope';
import { OnboardingGuideProvider } from '@/components/onboarding-guide/use-onboarding-guide';
import { AgentRunProvider } from '@/data/queries/use-agent-run';
import { useSyncAppUpdateStatus } from '@/data/queries/use-app-update';
import { useSyncSessionsWithEvents } from '@/data/queries/use-sessions';
import { useAutoStartSites, useSyncSitesWithEvents } from '@/data/queries/use-sites';
import { useSyncSnapshotsWithEvents } from '@/data/queries/use-snapshots';
import { useSyncActivityEvents } from '@/data/queries/use-sync-site';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSyncConnectSiteListener } from '@/hooks/use-sync-connect-site-listener';
import type { PropsWithChildren } from 'react';

function SiteEventsBridge() {
	useSyncSitesWithEvents();
	useSyncSnapshotsWithEvents();
	useSyncSessionsWithEvents();
	useSyncActivityEvents();
	useSyncConnectSiteListener();
	useAutoStartSites();
	useSyncAppUpdateStatus();
	return null;
}

// Themes the app from the resolved color scheme. Lives inside the connector +
// query providers so it can read the saved color-scheme preference (not just
// the OS setting), which is what makes the in-app dark/light toggle work in the
// browser, where there's no Electron `nativeTheme` to mirror it.
function ThemedApp( { children }: PropsWithChildren ) {
	const colorScheme = useColorScheme();
	const themeColor = appThemeColor( colorScheme );
	useEffect( () => {
		document.documentElement.style.colorScheme = colorScheme;
		document.documentElement.dataset.colorScheme = colorScheme;
	}, [ colorScheme ] );
	return (
		<ThemeProvider isRoot color={ themeColor }>
			<Tooltip.Provider>
				<OnboardingGuideProvider>{ children }</OnboardingGuideProvider>
			</Tooltip.Provider>
		</ThemeProvider>
	);
}

export function AppProviders( { children }: PropsWithChildren ) {
	return (
		<AgentRunProvider>
			<SiteEventsBridge />
			<I18nProvider i18n={ defaultI18n }>
				<ThemedApp>{ children }</ThemedApp>
			</I18nProvider>
		</AgentRunProvider>
	);
}
