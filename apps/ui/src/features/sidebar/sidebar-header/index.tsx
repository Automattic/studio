import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { MenuIcon } from 'lucide-react';
import { useConnector } from '@/data/core';
import { useTrafficLightSpace } from '@/data/host/use-traffic-light-space';
import { useSidebarCollapsed, useSidebarOpen } from '@/data/use-sidebar-collapsed';
import { SidebarToggle } from '@/features/sidebar/sidebar-toggle';
import { WorkspaceNavigation } from '@/features/sidebar/workspace-navigation';
import { IconButton } from '@/lib/ui';
import styles from './style.module.css';
import type { MouseEvent, ReactNode } from 'react';

export function SidebarHeader( { action }: { action?: ReactNode } ) {
	const reserveTrafficLightSpace = useTrafficLightSpace().start;
	const connector = useConnector();
	const sidebarOpen = useSidebarOpen();
	const collapsed = useSidebarCollapsed();
	const handleOpenAppMenu = ( event: MouseEvent< HTMLButtonElement > ) => {
		const rect = event.currentTarget.getBoundingClientRect();
		void connector.popupAppMenu( { x: Math.round( rect.left ), y: Math.round( rect.bottom ) } );
	};
	return (
		<div className={ clsx( styles.root, ! reserveTrafficLightSpace && styles.flush ) }>
			{ connector.showsAppMenuButton && (
				<IconButton
					size="icon-sm"
					icon={ <MenuIcon /> }
					label={ __( 'Menu' ) }
					onClick={ handleOpenAppMenu }
				/>
			) }
			<span className={ styles.toggleSlot } data-sidebar-open={ sidebarOpen }>
				<SidebarToggle />
			</span>
			<div className={ styles.action }>
				<WorkspaceNavigation hidden={ collapsed } />
				{ action }
			</div>
		</div>
	);
}
