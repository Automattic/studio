import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import {
	useSidebarCollapsed,
	useSidebarOpen,
	useToggleSidebar,
} from '@/data/use-sidebar-collapsed';
import { AppMessageCardsDot } from '@/features/notifications';
import { CollapsedSiteSwitcher } from '@/features/sidebar/collapsed-site-switcher';
import { SidebarIcon } from '@/lib/icons';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import styles from './style.module.css';

export function SidebarToggle() {
	const collapsed = ! useSidebarOpen();
	const toggleSidebar = useToggleSidebar();
	// Not IconButton: while collapsed this is the site switcher's trigger, and
	// IconButton's unconditional tooltip would fight the hover-opened popover.
	const control = (
		<Button
			variant="ghost"
			size="icon"
			aria-label={ collapsed ? __( 'Show sidebar' ) : __( 'Hide sidebar' ) }
			aria-expanded={ collapsed ? undefined : true }
			data-sidebar-toggle
			onClick={ toggleSidebar }
		>
			<SidebarIcon expanded={ ! collapsed } />
		</Button>
	);

	return (
		<span className={ styles.root }>
			{ collapsed ? (
				<CollapsedSiteSwitcher onToggleSidebar={ toggleSidebar } trigger={ control } />
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
			inert={ ! collapsed }
		>
			<SidebarToggle />
		</span>
	);
}
