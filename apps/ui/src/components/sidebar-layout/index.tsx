import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { SidebarHeader } from '@/components/sidebar-header';
import { SiteList } from '@/components/site-list';
import { UserMenu } from '@/components/user-menu';
import { useConnector } from '@/data/core';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { SidebarCollapsedContext } from '@/hooks/use-sidebar-collapsed';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { drawerIcon } from '@/lib/icons';
import { SIDEBAR_PANEL_CONFIG, SIDEBAR_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import styles from './style.module.css';
import type { CSSProperties, ReactNode } from 'react';

export function SidebarLayout( { children }: { children: ReactNode } ) {
	const [ collapsed, setCollapsed ] = useState( false );
	const connector = useConnector();
	const reserveTrafficLightSpace = useTrafficLightSpace();
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		edge: 'right',
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const toggleSidebar = useCallback( () => {
		setCollapsed( ( value ) => ! value );
	}, [] );
	const sidebarStyle = collapsed
		? undefined
		: ( { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties );

	useEffect( () => connector.onToggleSidebar( toggleSidebar ), [ connector, toggleSidebar ] );

	return (
		<SidebarCollapsedContext.Provider value={ collapsed }>
			<div className={ styles.root }>
				<aside
					className={ clsx(
						styles.sidebar,
						collapsed && styles.sidebarCollapsed,
						sidebarResize.isResizing && styles.sidebarResizing
					) }
					style={ sidebarStyle }
				>
					<SidebarHeader onToggleSidebar={ toggleSidebar } />
					<SiteList />
					<div className={ styles.sidebarFooter }>
						<UserMenu />
					</div>
				</aside>
				{ ! collapsed ? (
					<ResizeHandle
						className={ styles.resizeHandle }
						label={ __( 'Resize sidebar' ) }
						minWidth={ sidebarResize.minWidth }
						maxWidth={ sidebarResize.maxWidth }
						width={ sidebarResize.width }
						isResizing={ sidebarResize.isResizing }
						onResizeStart={ sidebarResize.handleResizeStart }
						onKeyDown={ sidebarResize.handleKeyDown }
					/>
				) : null }
				<main className={ styles.main }>
					{ collapsed ? (
						<div
							className={ clsx(
								styles.floatingToggle,
								! reserveTrafficLightSpace && styles.floatingToggleFlush
							) }
						>
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ drawerIcon }
								label={ __( 'Show sidebar' ) }
								onClick={ toggleSidebar }
							/>
						</div>
					) : null }
					{ children }
				</main>
				{ sidebarResize.isResizing ? <ResizeOverlay /> : null }
			</div>
		</SidebarCollapsedContext.Provider>
	);
}
