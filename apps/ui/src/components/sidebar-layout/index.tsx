import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { SidebarHeader } from '@/components/sidebar-header';
import { SidebarNav } from '@/components/sidebar-nav';
import { SiteList } from '@/components/site-list';
import { UserMenu } from '@/components/user-menu';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { SidebarCollapsedContext } from '@/hooks/use-sidebar-collapsed';
import { drawerIcon } from '@/lib/icons';
import { SIDEBAR_PANEL_CONFIG, SIDEBAR_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import styles from './style.module.css';
import type { CSSProperties, ReactNode } from 'react';

export function SidebarLayout( { children }: { children: ReactNode } ) {
	const [ collapsed, setCollapsed ] = useState( false );
	const isFullscreen = useFullscreen();
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		edge: 'right',
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const sidebarStyle = collapsed
		? undefined
		: ( { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties );

	return (
		<SidebarCollapsedContext.Provider value={ collapsed }>
			<div className={ styles.root }>
				<aside
					className={ clsx( styles.sidebar, collapsed && styles.sidebarCollapsed ) }
					style={ sidebarStyle }
				>
					<SidebarHeader onToggleSidebar={ () => setCollapsed( true ) } />
					<SidebarNav />
					<SiteList />
					<UserMenu />
				</aside>
				{ ! collapsed ? (
					<div
						className={ clsx( styles.resizeHandle, sidebarResize.isResizing && styles.resizing ) }
						role="separator"
						aria-label={ __( 'Resize sidebar' ) }
						aria-orientation="vertical"
						aria-valuemin={ sidebarResize.minWidth }
						aria-valuemax={ sidebarResize.maxWidth }
						aria-valuenow={ sidebarResize.width }
						tabIndex={ 0 }
						onMouseDown={ sidebarResize.handleResizeStart }
						onKeyDown={ sidebarResize.handleKeyDown }
					>
						<span className={ styles.resizeHandleIndicator } aria-hidden="true" />
					</div>
				) : null }
				<main className={ styles.main }>
					{ collapsed ? (
						<div
							className={ clsx(
								styles.floatingToggle,
								isFullscreen && styles.floatingToggleFullscreen
							) }
						>
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ drawerIcon }
								label={ __( 'Show sidebar' ) }
								onClick={ () => setCollapsed( false ) }
							/>
						</div>
					) : null }
					{ children }
				</main>
				{ sidebarResize.isResizing ? <div className={ styles.resizeOverlay } /> : null }
			</div>
		</SidebarCollapsedContext.Provider>
	);
}
