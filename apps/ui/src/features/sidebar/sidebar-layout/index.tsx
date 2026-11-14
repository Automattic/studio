import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import {
	PANEL_WIDTHS_RESET_EVENT,
	PANEL_SPLIT_MIN_WIDTH,
	SIDEBAR_COLLAPSED_STORAGE_KEY,
	SIDEBAR_PANEL_CONFIG,
	SIDEBAR_PANEL_STORAGE_KEY,
} from '@/data/resizable-panels';
import {
	SidebarHeaderActionContext,
	SidebarCollapsedContext,
	SidebarOpenContext,
	SidebarHoverContext,
	SidebarToggleContext,
} from '@/data/use-sidebar-collapsed';
import { UserMenu } from '@/features/account';
import { AppMessageCards, AppToasts } from '@/features/notifications';
import { SidebarHeader } from '@/features/sidebar/sidebar-header';
import { SiteList } from '@/features/sidebar/site-list';
import { useScrollFade, useStoredFlag } from '@/lib/hooks';
import { Popover, ResizeHandle, ResizeOverlay, useHasOpenDialog } from '@/lib/ui';
import styles from './style.module.css';
import { useResizablePanel } from './use-resizable-panel';
import type { CSSProperties, ReactNode, RefCallback } from 'react';

const HOVER_OPEN_DELAY_MS = 180;
const HOVER_CLOSE_DELAY_MS = 350;

const findToggle = () =>
	[ ...document.querySelectorAll< HTMLElement >( '[data-sidebar-toggle]' ) ].find(
		( toggle ) => ! toggle.closest( '[inert]' )
	);

function SidebarContents( {
	active,
	onSiteOpen,
	scrollRef,
}: {
	active: boolean;
	onSiteOpen?: () => void;
	scrollRef: RefCallback< HTMLDivElement >;
} ) {
	return (
		<div ref={ scrollRef } className={ styles.sidebarScroll }>
			<SiteList sections active={ active } onSiteOpen={ onSiteOpen } />
			<div className={ styles.sidebarFooter }>
				<div className={ styles.sidebarFooterControls }>
					{ active ? <AppMessageCards className={ styles.sidebarCards } /> : null }
					<UserMenu />
				</div>
			</div>
		</div>
	);
}

export function SidebarLayout( {
	children,
	headerAction,
}: {
	children: ReactNode;
	headerAction?: ReactNode;
} ) {
	const connector = useConnector();
	const hasOpenDialog = useHasOpenDialog();
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const sites = useSites();
	const emptyWorkspace = sites.isSuccess && sites.data.length === 0;
	const [ collapsed, setCollapsed ] = useStoredFlag( SIDEBAR_COLLAPSED_STORAGE_KEY, false );

	const [ sidebarFlyoutState, setSidebarFlyoutState ] = useState< 'closed' | 'hover' | 'open' >(
		'closed'
	);
	const peek = sidebarFlyoutState === 'hover';
	const sidebarFlyoutOpen = sidebarFlyoutState === 'open';
	const [ instantSidebarDock, setInstantSidebarDock ] = useState( false );
	const dockedSidebarRef = useRef< HTMLElement >( null );
	const setDockedFade = useScrollFade< HTMLDivElement >();
	const setFlyoutFade = useScrollFade< HTMLElement >();
	const dockedSidebarScrollRef = useRef< HTMLDivElement >( null );
	const dockScrollTop = useRef( 0 );
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
	const workspaceRef = useRef< HTMLElement >( null );
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
	const overlay = sidebarResize.viewportWidth - sidebarResize.width < PANEL_SPLIT_MIN_WIDTH;
	const wasEmptyWorkspace = useRef( false );
	useEffect( () => {
		if ( ! sites.isSuccess ) return;
		if ( emptyWorkspace || ( wasEmptyWorkspace.current && ! overlay ) ) {
			setCollapsed( emptyWorkspace );
		}
		wasEmptyWorkspace.current = emptyWorkspace;
	}, [ sites.isSuccess, emptyWorkspace, overlay, setCollapsed ] );
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
		if ( docked && dockedSidebarScrollRef.current ) {
			dockedSidebarScrollRef.current.scrollTop = dockScrollTop.current;
			dockScrollTop.current = 0;
		}
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
		if ( peek && ! overlay ) dockScrollTop.current = sidebarFlyoutRef.current?.scrollTop ?? 0;
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
		<SidebarHeaderActionContext.Provider value={ headerAction }>
			<SidebarCollapsedContext.Provider value={ ! docked }>
				<SidebarOpenContext.Provider value={ open }>
					<SidebarToggleContext.Provider value={ toggleSidebar }>
						<SidebarHoverContext.Provider
							value={ { peek, onEnter: hoverEnter, onLeave: hoverLeave } }
						>
							<div
								className={ clsx( styles.root, instantSidebarDock && styles.instantSidebarDock ) }
								style={ sidebarStyle }
							>
								<div className={ styles.windowDragStrip } aria-hidden="true" />
								<div
									className={ clsx( styles.windowDragStrip, styles.windowDragStripBottom ) }
									aria-hidden="true"
								/>
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
											if (
												target instanceof Element &&
												target.closest( '[data-sidebar-toggle]' )
											) {
												details.cancel();
												return;
											}
											if ( ! next ) closeSidebarFlyout();
										} }
									>
										<Popover.Popup
											// Sidebar items own dialogs that must survive the flyout closing.
											keepMounted={ hasOpenDialog }
											container={ workspaceRef }
											anchor={ sidebarFlyoutAnchor }
											side="bottom"
											align="start"
											sideOffset={ 0 }
											collisionPadding={ 0 }
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
												onPointerEnter={ clearHoverTimer }
												onPointerLeave={ hoverLeave }
											>
												<SidebarContents
													active={ peek || sidebarFlyoutOpen }
													onSiteOpen={ closeSidebarFlyout }
													scrollRef={ ( node ) => {
														sidebarFlyoutRef.current = node;
														setFlyoutFade( node );
													} }
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
									inert={ ! docked }
								>
									<aside ref={ dockedSidebarRef } className={ styles.sidebar }>
										<SidebarHeader action={ docked ? headerAction : undefined } />
										<SidebarContents
											active={ docked }
											scrollRef={ ( node ) => {
												dockedSidebarScrollRef.current = node;
												setDockedFade( node );
											} }
										/>
									</aside>
								</div>
								<main
									ref={ workspaceRef }
									className={ styles.main }
									data-sidebar-flyout={ sidebarFlyoutVisible || undefined }
								>
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
											onDoublePress={ toggleSidebar }
										/>
									) : null }
									{ children }
								</main>
								{ sidebarResize.isResizing ? <ResizeOverlay /> : null }
								<AppToasts />
							</div>
						</SidebarHoverContext.Provider>
					</SidebarToggleContext.Provider>
				</SidebarOpenContext.Provider>
			</SidebarCollapsedContext.Provider>
		</SidebarHeaderActionContext.Provider>
	);
}
