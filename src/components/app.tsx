import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { useLocalizationSupport } from '../hooks/use-localization-support';
import { useOnboarding } from '../hooks/use-onboarding';
import { useSidebarVisibility } from '../hooks/use-sidebar-visibility';
import { isWindows } from '../lib/app-globals';
import { cx } from '../lib/cx';
import MainSidebar from './main-sidebar';
import Onboarding from './onboarding';
import { SiteContentTabs } from './site-content-tabs';
import TopBar from './top-bar';
import UserSettings from './user-settings';
import WindowsTitlebar from './windows-titlebar';

export default function App() {
	useLocalizationSupport();
	const { needsOnboarding } = useOnboarding();
	const { isSidebarVisible, toggleSidebar } = useSidebarVisibility();

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
						<div className="pl-20 flex-shrink-0">
							<TopBar onToggleSidebar={ toggleSidebar } />
						</div>
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
