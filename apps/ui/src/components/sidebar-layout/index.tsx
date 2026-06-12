import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { SidebarHeader } from '@/components/sidebar-header';
import { SidebarSettingsButton } from '@/components/sidebar-settings-button';
import { SiteList } from '@/components/site-list';
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
					<SiteList />
					<div className={ styles.sidebarFooter }>
						<SidebarSettingsButton />
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
				{ sidebarResize.isResizing ? <ResizeOverlay /> : null }
			</div>
		</SidebarCollapsedContext.Provider>
	);
}
