import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { SidebarHeader } from '@/components/sidebar-header';
import { SidebarNav } from '@/components/sidebar-nav';
import { SiteList } from '@/components/site-list';
import { UserMenu } from '@/components/user-menu';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { SidebarCollapsedContext } from '@/hooks/use-sidebar-collapsed';
import { drawerIcon } from '@/lib/icons';
import { getKeyboardShortcut, getKeyboardShortcutDescriptor } from '@/lib/keyboard-shortcuts';
import { SIDEBAR_PANEL_CONFIG, SIDEBAR_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import styles from './style.module.css';
import type { CSSProperties, ReactNode } from 'react';

export function SidebarLayout( { children }: { children: ReactNode } ) {
	const navigate = useNavigate();
	const [ collapsed, setCollapsed ] = useState( false );
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		edge: 'right',
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const sidebarStyle = { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties;
	const toggleSidebar = useCallback( () => setCollapsed( ( current ) => ! current ), [] );
	const openSettings = useCallback( () => {
		void navigate( { to: '/settings' } );
	}, [ navigate ] );
	const sidebarShortcut = getKeyboardShortcutDescriptor( getKeyboardShortcut( 'toggle-sidebar' ) );
	useKeyboardShortcut( 'toggle-sidebar', toggleSidebar );
	useKeyboardShortcut( 'open-app-settings', openSettings );

	useEffect( () => {
		const ipcListener = (
			window as Window & {
				ipcListener?: {
					subscribe: (
						channel: 'user-settings',
						listener: ( event: unknown, payload: { tabName?: string } ) => void
					) => () => void;
				};
			}
		 ).ipcListener;

		return ipcListener?.subscribe( 'user-settings', () => openSettings() );
	}, [ openSettings ] );

	return (
		<SidebarCollapsedContext.Provider value={ collapsed }>
			<div className={ styles.root } style={ sidebarStyle }>
				<aside
					className={ clsx(
						styles.sidebar,
						collapsed && styles.sidebarCollapsed,
						sidebarResize.isResizing && styles.sidebarResizing
					) }
				>
					<SidebarHeader />
					<SidebarNav />
					<SiteList />
					<UserMenu />
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
				<main className={ styles.main }>{ children }</main>
				<div
					className={ clsx(
						styles.sidebarToggle,
						collapsed && styles.sidebarToggleCollapsed,
						sidebarResize.isResizing && styles.sidebarToggleResizing
					) }
				>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						className={ styles.sidebarToggleButton }
						icon={ drawerIcon }
						label={ collapsed ? __( 'Show sidebar' ) : __( 'Hide sidebar' ) }
						shortcut={ sidebarShortcut }
						onClick={ toggleSidebar }
					/>
				</div>
				{ sidebarResize.isResizing ? <ResizeOverlay /> : null }
			</div>
		</SidebarCollapsedContext.Provider>
	);
}
