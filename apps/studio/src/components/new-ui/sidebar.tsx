import SiteMenu from 'src/components/site-menu';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';

interface SidebarProps {
	className?: string;
}

export function Sidebar( { className }: SidebarProps ) {
	const { sites, stopAllRunningSites, startAllStoppedSites, loadingServer } = useSiteDetails();

	const runningSites = sites.filter( ( site ) => site.running );
	const realSites = sites.filter( ( site ) => ! site.isAddingSite );
	const hasLoadingSites = Object.values( loadingServer ).some( Boolean );
	const anyRunning = runningSites.length > 0;

	return (
		<nav className={ cx( 'flex flex-col flex-1 overflow-hidden', className ) }>
			{ /* Tasks section — placeholder */ }
			<div className="flex flex-col p-2 gap-2">
				<header className="flex items-center justify-between px-4">
					<h3 className="a8c-label text-chrome-text">Tasks</h3>
				</header>
				<div className="text-chrome-text-tertiary px-4">No tasks yet</div>
			</div>

			{ /* Flexible spacer — pushes sites to the bottom */ }
			<div className="flex-1" />

			{ /* Sites section */ }
			<div className="flex flex-col">
				<header className="flex items-center justify-between px-4">
					<h3 className="a8c-label text-chrome-text">Projects ({ sites.length })</h3>
					{ realSites.length > 0 && (
						<button
							disabled={ hasLoadingSites }
							onClick={ anyRunning ? stopAllRunningSites : startAllStoppedSites }
							className="text-chrome-text-secondary hover:text-chrome-text text-xs disabled:opacity-50 transition-colors"
						>
							{ anyRunning ? 'Stop all' : 'Start all' }
						</button>
					) }
				</header>
				<div className="flex-1 overflow-y-auto sites-scrollbar p-2">
					<SiteMenu />
				</div>
			</div>
		</nav>
	);
}
