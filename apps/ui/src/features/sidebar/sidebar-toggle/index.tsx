import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@studio/ds';
import { WorkspaceNavigationIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { useContext } from 'react';
import {
	SidebarHeaderActionContext,
	useSidebarCollapsed,
	useSidebarOpen,
	useSidebarHover,
	useToggleSidebar,
} from '@/data/use-sidebar-collapsed';
import styles from './style.module.css';

function SidebarToggle() {
	const collapsed = ! useSidebarOpen();
	const toggleSidebar = useToggleSidebar();
	const hover = useSidebarHover();
	const label = collapsed || hover.peek ? __( 'Show sidebar' ) : __( 'Hide sidebar' );
	const control = (
		<Button
			variant="ghost"
			highlightOnToggle={ false }
			size="icon-sm"
			aria-label={ label }
			aria-expanded={ ! collapsed || hover.peek }
			data-sidebar-toggle
			onClick={ toggleSidebar }
		>
			<WorkspaceNavigationIcon glyph="panel" />
		</Button>
	);

	return (
		<span className={ styles.root }>
			<Tooltip>
				<TooltipTrigger render={ control } />
				{ ! hover.peek && <TooltipContent side="bottom">{ label }</TooltipContent> }
			</Tooltip>
		</span>
	);
}

export function HeaderSidebarToggle() {
	const collapsed = useSidebarCollapsed();
	const action = useContext( SidebarHeaderActionContext );
	return (
		<span className={ styles.headerSlot } data-sidebar-header-slot>
			<SidebarToggle />
			{ collapsed ? action : null }
		</span>
	);
}
