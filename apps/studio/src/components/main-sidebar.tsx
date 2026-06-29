import { __ } from '@wordpress/i18n';
import { RunningSites } from 'src/components/running-sites';
import SiteMenu from 'src/components/site-menu';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import AddSite from 'src/modules/add-site';
import { DevelopmentProjectsMenu } from 'src/modules/plugin-development/components/development-projects-menu';
import { useDevelopmentProjects } from 'src/modules/plugin-development/hooks/use-development-projects';

interface MainSidebarProps {
	className?: string;
	style?: React.CSSProperties;
}

export default function MainSidebar( { className, style }: MainSidebarProps ) {
	const { sites: localSites } = useSiteDetails();
	const { isPluginDevelopmentEnabled } = useDevelopmentProjects();
	const hasSidebarItems = localSites.length > 0 || isPluginDevelopmentEnabled;

	return (
		<div
			data-testid="main-sidebar"
			className={ cx( 'text-chrome-inverted relative pt-[10px]', className ) }
			style={ style }
		>
			{ ! hasSidebarItems ? (
				<div className="flex h-full px-[20px] justify-center items-center app-no-drag-region text-center text-[12px] text-a8c-gray-50">
					{ __( 'Your sites and plugin projects will show up here once you add them' ) }
				</div>
			) : (
				<div className="flex flex-col h-full">
					<div
						className={ cx(
							'flex-1 overflow-y-auto sites-scrollbar app-no-drag-region',
							isMac() ? 'ms-4' : 'ms-3'
						) }
					>
						{ localSites.length > 0 && <SiteMenu /> }
						{ isPluginDevelopmentEnabled && <DevelopmentProjectsMenu /> }
					</div>
					<div className="flex flex-col gap-4 pt-5 border-white border-t border-opacity-10 app-no-drag-region">
						<RunningSites />
						<div className={ cx( isMac() ? 'mx-5' : 'mx-4' ) }>
							<AddSite className="min-w-[168px] w-full mb-4" />
						</div>
					</div>
				</div>
			) }
		</div>
	);
}
