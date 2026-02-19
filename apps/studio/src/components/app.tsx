import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
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
import { useSidebarVisibility } from 'src/hooks/use-sidebar-visibility';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Onboarding } from 'src/modules/onboarding';
import { useOnboarding } from 'src/modules/onboarding/hooks/use-onboarding';
import { UserSettings } from 'src/modules/user-settings';
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

					<HStack spacing="0" alignment="left" className="flex-grow">
						<MainSidebar
							className={ cx(
								'h-full transition-all duration-500',
								isSidebarVisible ? 'basis-52 flex-shrink-0' : 'basis-0 !min-w-[10px]'
							) }
						/>
						<main
							data-testid="site-content"
							className="bg-white h-full flex-grow rounded-chrome overflow-hidden z-10"
						>
							<SiteContentTabs />
						</main>
					</HStack>
				</VStack>
			) }
			<UserSettings />
			<WhatsNewModal showModal={ shouldShowWhatsNew } onClose={ closeWhatsNew } />
		</>
	);
}
