import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppMessageCards, AppMessageHistoryRecorder } from '@/components/app-message-cards';
import { AppToasts } from '@/components/app-toasts';
import { NoticeHistoryDialog } from '@/components/notice-history';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { SidebarHeader } from '@/components/sidebar-header';
import { SeenSessionTimestampsProvider, SiteList } from '@/components/site-list';
import { UserMenu } from '@/components/user-menu';
import { useConnector } from '@/data/core';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { SidebarCollapsedContext, SidebarToggleContext } from '@/hooks/use-sidebar-collapsed';
import {
	getViewportWidth,
	SIDEBAR_AUTO_COLLAPSE_BREAKPOINT,
	SIDEBAR_PANEL_CONFIG,
	SIDEBAR_PANEL_STORAGE_KEY,
} from '@/lib/resizable-panels';
import styles from './style.module.css';
import type { CSSProperties, ReactNode } from 'react';

interface SidebarLayoutProps {
	children: ReactNode;
	collapsed?: boolean;
	onCollapsedChange?: ( collapsed: boolean ) => void;
	onExpand?: () => void;
	// Hides the sidebar without touching the user's own collapsed state, so
	// clearing it restores whatever the sidebar was doing before (e.g. while
	// the site preview is fullscreen).
	forceCollapsed?: boolean;
	// Called when the user asks to toggle the sidebar while it is force-
	// collapsed (the app-menu shortcut), so the forcing feature can stand down.
	// The sidebar expands alongside it.
	onForceCollapsedToggle?: () => void;
}

export function SidebarLayout( {
	children,
	collapsed: controlledCollapsed,
	onCollapsedChange,
	onExpand,
	forceCollapsed = false,
	onForceCollapsedToggle,
}: SidebarLayoutProps ) {
	const [ internalCollapsed, setInternalCollapsed ] = useState(
		() => getViewportWidth() < SIDEBAR_AUTO_COLLAPSE_BREAKPOINT
	);
	const collapsed = controlledCollapsed ?? internalCollapsed;
	const wasCompactRef = useRef( getViewportWidth() < SIDEBAR_AUTO_COLLAPSE_BREAKPOINT );
	const rootRef = useRef< HTMLDivElement >( null );
	const effectiveCollapsed = collapsed || forceCollapsed;
	const connector = useConnector();
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		edge: 'right',
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const updateCollapsed = useCallback(
		( nextCollapsed: boolean ) => {
			if ( controlledCollapsed === undefined ) {
				setInternalCollapsed( nextCollapsed );
			}
			onCollapsedChange?.( nextCollapsed );
		},
		[ controlledCollapsed, onCollapsedChange ]
	);
	const toggleSidebar = useCallback( () => {
		if ( forceCollapsed ) {
			onForceCollapsedToggle?.();
			return;
		}
		if ( collapsed ) {
			if ( onExpand ) {
				onExpand();
			} else {
				updateCollapsed( false );
			}
			return;
		}
		updateCollapsed( true );
	}, [ collapsed, forceCollapsed, onExpand, onForceCollapsedToggle, updateCollapsed ] );
	const sidebarStyle = effectiveCollapsed
		? undefined
		: ( { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties );

	useEffect( () => connector.onToggleSidebar( toggleSidebar ), [ connector, toggleSidebar ] );
	useEffect( () => {
		// When a parent controls the collapsed state it owns the responsive
		// behavior too (see useResponsivePanels), and coordinates it with the
		// window resizing that opening a panel triggers. Only drive the
		// uncontrolled fallback from here.
		if ( controlledCollapsed !== undefined ) {
			return;
		}
		const collapseWhenEnteringCompactWidth = ( width: number ) => {
			const isCompact = width < SIDEBAR_AUTO_COLLAPSE_BREAKPOINT;
			if ( isCompact && ! wasCompactRef.current ) {
				updateCollapsed( true );
			}
			wasCompactRef.current = isCompact;
		};
		const root = rootRef.current;
		if ( root && typeof ResizeObserver !== 'undefined' ) {
			const observer = new ResizeObserver( ( entries ) => {
				const width = entries[ 0 ]?.contentRect.width;
				if ( width ) {
					collapseWhenEnteringCompactWidth( width );
				}
			} );
			observer.observe( root );
			return () => observer.disconnect();
		}
		const handleWindowResize = () => collapseWhenEnteringCompactWidth( getViewportWidth() );
		window.addEventListener( 'resize', handleWindowResize );
		return () => window.removeEventListener( 'resize', handleWindowResize );
	}, [ controlledCollapsed, updateCollapsed ] );

	return (
		<SidebarCollapsedContext.Provider value={ effectiveCollapsed }>
			<SidebarToggleContext.Provider value={ toggleSidebar }>
				{ /* The aside's list and the collapsed switcher's list must agree on
				     which session updates the user has seen, or each mount would
				     re-seed and hide the other's unread indicators. */ }
				<SeenSessionTimestampsProvider>
					<div ref={ rootRef } className={ styles.root }>
						<aside
							className={ clsx(
								styles.sidebar,
								effectiveCollapsed && styles.sidebarCollapsed,
								sidebarResize.isResizing && styles.sidebarResizing
							) }
							style={ sidebarStyle }
						>
							<SidebarHeader />
							<SiteList sections />
							<div className={ styles.sidebarFooter }>
								{ /* Toasts sit above the persistent cards: the footer is
								     bottom-anchored, so a transient toast arriving below a card
								     would shove it up and drop it back on expiry. */ }
								{ ! effectiveCollapsed ? (
									<>
										<AppToasts className={ styles.sidebarToasts } appearance="intent" />
										<AppMessageCards className={ styles.sidebarCards } appearance="intent" />
									</>
								) : null }
								<UserMenu />
							</div>
						</aside>
						{ ! effectiveCollapsed ? (
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
							{ children }
							{ effectiveCollapsed ? (
								<AppToasts
									className={ clsx(
										styles.floatingToasts,
										forceCollapsed && styles.floatingToastsOverPreview
									) }
									fit="content"
									appearance="intent"
								/>
							) : null }
						</main>
						{ sidebarResize.isResizing ? <ResizeOverlay /> : null }
						<NoticeHistoryDialog />
						<AppMessageHistoryRecorder />
					</div>
				</SeenSessionTimestampsProvider>
			</SidebarToggleContext.Provider>
		</SidebarCollapsedContext.Provider>
	);
}
