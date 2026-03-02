import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { useEffect } from 'react';
import MacTitlebar from 'src/components/mac-titlebar';
import { MainContent } from 'src/components/main-content';
import MainSidebar from 'src/components/main-sidebar';
import { NoStudioSites } from 'src/components/no-studio-sites';
import TopBar from 'src/components/top-bar';
import WindowsTitlebar from 'src/components/windows-titlebar';
import { useLocalizationSupport } from 'src/hooks/use-localization-support';
import { useSidebarVisibility } from 'src/hooks/use-sidebar-visibility';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { AddonAppProviders } from 'src/modules/addons/addon-app-providers';
import { EnabledAddonsProvider } from 'src/modules/addons/enabled-addons-context';
import { Onboarding } from 'src/modules/onboarding';
import { useOnboarding } from 'src/modules/onboarding/hooks/use-onboarding';
import { UserSettings } from 'src/modules/user-settings';
import { WhatsNewModal, useWhatsNew } from 'src/modules/whats-new';
import { useRootSelector } from 'src/stores';
import { selectOnboardingLoading } from 'src/stores/onboarding-slice';
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

	useEffect( () => {
		void getIpcApi().setupAppMenu( { needsOnboarding } );
	}, [ needsOnboarding ] );

	if ( isOnboardingLoading ) {
		return null;
	}

	return (
		<EnabledAddonsProvider>
			<AddonAppProviders>
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
									<MainContent />
								</main>
							</HStack>
						</VStack>
					) }
					<UserSettings />
					<WhatsNewModal showModal={ shouldShowWhatsNew } onClose={ closeWhatsNew } />
				</>
			</AddonAppProviders>
		</EnabledAddonsProvider>
	);
}
