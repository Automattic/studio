import { IconButton } from '@studio/ds';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { MenuIcon } from 'lucide-react';
import { useConnector } from '@/data/core';
import { useTrafficLightSpace } from '@/data/host/use-traffic-light-space';
import { useSidebarCollapsed } from '@/data/use-sidebar-collapsed';
import { WorkspaceNavigation } from '@/features/sidebar/workspace-navigation';
import styles from './style.module.css';
import type { MouseEvent, ReactNode } from 'react';

export function SidebarHeader( { action }: { action?: ReactNode } ) {
	const reserveTrafficLightSpace = useTrafficLightSpace().start;
	const connector = useConnector();
	const collapsed = useSidebarCollapsed();
	const handleOpenAppMenu = ( event: MouseEvent< HTMLButtonElement > ) => {
		const rect = event.currentTarget.getBoundingClientRect();
		void connector.popupAppMenu( { x: Math.round( rect.left ), y: Math.round( rect.bottom ) } );
	};
	return (
		<div className={ clsx( styles.root, ! reserveTrafficLightSpace && styles.flush ) }>
			{ connector.showsAppMenuButton && (
				<IconButton
					variant="ghost"
					size="icon-sm"
					icon={ <MenuIcon /> }
					label={ __( 'Menu' ) }
					tabIndex={ collapsed ? -1 : undefined }
					onClick={ handleOpenAppMenu }
				/>
			) }
			<div className={ styles.action }>
				<WorkspaceNavigation hidden={ collapsed } />
				{ action }
			</div>
		</div>
	);
}
