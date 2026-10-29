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
	SidebarHoverContext,
	SidebarToggleContext,
} from '@/data/use-sidebar-collapsed';
import { UserMenu } from '@/features/account';
import { AppMessageCards, AppMessageHistoryRecorder, AppToasts } from '@/features/notifications';
import { SidebarHeader } from '@/features/sidebar/sidebar-header';
import { SiteList } from '@/features/sidebar/site-list';
import { useStoredFlag } from '@/lib/hooks';
import { Popover, ResizeHandle, ResizeOverlay, useHasOpenDialog } from '@/lib/ui';
import styles from './style.module.css';
import { useResizablePanel } from './use-resizable-panel';
import type { CSSProperties, ReactNode } from 'react';

const HOVER_OPEN_DELAY_MS = 180;
const HOVER_CLOSE_DELAY_MS = 350;

const findToggle = () =>
	[ ...document.querySelectorAll< HTMLElement >( '[data-sidebar-toggle]' ) ].find(
		( toggle ) => ! toggle.closest( '[inert]' )
	);

function SidebarContents( {
	active,
	floating = false,
	onSiteOpen,
}: {
	active: boolean;
	floating?: boolean;
	onSiteOpen?: () => void;
} ) {
	return (
		<>
			<SiteList
				className={ floating ? styles.sidebarFlyoutList : undefined }
				sections
				active={ active }
				onSiteOpen={ onSiteOpen }
			/>
			<div className={ styles.sidebarFooter }>
				{ active ? <AppMessageCards className={ styles.sidebarCards } /> : null }
				<UserMenu />
			</div>
		</>
	);
}

export function SidebarLayout( { children }: { children: ReactNode } ) {
	const connector = useConnector();
	const hasOpenDialog = useHasOpenDialog();
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const [ collapsed, setCollapsed ] = useStoredFlag( SIDEBAR_COLLAPSED_STORAGE_KEY, false );

	const [ sidebarFlyoutState, setSidebarFlyoutState ] = useState< 'closed' | 'hover' | 'open' >(
		'closed'
	);
	const peek = sidebarFlyoutState === 'hover';
	const sidebarFlyoutOpen = sidebarFlyoutState === 'open';
	const [ instantSidebarDock, setInstantSidebarDock ] = useState( false );
	const dockedSidebarRef = useRef< HTMLElement >( null );
	useLayoutEffect( () => {
		if ( ! instantSidebarDock ) return;
		if ( dockedSidebarRef.current ) {
			dockedSidebarRef.current
				.querySelector< HTMLElement >( '[data-sidebar-toggle]' )
				?.focus( { preventScroll: true } );
		}
		let secondFrame = 0;
		const firstFrame = requestAnimationFrame( () => {
			secondFrame = requestAnimationFrame( () => setInstantSidebarDock( false ) );
		} );
		return () => {
			cancelAnimationFrame( firstFrame );
			cancelAnimationFrame( secondFrame );
		};
	}, [ instantSidebarDock ] );
	const hoverBlockedUntil = useRef( 0 );
	const restoreSidebarFlyoutFocus = useRef( false );
	const restoreSidebarDialogFocus = useRef( false );
	const sidebarFlyoutRef = useRef< HTMLElement >( null );
	const sidebarFlyoutAnchor = useRef< HTMLDivElement >( null );
	const hoverTimer = useRef< ReturnType< typeof setTimeout > | undefined >( undefined );
	const clearHoverTimer = useCallback( () => clearTimeout( hoverTimer.current ), [] );
	const closeSidebarFlyout = useCallback( () => {
		clearHoverTimer();
		setSidebarFlyoutState( 'closed' );
	}, [ clearHoverTimer ] );
	useEffect( () => {
		if ( hasOpenDialog ) {
			if ( sidebarFlyoutState !== 'closed' ) restoreSidebarDialogFocus.current = true;
			restoreSidebarFlyoutFocus.current = false;
			closeSidebarFlyout();
		} else if ( restoreSidebarDialogFocus.current ) {
			restoreSidebarDialogFocus.current = false;
			const frame = requestAnimationFrame( () => findToggle()?.focus( { preventScroll: true } ) );
			return () => cancelAnimationFrame( frame );
		}
	}, [ hasOpenDialog, sidebarFlyoutState, closeSidebarFlyout ] );
	useEffect( () => {
		const reopen = () => {
			closeSidebarFlyout();
			setCollapsed( false );
		};
		window.addEventListener( PANEL_WIDTHS_RESET_EVENT, reopen );
		return () => window.removeEventListener( PANEL_WIDTHS_RESET_EVENT, reopen );
	}, [ closeSidebarFlyout, setCollapsed ] );
	// A narrow window unpins the sidebar; widening it never pins it automatically.
	const overlay = sidebarResize.viewportWidth - sidebarResize.width < PREVIEW_SPLIT_MIN_WIDTH;
	useEffect( () => {
		if ( overlay ) setCollapsed( true );
		return clearHoverTimer;
	}, [ overlay, setCollapsed, clearHoverTimer ] );
	const [ wasOverlay, setWasOverlay ] = useState( overlay );
	if ( wasOverlay !== overlay ) {
		setWasOverlay( overlay );
		setSidebarFlyoutState( ! overlay && sidebarFlyoutState !== 'closed' ? 'hover' : 'closed' );
	}
	const docked = ! overlay && ! collapsed;
	const open = docked || sidebarFlyoutOpen;
	const sidebarFlyoutVisible = sidebarFlyoutState !== 'closed';
	useLayoutEffect( () => {
		if ( docked && dockedSidebarRef.current ) dockedSidebarRef.current.scrollTop = 0;
		if ( sidebarFlyoutVisible && sidebarFlyoutRef.current ) sidebarFlyoutRef.current.scrollTop = 0;
	}, [ docked, sidebarFlyoutVisible ] );
	const hoverEnter = useCallback( () => {
		clearHoverTimer();
		if ( ! hasOpenDialog && ! open && ! peek && performance.now() >= hoverBlockedUntil.current ) {
			hoverTimer.current = setTimeout( () => {
				setSidebarFlyoutState( 'hover' );
			}, HOVER_OPEN_DELAY_MS );
		}
	}, [ clearHoverTimer, hasOpenDialog, open, peek ] );
	const hoverLeave = useCallback( () => {
		clearHoverTimer();
		if ( peek ) {
			hoverTimer.current = setTimeout(
				() => setSidebarFlyoutState( 'closed' ),
				HOVER_CLOSE_DELAY_MS
			);
		}
	}, [ clearHoverTimer, peek ] );
	const toggleSidebar = useCallback( () => {
		if ( hasOpenDialog ) return;
		setInstantSidebarDock( peek && ! overlay );
		hoverBlockedUntil.current = performance.now() + HOVER_CLOSE_DELAY_MS;
		clearHoverTimer();
		if ( overlay ) {
			restoreSidebarFlyoutFocus.current = ! sidebarFlyoutOpen;
			setSidebarFlyoutState( sidebarFlyoutOpen ? 'closed' : 'open' );
			if ( peek )
				sidebarFlyoutRef.current
					?.querySelector< HTMLElement >( 'button:not(:disabled)' )
					?.focus( { preventScroll: true } );
		} else {
			setSidebarFlyoutState( 'closed' );
			setCollapsed( ! collapsed );
		}
	}, [
		hasOpenDialog,
		overlay,
		sidebarFlyoutOpen,
		collapsed,
		peek,
		setCollapsed,
		clearHoverTimer,
	] );
	const sidebarStyle = { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties;

	useEffect( () => connector.onToggleSidebar( toggleSidebar ), [ connector, toggleSidebar ] );

	return (
		<SidebarCollapsedContext.Provider value={ ! docked }>
			<SidebarOpenContext.Provider value={ open }>
				<SidebarToggleContext.Provider value={ toggleSidebar }>
					<SidebarHoverContext.Provider
						value={ { peek, onEnter: hoverEnter, onLeave: hoverLeave } }
					>
						<div className={ clsx( styles.root, instantSidebarDock && styles.instantSidebarDock ) }>
							<div
								ref={ sidebarFlyoutAnchor }
								className={ styles.sidebarFlyoutAnchor }
								aria-hidden
							/>
							{ ! instantSidebarDock && (
								<Popover.Root
									open={ peek || sidebarFlyoutOpen }
									onOpenChange={ ( next, details ) => {
										if (
											details.reason === 'escape-key' &&
											sidebarFlyoutRef.current?.querySelector( '[data-selected]' )
										) {
											details.cancel();
											return;
										}
										const target = details.event.target;
										if ( target instanceof Element && target.closest( '[data-sidebar-toggle]' ) ) {
											details.cancel();
											return;
										}
										if ( ! next ) closeSidebarFlyout();
									} }
								>
									<Popover.Popup
										// Sidebar items own dialogs that must survive the flyout closing.
										keepMounted={ hasOpenDialog }
										anchor={ sidebarFlyoutAnchor }
										side="bottom"
										align="start"
										sideOffset={ 8 }
										alignOffset={ 8 }
										initialFocus={ () =>
											sidebarFlyoutOpen
												? sidebarFlyoutRef.current?.querySelector< HTMLElement >(
														'button:not(:disabled)'
												  ) ?? false
												: false
										}
										finalFocus={ () => {
											if ( ! restoreSidebarFlyoutFocus.current ) return false;
											restoreSidebarFlyoutFocus.current = false;
											return findToggle() ?? false;
										} }
										aria-label={ __( 'Sidebar' ) }
										className={ styles.sidebarFlyout }
										style={ sidebarStyle }
									>
										<aside
											className={ styles.sidebarFlyoutContents }
											ref={ sidebarFlyoutRef }
											onPointerEnter={ clearHoverTimer }
											onPointerLeave={ hoverLeave }
										>
											<SidebarContents
												active={ peek || sidebarFlyoutOpen }
												floating
												onSiteOpen={ closeSidebarFlyout }
											/>
										</aside>
									</Popover.Popup>
								</Popover.Root>
							) }
							<div
								className={ clsx(
									styles.sidebarFrame,
									! docked && styles.sidebarCollapsed,
									sidebarResize.isResizing && styles.sidebarResizing
								) }
								style={ sidebarStyle }
								inert={ ! docked }
							>
								<aside ref={ dockedSidebarRef } className={ styles.sidebar }>
									<SidebarHeader />
									<SidebarContents active={ docked } />
								</aside>
							</div>
							{ sidebarFlyoutState !== 'closed' ? (
								<button
									type="button"
									className={ styles.sidebarFlyoutBackdrop }
									aria-label={ __( 'Close sidebar' ) }
									tabIndex={ -1 }
									onClick={ closeSidebarFlyout }
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
							<main className={ styles.main }>{ children }</main>
							{ sidebarResize.isResizing ? <ResizeOverlay /> : null }
							<AppToasts />
							<AppMessageHistoryRecorder />
						</div>
					</SidebarHoverContext.Provider>
				</SidebarToggleContext.Provider>
			</SidebarOpenContext.Provider>
		</SidebarCollapsedContext.Provider>
	);
}
