import { cx } from 'src/lib/cx';
import { ProjectList } from './project-list';

interface SidebarProps {
	className?: string;
}

export function Sidebar( { className }: SidebarProps ) {
	return (
		<nav className={ cx( 'flex flex-col flex-1 overflow-hidden', className ) }>
			<div className="flex-1 min-h-0 overflow-y-auto p-2 gap-2">
				<ProjectList />
			</div>
		</nav>
	);
}
