import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import MainSidebar from './main-sidebar';
import { SiteContentTabs } from './site-content-tabs';

export default function App() {
	const { __ } = useI18n();

	return (
		<VStack
			className="h-screen bg-chrome backdrop-blur-3xl py-chrome pr-chrome app-drag-region"
			spacing="0"
		>
			<HStack spacing="0" alignment="left" className="flex-grow">
				<MainSidebar className="basis-52 flex-shrink-0 h-full" />
				<div className="p-8 bg-white overflow-y-auto h-full flex-grow rounded-chrome app-no-drag-region">
					<SiteContentTabs />
				</div>
			</HStack>
		</VStack>
	);
}
