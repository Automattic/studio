import { cx } from '../cx';
import { __experimentalVStack as VStack } from '@wordpress/components';
import SiteMenu from './site-menu';
import { isMac } from '../app-globals';

interface MainSidebarProps {
	className?: string;
}

export default function MainSidebar( { className }: MainSidebarProps ) {
	return (
		<VStack
			spacing="0"
			alignment="stretch"
			justify="top"
			className={ cx(
				'text-chrome-inverted',
				isMac() && 'pt-[50px]',
				! isMac() && 'pt-[60px]',
				className
			) }
		>
			<SiteMenu
				className={ cx(
					'app-no-drag-region',
					isMac() && 'ml-sidebar-mac mr-sidebar-mac',
					! isMac() && 'ml-sidebar mr-sidebar'
				) }
			/>
		</VStack>
	);
}
