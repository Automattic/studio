import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { useLocalizationSupport } from '../hooks/use-localization-support';
import { isWindows } from '../lib/app-globals';
import { cx } from '../lib/cx';
import MainSidebar from './main-sidebar';
import { SiteContentTabs } from './site-content-tabs';
import WindowsTitlebar from './windows-titlebar';

export default function App() {
	useLocalizationSupport();

	return (
		<VStack
			className={ cx(
				'h-screen bg-chrome backdrop-blur-3xl pr-chrome app-drag-region select-none',
				isWindows() && 'pt-0 pb-chrome',
				! isWindows() && 'py-chrome'
			) }
			spacing="0"
		>
			{ isWindows() && <WindowsTitlebar className="h-titlebar-win" /> }
			<HStack spacing="0" alignment="left" className="flex-grow">
				<MainSidebar className="basis-52 flex-shrink-0 h-full" />
				<div
					data-testid="site-content"
					className="p-8 bg-white overflow-y-auto h-full flex-grow rounded-chrome app-no-drag-region"
				>
					<SiteContentTabs />
				</div>
			</HStack>
		</VStack>
	);
}
