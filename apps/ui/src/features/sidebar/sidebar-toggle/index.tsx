import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import {
	useSidebarCollapsed,
	useSidebarOpen,
	useSidebarHover,
	useToggleSidebar,
} from '@/data/use-sidebar-collapsed';
import { AppMessageCardsDot } from '@/features/notifications';
import { SidebarIcon } from '@/lib/icons';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import styles from './style.module.css';

export function SidebarToggle() {
	const collapsed = ! useSidebarOpen();
	const undocked = useSidebarCollapsed();
	const toggleSidebar = useToggleSidebar();
	const hover = useSidebarHover();
	const control = (
		<Button
			variant="ghost"
			size="icon"
			aria-label={ collapsed || hover.peek ? __( 'Show sidebar' ) : __( 'Hide sidebar' ) }
			aria-expanded={ ! collapsed || hover.peek }
			data-sidebar-toggle
			onClick={ toggleSidebar }
			onPointerEnter={ ( event ) => {
				if ( event.pointerType === 'mouse' ) hover.onEnter();
			} }
			onPointerLeave={ hover.onLeave }
		>
			<SidebarIcon
				className={ styles.icon }
				state={
					hover.peek || ( undocked && ! collapsed ) ? 'flyout' : collapsed ? 'closed' : 'docked'
				}
			/>
		</Button>
	);

	return (
		<span className={ styles.root }>
			{ collapsed || hover.peek ? (
				control
			) : (
				<Tooltip>
					<TooltipTrigger render={ control } />
					<TooltipContent side="bottom">{ __( 'Hide sidebar' ) }</TooltipContent>
				</Tooltip>
			) }
			{ collapsed ? <AppMessageCardsDot /> : null }
		</span>
	);
}

// A header's sidebar toggle. Always mounted so it can grow into place as the
// sidebar collapses, and shrink away as it opens, sliding the rest of the
// header along instead of jumping.
export function HeaderSidebarToggle() {
	const collapsed = useSidebarCollapsed();
	return (
		<span
			className={ clsx( styles.headerSlot, collapsed && styles.headerSlotVisible ) }
			data-sidebar-header-slot
			inert={ ! collapsed }
		>
			<SidebarToggle />
		</span>
	);
}
