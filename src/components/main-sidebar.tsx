import { __ } from '@wordpress/i18n';
import { RunningSites } from 'src/components/running-sites';
import SiteMenu from 'src/components/site-menu';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import AddSite from 'src/modules/add-site';
import VipSiteMenu from 'src/modules/vip/components/vip-site-menu';

interface MainSidebarProps {
	className?: string;
}

export default function MainSidebar( { className }: MainSidebarProps ) {
	const { sites: localSites } = useSiteDetails();
	const hasLocalSites = localSites.length > 0;

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
					{ hasLocalSites ? (
						<SiteMenu />
					) : (
						<div className="flex px-[20px] py-4 justify-center items-center text-center text-[12px] text-a8c-gray-50">
							{ __( 'Your sites will show up here once you create them' ) }
						</div>
					) }
					<VipSiteMenu />
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
