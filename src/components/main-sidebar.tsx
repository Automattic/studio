import { __ } from '@wordpress/i18n';
import { isMac } from '../lib/app-globals';
import { cx } from '../lib/cx';
import AddSite from './add-site';
import { RunningSites } from './running-sites';
import SiteMenu from './site-menu';

interface MainSidebarProps {
	className?: string;
}

export default function MainSidebar( { className }: MainSidebarProps ) {
	return (
		<div
			data-testid="main-sidebar"
			className={ cx(
				'text-chrome-inverted relative',
				isMac() && 'pt-[10px]',
				! isMac() && 'pt-[38px]',
				className
			) }
		>
			<div className="flex flex-col h-full">
				<div
					className={ cx(
						'flex-1 overflow-y-auto sites-scrollbar app-no-drag-region',
						isMac() ? 'ml-4' : 'ml-3'
					) }
				>
					<SiteMenu />
				</div>
				<div className="flex flex-col gap-4 pt-5 border-white border-t border-opacity-10 app-no-drag-region">
					<RunningSites />
					<div className={ cx( isMac() ? 'mx-5' : 'mx-4' ) }>
						<AddSite className="min-w-[168px] w-full mb-4" />
					</div>
				</div>
			</div>
		</div>
	);
}
