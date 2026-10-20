import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppMessageCards, AppMessageHistoryRecorder } from '@/components/app-message-cards';
import { AppToasts } from '@/components/app-toasts';
import { NoticeHistoryDialog } from '@/components/notice-history';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { SidebarHeader } from '@/components/sidebar-header';
import { SiteList } from '@/components/site-list';
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
}

export function SidebarLayout( {
	children,
	collapsed: controlledCollapsed,
	onCollapsedChange,
	onExpand,
}: SidebarLayoutProps ) {
	const [ internalCollapsed, setInternalCollapsed ] = useState(
		() => getViewportWidth() < SIDEBAR_AUTO_COLLAPSE_BREAKPOINT
	);
	const collapsed = controlledCollapsed ?? internalCollapsed;
	const wasCompactRef = useRef( getViewportWidth() < SIDEBAR_AUTO_COLLAPSE_BREAKPOINT );
	const rootRef = useRef< HTMLDivElement >( null );
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
		if ( collapsed ) {
			if ( onExpand ) {
				onExpand();
			} else {
				updateCollapsed( false );
			}
			return;
		}
		updateCollapsed( true );
	}, [ collapsed, onExpand, updateCollapsed ] );
	const sidebarStyle = { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties;

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
		<SidebarCollapsedContext.Provider value={ collapsed }>
			<SidebarToggleContext.Provider value={ toggleSidebar }>
				<div ref={ rootRef } className={ styles.root }>
					<div
						className={ clsx(
							styles.sidebarFrame,
							collapsed && styles.sidebarCollapsed,
							sidebarResize.isResizing && styles.sidebarResizing
						) }
						style={ sidebarStyle }
						inert={ collapsed }
					>
						<aside className={ styles.sidebar }>
							<SidebarHeader />
							<SiteList sections />
							<div className={ styles.sidebarFooter }>
								{ ! collapsed ? <AppMessageCards className={ styles.sidebarCards } /> : null }
								<UserMenu />
							</div>
						</aside>
					</div>
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
					<main className={ clsx( styles.main, ! collapsed && 'studio-column-edge' ) }>
						{ children }
					</main>
					{ sidebarResize.isResizing ? <ResizeOverlay /> : null }
					<AppToasts />
					<NoticeHistoryDialog />
					<AppMessageHistoryRecorder />
				</div>
			</SidebarToggleContext.Provider>
		</SidebarCollapsedContext.Provider>
	);
}
