import { __experimentalVStack as VStack } from '@wordpress/components';
import { useEffect } from 'react';
import MacTitlebar from 'src/components/mac-titlebar';
import MainSidebar from 'src/components/main-sidebar';
import { NoStudioSites } from 'src/components/no-studio-sites';
import { SiteContentTabs } from 'src/components/site-content-tabs';
import TopBar from 'src/components/top-bar';
import WindowsTitlebar from 'src/components/windows-titlebar';
import { useListenDeepLinkConnection } from 'src/hooks/sync-sites/use-listen-deep-link-connection';
import { useAuth } from 'src/hooks/use-auth';
import { useLocalizationSupport } from 'src/hooks/use-localization-support';
import { useSettingsPanel } from 'src/hooks/use-settings-panel';
import { useSidebarVisibility } from 'src/hooks/use-sidebar-visibility';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Onboarding } from 'src/modules/onboarding';
import { useOnboarding } from 'src/modules/onboarding/hooks/use-onboarding';
import { SettingsPanel } from 'src/modules/user-settings/components/settings-panel';
import { WhatsNewModal, useWhatsNew } from 'src/modules/whats-new';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { selectOnboardingLoading } from 'src/stores/onboarding-slice';
import { syncOperationsThunks } from 'src/stores/sync';
import 'src/index.css';

export default function App() {
	useLocalizationSupport();
	const { needsOnboarding } = useOnboarding();
	const isOnboardingLoading = useRootSelector( selectOnboardingLoading );
	const { isSidebarVisible, toggleSidebar } = useSidebarVisibility();
	const { isSettingsOpen } = useSettingsPanel();
	const { showWhatsNew, closeWhatsNew } = useWhatsNew();
	const { sites: localSites, loadingSites } = useSiteDetails();
	const isEmpty = ! loadingSites && ! localSites.length;
	const shouldShowWhatsNew = showWhatsNew && ! isEmpty;
	const { client } = useAuth();
	const dispatch = useAppDispatch();

	// Initialize sync states from in-progress server operations
	useEffect( () => {
		if ( client ) {
			void dispatch( syncOperationsThunks.initializeSyncStates( { client } ) );
		}
	}, [ client, dispatch ] );

	useListenDeepLinkConnection();

	useEffect( () => {
		void getIpcApi().setupAppMenu( { needsOnboarding } );
	}, [ needsOnboarding ] );

	if ( isOnboardingLoading ) {
		return null;
	}

	return (
		<>
			{ needsOnboarding || isEmpty ? (
				<VStack
					className={ cx( 'h-screen backdrop-blur-3xl app-drag-region select-none' ) }
					spacing="0"
				>
					{ isWindows() && <WindowsTitlebar className="h-titlebar-win flex-shrink-0" /> }
					{ needsOnboarding ? <Onboarding /> : <NoStudioSites /> }
				</VStack>
			) : (
				<VStack
					className={ cx(
						'h-screen bg-chrome backdrop-blur-3xl ltr:pr-chrome rtl:pl-chrome app-drag-region select-none',
						isWindows() && 'pt-0 pb-chrome',
						! isWindows() && 'py-chrome'
					) }
					spacing="0"
				>
					{ isWindows() ? (
						<WindowsTitlebar className="h-titlebar-win flex-shrink-0">
							<TopBar onToggleSidebar={ toggleSidebar } />
						</WindowsTitlebar>
					) : (
						<MacTitlebar className="flex-shrink-0">
							<TopBar onToggleSidebar={ toggleSidebar } />
						</MacTitlebar>
					) }

					<div className={ cx(
						'relative flex-grow flex overflow-hidden transition-[padding] duration-300',
						! isSidebarVisible && ! isSettingsOpen && 'ltr:pl-chrome rtl:pr-chrome'
					) }>
						{ /* Settings surface: lives behind sidebar + frame on the chrome */ }
						{ isSettingsOpen && <SettingsPanel /> }

						<MainSidebar
							className={ cx(
								'relative z-[1] h-full basis-52 flex-shrink-0 bg-chrome transition-[transform,margin] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
								isSettingsOpen
									? 'settings-slide-left'
									: isSidebarVisible
										? 'translate-x-0 ml-0'
										: '-translate-x-full -ml-52'
							) }
						/>
						<main
							data-testid="site-content"
							className={ cx(
								'relative z-[1] bg-frame text-frame-text h-full flex-grow rounded-chrome overflow-hidden settings-slideable',
								isSettingsOpen && 'settings-slide-right'
							) }
						>
							<SiteContentTabs />
						</main>
					</div>
				</VStack>
			) }
			<WhatsNewModal showModal={ shouldShowWhatsNew } onClose={ closeWhatsNew } />
		</>
	);
}
