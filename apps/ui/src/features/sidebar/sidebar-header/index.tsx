import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { MenuIcon } from 'lucide-react';
import { useConnector } from '@/data/core';
import { useTrafficLightSpace } from '@/data/host/use-traffic-light-space';
import { SidebarToggle } from '@/features/sidebar/sidebar-toggle';
import { useSidebarOpen } from '@/features/sidebar/use-sidebar-collapsed';
import { IconButton } from '@/lib/ui';
import styles from './style.module.css';
import type { MouseEvent } from 'react';

export function SidebarHeader() {
	const reserveTrafficLightSpace = useTrafficLightSpace().start;
	const connector = useConnector();
	const sidebarOpen = useSidebarOpen();
	const handleOpenAppMenu = ( event: MouseEvent< HTMLButtonElement > ) => {
		const rect = event.currentTarget.getBoundingClientRect();
		void connector.popupAppMenu( { x: Math.round( rect.left ), y: Math.round( rect.bottom ) } );
	};
	return (
		<div className={ clsx( styles.root, ! reserveTrafficLightSpace && styles.flush ) }>
			{ connector.showsAppMenuButton && (
				<IconButton icon={ <MenuIcon /> } label={ __( 'Menu' ) } onClick={ handleOpenAppMenu } />
			) }
			<span className={ styles.toggleSlot } data-sidebar-open={ sidebarOpen }>
				<SidebarToggle />
			</span>
		</div>
	);
}
