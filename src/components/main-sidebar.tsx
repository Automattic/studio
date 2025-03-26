import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import AddSite from 'src/components/add-site';
import { RunningSites } from 'src/components/running-sites';
import SiteMenu from 'src/components/site-menu';
import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { WhatsNewModal } from '../modules/whats-new/whats-new-modal';

interface MainSidebarProps {
	className?: string;
}

export default function MainSidebar( { className }: MainSidebarProps ) {
	const [ showWhatsNew, setShowWhatsNew ] = useState( false );

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
						isMac() ? 'ms-4' : 'ms-3'
					) }
				>
					<SiteMenu />
				</div>
				<div className="flex flex-col gap-4 pt-5 border-white border-t border-opacity-10 app-no-drag-region">
					<RunningSites />
					<div className={ cx( isMac() ? 'mx-5' : 'mx-4' ) }>
						<AddSite className="min-w-[168px] w-full mb-4" />
						<button
							onClick={ () => setShowWhatsNew( true ) }
							className="text-white opacity-75 hover:opacity-100 text-sm w-full text-left px-2 py-1"
						>
							What's New
						</button>
					</div>
				</div>
			</div>
			{ showWhatsNew && <WhatsNewModal /> }
		</div>
	);
}
