import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import {
	PANEL_WIDTHS_RESET_EVENT,
	PREVIEW_SPLIT_MIN_WIDTH,
	SIDEBAR_COLLAPSED_STORAGE_KEY,
	SIDEBAR_PANEL_CONFIG,
	SIDEBAR_PANEL_STORAGE_KEY,
} from '@/data/resizable-panels';
import {
	SidebarCollapsedContext,
	SidebarOpenContext,
	SidebarToggleContext,
} from '@/data/use-sidebar-collapsed';
import { UserMenu } from '@/features/account';
import { AppMessageCards, AppMessageHistoryRecorder, AppToasts } from '@/features/notifications';
import { SidebarHeader } from '@/features/sidebar/sidebar-header';
import { SiteList } from '@/features/sidebar/site-list';
import { useStoredFlag } from '@/lib/hooks';
import { ResizeHandle, ResizeOverlay } from '@/lib/ui';
import styles from './style.module.css';
import { useResizablePanel } from './use-resizable-panel';
import type { CSSProperties, ReactNode } from 'react';

export function SidebarLayout( { children }: { children: ReactNode } ) {
	const connector = useConnector();
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		edge: 'right',
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const [ collapsed, setCollapsed ] = useStoredFlag( SIDEBAR_COLLAPSED_STORAGE_KEY, false );
	useEffect( () => {
		const reopen = () => setCollapsed( false );
		window.addEventListener( PANEL_WIDTHS_RESET_EVENT, reopen );
		return () => window.removeEventListener( PANEL_WIDTHS_RESET_EVENT, reopen );
	}, [ setCollapsed ] );
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
			setCollapsed( ! collapsed );
		}
	}, [ overlay, collapsed, setCollapsed ] );
	const sidebarRef = useRef< HTMLElement >( null );
	// Escape can close the overlay while focus is still in a menu it opened,
	// which would hand focus back to the sidebar once it's inert.
	const closedWithEscape = useRef( false );
	// The overlay takes focus to its first item, and gives it back to the
	// sidebar toggle when it closes.
	useLayoutEffect( () => {
		const sidebar = sidebarRef.current;
		if ( overlay && overlayOpen ) {
			sidebar
				?.querySelector< HTMLElement >( 'button:not(:disabled)' )
				?.focus( { preventScroll: true } );
		} else if (
			! open &&
			( closedWithEscape.current || sidebar?.contains( document.activeElement ) )
		) {
			closedWithEscape.current = false;
			const focusToggle = () =>
				[ ...document.querySelectorAll< HTMLElement >( '[data-sidebar-toggle]' ) ]
					.find( ( toggle ) => ! toggle.closest( '[inert]' ) )
					?.focus();
			focusToggle();
			// A pick also navigates, which can replace the header holding the toggle.
			const frame = requestAnimationFrame(
				() => document.activeElement === document.body && focusToggle()
			);
			return () => cancelAnimationFrame( frame );
		}
	}, [ overlay, overlayOpen, open ] );
	const sidebarStyle = { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties;

	useEffect( () => connector.onToggleSidebar( toggleSidebar ), [ connector, toggleSidebar ] );
	useEffect( () => {
		if ( ! overlay || ! overlayOpen ) {
			return;
		}
		const closeOnEscape = ( event: KeyboardEvent ) => {
			if ( event.key === 'Escape' && ! event.defaultPrevented ) {
				closedWithEscape.current = true;
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
							<aside ref={ sidebarRef } className={ styles.sidebar }>
								{ overlay ? null : <SidebarHeader /> }
								<SiteList
									sections
									onSiteOpen={ overlay ? () => setOverlayOpen( false ) : undefined }
								/>
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
								onResizeStart={ sidebarResize.handleResizeStart }
								onKeyDown={ sidebarResize.handleKeyDown }
								onReset={ sidebarResize.resetWidth }
							/>
						) : null }
						<main
							className={ clsx(
								styles.main,
								'studio-column-edge',
								! docked && styles.mainUndocked
							) }
						>
							{ children }
						</main>
						{ sidebarResize.isResizing ? <ResizeOverlay /> : null }
						<AppToasts />
						<AppMessageHistoryRecorder />
					</div>
				</SidebarToggleContext.Provider>
			</SidebarOpenContext.Provider>
		</SidebarCollapsedContext.Provider>
	);
}
