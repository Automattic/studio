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
	const sidebarFlyoutScrollTop = useRef( 0 );
	useLayoutEffect( () => {
		if ( ! instantSidebarDock ) return;
		if ( dockedSidebarRef.current ) {
			dockedSidebarRef.current.scrollTop = sidebarFlyoutScrollTop.current;
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
	const sidebarFlyoutRef = useRef< HTMLElement >( null );
	const sidebarFlyoutAnchor = useRef< HTMLDivElement >( null );
	const hoverTimer = useRef< ReturnType< typeof setTimeout > | undefined >( undefined );
	const clearHoverTimer = useCallback( () => clearTimeout( hoverTimer.current ), [] );
	const closeSidebarFlyout = useCallback( () => {
		clearHoverTimer();
		setSidebarFlyoutState( 'closed' );
	}, [ clearHoverTimer ] );
	useEffect( () => {
		const reopen = () => {
			closeSidebarFlyout();
			setCollapsed( false );
		};
		window.addEventListener( PANEL_WIDTHS_RESET_EVENT, reopen );
		return () => window.removeEventListener( PANEL_WIDTHS_RESET_EVENT, reopen );
	}, [ closeSidebarFlyout, setCollapsed ] );
	// When docking the sidebar would leave the content less than the chat and
	// preview need, it opens over the content instead, closed by default. The
	// docked state is kept for when the window widens again.
	const overlay = sidebarResize.viewportWidth - sidebarResize.width < PREVIEW_SPLIT_MIN_WIDTH;
	useEffect( () => clearHoverTimer, [ overlay, clearHoverTimer ] );
	const [ wasOverlay, setWasOverlay ] = useState( overlay );
	if ( wasOverlay !== overlay ) {
		setWasOverlay( overlay );
		setSidebarFlyoutState( 'closed' );
	}
	const docked = ! overlay && ! collapsed;
	const open = docked || sidebarFlyoutOpen;
	const hoverEnter = useCallback( () => {
		clearHoverTimer();
		if ( ! open && ! peek && performance.now() >= hoverBlockedUntil.current ) {
			hoverTimer.current = setTimeout( () => {
				setSidebarFlyoutState( 'hover' );
			}, HOVER_OPEN_DELAY_MS );
		}
	}, [ clearHoverTimer, open, peek ] );
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
		setInstantSidebarDock( peek && ! overlay );
		if ( peek && ! overlay )
			sidebarFlyoutScrollTop.current = sidebarFlyoutRef.current?.scrollTop ?? 0;
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
	}, [ overlay, sidebarFlyoutOpen, collapsed, peek, setCollapsed, clearHoverTimer ] );
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
											<SidebarContents active floating onSiteOpen={ closeSidebarFlyout } />
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
