import { Button } from '@wordpress/components';
import { chevronRight, Icon, plus } from '@wordpress/icons';
import { useState } from 'react';
import SiteMenu from 'src/components/site-menu';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { TaskList } from './tasks/task-list';

interface SidebarProps {
	className?: string;
}

export function Sidebar( { className }: SidebarProps ) {
	const { sites, stopAllRunningSites, startAllStoppedSites, loadingServer } = useSiteDetails();
	const [ projectsOpen, setProjectsOpen ] = useState( true );

	const runningSites = sites.filter( ( site ) => site.running );
	const realSites = sites.filter( ( site ) => ! site.isAddingSite );
	const hasLoadingSites = Object.values( loadingServer ).some( Boolean );
	const anyRunning = runningSites.length > 0;

	return (
		<nav className={ cx( 'flex flex-col flex-1 overflow-hidden', className ) }>
			{ /* Tasks section */ }
			<div className="flex flex-col p-2 gap-2">
				<TaskList />
			</div>

			{ /* Flexible spacer — pushes sites to the bottom */ }
			<div className="flex-1" />

			{ /* Sites section */ }
			<div className="flex flex-col border-t border-chrome-border">
				<header className="flex items-center justify-between px-4 py-3">
					<button
						onClick={ () => setProjectsOpen( ! projectsOpen ) }
						className="flex items-center gap-1 a8c-label text-chrome-text"
					>
						<span>Projects</span>
						<Icon
							icon={ chevronRight }
							size={ 16 }
							className={ cx(
								'transition-transform duration-200 fill-chrome-text',
								projectsOpen ? 'rotate-90' : 'rotate-0'
							) }
						/>
					</button>
					{ projectsOpen
						? realSites.length > 0 && (
								<button
									disabled={ hasLoadingSites }
									onClick={ anyRunning ? stopAllRunningSites : startAllStoppedSites }
									className="text-chrome-text-secondary hover:text-chrome-text text-xs disabled:opacity-50 transition-colors"
								>
									{ anyRunning ? 'Stop all' : 'Start all' }
								</button>
						  )
						: runningSites.length > 0 && (
								<span className="text-chrome-text-tertiary text-xs">
									{ runningSites.length } running
								</span>
						  ) }
				</header>
				<div
					className={ cx(
						'grid transition-[grid-template-rows] duration-200 ease-in-out',
						projectsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
					) }
				>
					<div className="overflow-hidden">
						<div className="flex-1 overflow-y-auto sites-scrollbar p-2 pb-0">
							<SiteMenu />
						</div>
						<div className="px-2 pb-4">
							<Button
								icon={ plus }
								onClick={ () => getIpcApi().openAddSiteWindow() }
								className="!w-full !text-chrome-text-secondary hover:!text-chrome-text !text-xs !px-2 !py-2 !justify-start"
								size="compact"
							>
								Add site
							</Button>
						</div>
					</div>
				</div>
			</div>
		</nav>
	);
}
