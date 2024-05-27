import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { useLocalizationSupport } from '../hooks/use-localization-support';
import { useOnboarding } from '../hooks/use-onboarding';
import { isWindows } from '../lib/app-globals';
import { cx } from '../lib/cx';
import MainSidebar from './main-sidebar';
import Onboarding from './onboarding';
import { SiteContentTabs } from './site-content-tabs';
import WindowsTitlebar from './windows-titlebar';

export default function App() {
	useLocalizationSupport();
	const { needsOnboarding } = useOnboarding();

	if ( needsOnboarding ) {
		return (
			<VStack
				className={ cx( 'h-screen backdrop-blur-3xl app-drag-region select-none' ) }
				spacing="0"
			>
				{ isWindows() && <WindowsTitlebar className="h-titlebar-win flex-shrink-0" /> }
				<Onboarding />
			</VStack>
		);
	}

	return (
		<VStack
			className={ cx(
				'h-screen bg-chrome backdrop-blur-3xl ltr:pr-chrome rtl:pl-chrome app-drag-region select-none',
				isWindows() && 'pt-0 pb-chrome',
				! isWindows() && 'py-chrome'
			) }
			spacing="0"
		>
			{ isWindows() && (
				<WindowsTitlebar className="h-titlebar-win flex-shrink-0 app-no-drag-region" />
			) }
			<HStack spacing="0" alignment="left" className="flex-grow">
				<MainSidebar className="basis-52 flex-shrink-0 h-full" />
				<main
					data-testid="site-content"
					className="py-8 pr-8 bg-white overflow-y-auto h-full flex-grow rounded-chrome"
				>
					<SiteContentTabs />
				</main>
			</HStack>
		</VStack>
	);
}
