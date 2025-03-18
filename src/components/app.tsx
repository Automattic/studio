import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { useEffect } from 'react';
import MacTitlebar from 'src/components/mac-titlebar';
import MainSidebar from 'src/components/main-sidebar';
import Onboarding from 'src/components/onboarding';
import { SiteContentTabs } from 'src/components/site-content-tabs';
import TopBar from 'src/components/top-bar';
import UserSettings from 'src/components/user-settings';
import WindowsTitlebar from 'src/components/windows-titlebar';
import { useLocalizationSupport } from 'src/hooks/use-localization-support';
import { useOnboarding } from 'src/hooks/use-onboarding';
import { useSidebarVisibility } from 'src/hooks/use-sidebar-visibility';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';

export default function App() {
	useLocalizationSupport();
	const { needsOnboarding } = useOnboarding();
	const { isSidebarVisible, toggleSidebar } = useSidebarVisibility();

	useEffect( () => {
		void getIpcApi().setupAppMenu( { needsOnboarding } );
	}, [ needsOnboarding ] );

	return (
		<>
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
		</>
	);
}
