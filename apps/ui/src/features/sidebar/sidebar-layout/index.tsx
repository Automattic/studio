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
import { Popover, ResizeHandle, ResizeOverlay } from '@/lib/ui';
import styles from './style.module.css';
import { useResizablePanel } from './use-resizable-panel';
import type { CSSProperties, ReactNode } from 'react';

const HOVER_OPEN_DELAY_MS = 180;
const HOVER_CLOSE_DELAY_MS = 350;

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
				className={ floating ? styles.flyoutList : undefined }
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
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const [ collapsed, setCollapsed ] = useStoredFlag( SIDEBAR_COLLAPSED_STORAGE_KEY, false );

	const [ flyoutState, setFlyoutState ] = useState< 'closed' | 'hover' | 'open' >( 'closed' );
	const peek = flyoutState === 'hover';
	const overlayOpen = flyoutState === 'open';
	const [ instantDock, setInstantDock ] = useState( false );
	const dockedSidebarRef = useRef< HTMLElement >( null );
	const flyoutScrollTop = useRef( 0 );
	useLayoutEffect( () => {
		if ( ! instantDock ) return;
		if ( dockedSidebarRef.current ) {
			dockedSidebarRef.current.scrollTop = flyoutScrollTop.current;
			dockedSidebarRef.current
				.querySelector< HTMLElement >( '[data-sidebar-toggle]' )
				?.focus( { preventScroll: true } );
		}
		let secondFrame = 0;
		const firstFrame = requestAnimationFrame( () => {
			secondFrame = requestAnimationFrame( () => setInstantDock( false ) );
		} );
		return () => {
			cancelAnimationFrame( firstFrame );
			cancelAnimationFrame( secondFrame );
		};
	}, [ instantDock ] );
	const hoverBlockedUntil = useRef( 0 );
	const restoreFlyoutFocus = useRef( false );
	const flyoutRef = useRef< HTMLElement >( null );
	const flyoutAnchor = useRef< HTMLDivElement >( null );
	const hoverTimer = useRef< ReturnType< typeof setTimeout > | undefined >( undefined );
	const clearHoverTimer = useCallback( () => clearTimeout( hoverTimer.current ), [] );
	const closeOverlay = useCallback( () => {
		clearHoverTimer();
		setFlyoutState( 'closed' );
	}, [ clearHoverTimer ] );
	useEffect( () => {
		const reopen = () => {
			closeOverlay();
			setCollapsed( false );
		};
		window.addEventListener( PANEL_WIDTHS_RESET_EVENT, reopen );
		return () => window.removeEventListener( PANEL_WIDTHS_RESET_EVENT, reopen );
	}, [ closeOverlay, setCollapsed ] );
	// When docking the sidebar would leave the content less than the chat and
	// preview need, it opens over the content instead, closed by default. The
	// docked state is kept for when the window widens again.
	const overlay = sidebarResize.viewportWidth - sidebarResize.width < PREVIEW_SPLIT_MIN_WIDTH;
	useEffect( () => clearHoverTimer, [ overlay, clearHoverTimer ] );
	const [ wasOverlay, setWasOverlay ] = useState( overlay );
	if ( wasOverlay !== overlay ) {
		setWasOverlay( overlay );
		setFlyoutState( 'closed' );
	}
	const docked = ! overlay && ! collapsed;
	const open = docked || overlayOpen;
	const hoverEnter = useCallback( () => {
		clearHoverTimer();
		if ( ! open && ! peek && performance.now() >= hoverBlockedUntil.current ) {
			hoverTimer.current = setTimeout( () => {
				setFlyoutState( 'hover' );
			}, HOVER_OPEN_DELAY_MS );
		}
	}, [ clearHoverTimer, open, peek ] );
	const hoverLeave = useCallback( () => {
		clearHoverTimer();
		if ( peek ) {
			hoverTimer.current = setTimeout( () => setFlyoutState( 'closed' ), HOVER_CLOSE_DELAY_MS );
		}
	}, [ clearHoverTimer, peek ] );
	const toggleSidebar = useCallback( () => {
		setInstantDock( peek && ! overlay );
		if ( peek && ! overlay ) flyoutScrollTop.current = flyoutRef.current?.scrollTop ?? 0;
		hoverBlockedUntil.current = performance.now() + HOVER_CLOSE_DELAY_MS;
		clearHoverTimer();
		if ( overlay ) {
			restoreFlyoutFocus.current = ! overlayOpen;
			setFlyoutState( overlayOpen ? 'closed' : 'open' );
			if ( peek )
				flyoutRef.current
					?.querySelector< HTMLElement >( 'button:not(:disabled)' )
					?.focus( { preventScroll: true } );
		} else {
			setFlyoutState( 'closed' );
			setCollapsed( ! collapsed );
		}
	}, [ overlay, overlayOpen, collapsed, peek, setCollapsed, clearHoverTimer ] );
	const findToggle = () =>
		[ ...document.querySelectorAll< HTMLElement >( '[data-sidebar-toggle]' ) ].find(
			( toggle ) => ! toggle.closest( '[inert]' )
		);
	const sidebarStyle = { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties;

	useEffect( () => connector.onToggleSidebar( toggleSidebar ), [ connector, toggleSidebar ] );

	return (
		<SidebarCollapsedContext.Provider value={ ! docked }>
			<SidebarOpenContext.Provider value={ open }>
				<SidebarToggleContext.Provider value={ toggleSidebar }>
					<SidebarHoverContext.Provider
						value={ { peek, onEnter: hoverEnter, onLeave: hoverLeave } }
					>
						<div className={ clsx( styles.root, instantDock && styles.instantDock ) }>
							<div ref={ flyoutAnchor } className={ styles.flyoutAnchor } aria-hidden />
							{ ! instantDock && (
								<Popover.Root
									open={ peek || overlayOpen }
									onOpenChange={ ( next, details ) => {
										if (
											details.reason === 'escape-key' &&
											flyoutRef.current?.querySelector( '[data-selected]' )
										) {
											details.cancel();
											return;
										}
										const target = details.event.target;
										if ( target instanceof Element && target.closest( '[data-sidebar-toggle]' ) ) {
											details.cancel();
											return;
										}
										if ( ! next ) closeOverlay();
									} }
								>
									<Popover.Popup
										anchor={ flyoutAnchor }
										side="bottom"
										align="start"
										sideOffset={ 8 }
										alignOffset={ 8 }
										initialFocus={ () =>
											overlayOpen
												? flyoutRef.current?.querySelector< HTMLElement >(
														'button:not(:disabled)'
												  ) ?? false
												: false
										}
										finalFocus={ () => {
											if ( ! restoreFlyoutFocus.current ) return false;
											restoreFlyoutFocus.current = false;
											return findToggle() ?? false;
										} }
										aria-label={ __( 'Sidebar' ) }
										className={ styles.flyout }
										style={ sidebarStyle }
									>
										<aside
											className={ styles.flyoutContents }
											ref={ flyoutRef }
											onPointerEnter={ clearHoverTimer }
											onPointerLeave={ hoverLeave }
										>
											<SidebarContents active floating onSiteOpen={ closeOverlay } />
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
							{ flyoutState !== 'closed' ? (
								<button
									type="button"
									className={ styles.overlayBackdrop }
									aria-label={ __( 'Close sidebar' ) }
									tabIndex={ -1 }
									onClick={ closeOverlay }
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
					</SidebarHoverContext.Provider>
				</SidebarToggleContext.Provider>
			</SidebarOpenContext.Provider>
		</SidebarCollapsedContext.Provider>
	);
}
