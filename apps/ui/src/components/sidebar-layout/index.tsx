import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { AppMessageCards, AppMessageHistoryRecorder } from '@/components/app-message-cards';
import { AppToasts } from '@/components/app-toasts';
import { NoticeHistoryDialog } from '@/components/notice-history';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { SidebarHeader } from '@/components/sidebar-header';
import { SiteList } from '@/components/site-list';
import { UserMenu } from '@/components/user-menu';
import { useConnector } from '@/data/core';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import {
	SidebarCollapsedContext,
	SidebarOpenContext,
	SidebarToggleContext,
} from '@/hooks/use-sidebar-collapsed';
import {
	PREVIEW_SPLIT_MIN_WIDTH,
	SIDEBAR_PANEL_CONFIG,
	SIDEBAR_PANEL_STORAGE_KEY,
} from '@/lib/resizable-panels';
import styles from './style.module.css';
import type { CSSProperties, ReactNode } from 'react';

export function SidebarLayout( { children }: { children: ReactNode } ) {
	const connector = useConnector();
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		edge: 'right',
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const [ collapsed, setCollapsed ] = useState( false );
	const [ overlayOpen, setOverlayOpen ] = useState( false );
	// When docking the sidebar would leave the content less than the chat and
	// preview need, it opens over the content instead, closed by default. The
	// docked state is kept for when the window widens again.
	const overlay = sidebarResize.viewportWidth - sidebarResize.width < PREVIEW_SPLIT_MIN_WIDTH;
	const [ wasOverlay, setWasOverlay ] = useState( overlay );
	if ( wasOverlay !== overlay ) {
		setWasOverlay( overlay );
		setOverlayOpen( false );
	}
	const open = overlay ? overlayOpen : ! collapsed;
	const docked = ! overlay && open;
	const toggleSidebar = useCallback( () => {
		if ( overlay ) {
			setOverlayOpen( ( current ) => ! current );
		} else {
			setCollapsed( ( current ) => ! current );
		}
	}, [ overlay ] );
	const sidebarStyle = { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties;

	useEffect( () => connector.onToggleSidebar( toggleSidebar ), [ connector, toggleSidebar ] );
	useEffect( () => {
		if ( ! overlay || ! overlayOpen ) {
			return;
		}
		const closeOnEscape = ( event: KeyboardEvent ) => {
			if ( event.key === 'Escape' && ! event.defaultPrevented ) {
				setOverlayOpen( false );
			}
		};
		window.addEventListener( 'keydown', closeOnEscape );
		return () => window.removeEventListener( 'keydown', closeOnEscape );
	}, [ overlay, overlayOpen ] );

	return (
		<SidebarCollapsedContext.Provider value={ ! docked }>
			<SidebarOpenContext.Provider value={ open }>
				<SidebarToggleContext.Provider value={ toggleSidebar }>
					<div className={ styles.root }>
						<div
							className={ clsx(
								styles.sidebarFrame,
								overlay && styles.sidebarOverlay,
								! open && styles.sidebarCollapsed,
								sidebarResize.isResizing && styles.sidebarResizing
							) }
							style={ sidebarStyle }
							inert={ ! open }
						>
							<aside className={ styles.sidebar }>
								{ overlay ? null : <SidebarHeader /> }
								<SiteList sections />
								<div className={ styles.sidebarFooter }>
									{ open ? <AppMessageCards className={ styles.sidebarCards } /> : null }
									<UserMenu />
								</div>
							</aside>
						</div>
						{ overlay && overlayOpen ? (
							<button
								type="button"
								className={ styles.overlayBackdrop }
								aria-label={ __( 'Close sidebar' ) }
								tabIndex={ -1 }
								onClick={ () => setOverlayOpen( false ) }
							/>
						) : null }
						{ docked ? (
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
						<main className={ clsx( styles.main, docked && 'studio-column-edge' ) }>
							{ children }
						</main>
						{ sidebarResize.isResizing ? <ResizeOverlay /> : null }
						<AppToasts />
						<NoticeHistoryDialog />
						<AppMessageHistoryRecorder />
					</div>
				</SidebarToggleContext.Provider>
			</SidebarOpenContext.Provider>
		</SidebarCollapsedContext.Provider>
	);
}
