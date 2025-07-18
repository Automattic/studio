import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect } from 'react';
import { DynamicStylesheet } from 'src/components/dynamic-stylesheet';
import MacTitlebar from 'src/components/mac-titlebar';
import MainSidebar from 'src/components/main-sidebar';
import Onboarding from 'src/components/onboarding';
import { SiteContentTabs } from 'src/components/site-content-tabs';
import TopBar from 'src/components/top-bar';
import WindowsTitlebar from 'src/components/windows-titlebar';
import { useLocalizationSupport } from 'src/hooks/use-localization-support';
import { useOnboarding } from 'src/hooks/use-onboarding';
import { useSidebarVisibility } from 'src/hooks/use-sidebar-visibility';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { UserSettings } from 'src/modules/user-settings';
import { WhatsNewModal, useWhatsNew } from 'src/modules/whats-new';
import 'src/index.css';

export default function App() {
	useLocalizationSupport();
	const { needsOnboarding } = useOnboarding();
	const { isSidebarVisible, toggleSidebar } = useSidebarVisibility();
	const { showWhatsNew, closeWhatsNew } = useWhatsNew();
	const i18n = useI18n();

	useEffect( () => {
		void getIpcApi().setupAppMenu( { needsOnboarding } );
	}, [ needsOnboarding ] );

	return (
		<>
			<DynamicStylesheet
				id="wordpress-components-style"
				href={
					i18n?.isRTL()
						? '../main_window/styles/wordpress-components-style-rtl.css'
						: '../main_window/styles/wordpress-components-style.css'
				}
			/>
			<DynamicStylesheet id="main-window-style" href={ '../main_window.css' } />

			{ needsOnboarding ? (
				<VStack
					className={ cx( 'h-screen backdrop-blur-3xl app-drag-region select-none' ) }
					spacing="0"
				>
					{ isWindows() && <WindowsTitlebar className="h-titlebar-win flex-shrink-0" /> }
					<Onboarding />
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
			<WhatsNewModal showModal={ showWhatsNew } onClose={ closeWhatsNew } />
		</>
	);
}
