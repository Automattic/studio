import { Icon } from '@wordpress/components';
import { cog } from '@wordpress/icons';
import { Gravatar } from 'src/components/gravatar';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ProjectList } from './project-list';

interface SidebarProps {
	className?: string;
}

export function Sidebar( { className }: SidebarProps ) {
	const { isAuthenticated } = useAuth();

	return (
		<nav className={ cx( 'flex flex-col flex-1 overflow-hidden', className ) }>
			<div className="flex-1 min-h-0 overflow-y-auto p-2 gap-2">
				<ProjectList />
			</div>

			<footer className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-t border-chrome-border">
				<button
					onClick={ () =>
						getIpcApi().openSettingsWindow( isAuthenticated ? 'account' : 'general' )
					}
					className="flex items-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme rounded-full"
				>
					<Gravatar size={ 18 } className="fill-chrome-text-tertiary" />
				</button>

				<Tooltip text={ `Settings (${ isMac() ? '⌘,' : 'Ctrl+,' })` }>
					<button
						onClick={ () => getIpcApi().openSettingsWindow() }
						className="text-chrome-text-tertiary hover:text-chrome-text transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme rounded"
					>
						<Icon icon={ cog } size={ 24 } className="fill-current" />
					</button>
				</Tooltip>
			</footer>
		</nav>
	);
}
