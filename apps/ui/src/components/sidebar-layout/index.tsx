import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { SidebarHeader } from '@/components/sidebar-header';
import { SidebarNav } from '@/components/sidebar-nav';
import { SidebarSettingsButton } from '@/components/sidebar-settings-button';
import { SiteList } from '@/components/site-list';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { SidebarCollapsedContext } from '@/hooks/use-sidebar-collapsed';
import { drawerIcon } from '@/lib/icons';
import { getKeyboardShortcut, getKeyboardShortcutDescriptor } from '@/lib/keyboard-shortcuts';
import { isMacPlatform } from '@/lib/platform';
import { SIDEBAR_PANEL_CONFIG, SIDEBAR_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import styles from './style.module.css';
import type { SettingsTabId } from '@/components/settings-view';
import type { CSSProperties, ReactNode } from 'react';

function getSettingsTabFromLegacyTabName( tabName?: string ): SettingsTabId {
	if ( tabName === 'account' || tabName === 'skills' || tabName === 'mcp' ) {
		return tabName;
	}
	return 'preferences';
}

export function SidebarLayout( { children }: { children: ReactNode } ) {
	const navigate = useNavigate();
	const isFullscreen = useFullscreen();
	const [ collapsed, setCollapsed ] = useState( false );
	const sidebarScrollRef = useRef< HTMLDivElement | null >( null );
	const [ sidebarScrollHasOverflow, setSidebarScrollHasOverflow ] = useState( false );
	const [ sidebarScrollIsScrolled, setSidebarScrollIsScrolled ] = useState( false );
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		edge: 'right',
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const sidebarStyle = { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties;
	const toggleSidebar = useCallback( () => setCollapsed( ( current ) => ! current ), [] );
	const openSettings = useCallback(
		( tab: SettingsTabId = 'preferences' ) => {
			void navigate( { to: '/settings', search: { tab } } );
		},
		[ navigate ]
	);
	const isMac = isMacPlatform();
	const sidebarHeaderVariant = isMac ? ( isFullscreen ? 'fullscreen' : 'traffic-lights' ) : null;
	const sidebarShortcut = getKeyboardShortcutDescriptor( getKeyboardShortcut( 'toggle-sidebar' ) );
	useKeyboardShortcut( 'toggle-sidebar', toggleSidebar );
	useKeyboardShortcut( 'open-app-settings', () => openSettings() );

	const updateSidebarScrollState = useCallback( () => {
		const node = sidebarScrollRef.current;
		if ( ! node ) {
			setSidebarScrollHasOverflow( false );
			setSidebarScrollIsScrolled( false );
			return;
		}

		const hasOverflow = node.scrollHeight > node.clientHeight + 1;
		setSidebarScrollHasOverflow( hasOverflow );
		setSidebarScrollIsScrolled( node.scrollTop > 1 );
	}, [] );

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

		return ipcListener?.subscribe( 'user-settings', ( _event, payload ) =>
			openSettings( getSettingsTabFromLegacyTabName( payload?.tabName ) )
		);
	}, [ openSettings ] );

	useLayoutEffect( () => {
		const node = sidebarScrollRef.current;
		if ( ! node ) {
			updateSidebarScrollState();
			return;
		}

		updateSidebarScrollState();
		const transitionTimeout = window.setTimeout( updateSidebarScrollState, 220 );
		const resizeObserver =
			typeof ResizeObserver === 'undefined'
				? undefined
				: new ResizeObserver( updateSidebarScrollState );

		resizeObserver?.observe( node );
		for ( const child of Array.from( node.children ) ) {
			resizeObserver?.observe( child );
		}
		window.addEventListener( 'resize', updateSidebarScrollState );

		return () => {
			window.clearTimeout( transitionTimeout );
			resizeObserver?.disconnect();
			window.removeEventListener( 'resize', updateSidebarScrollState );
		};
	}, [ updateSidebarScrollState ] );

	return (
		<SidebarCollapsedContext.Provider value={ collapsed }>
			<div className={ styles.root } style={ sidebarStyle }>
				<aside
					className={ clsx(
						styles.sidebar,
						! sidebarHeaderVariant && styles.sidebarNoTrafficLightSpacer,
						collapsed && styles.sidebarCollapsed,
						sidebarResize.isResizing && styles.sidebarResizing
					) }
				>
					<div className={ styles.sidebarInner }>
						{ sidebarHeaderVariant ? <SidebarHeader variant={ sidebarHeaderVariant } /> : null }
						<div
							className={ clsx(
								styles.sidebarScrollFrame,
								sidebarScrollIsScrolled && styles.sidebarScrollFrameScrolled
							) }
						>
							<div
								ref={ sidebarScrollRef }
								className={ styles.sidebarScroll }
								onScroll={ updateSidebarScrollState }
							>
								<SiteList />
							</div>
						</div>
						<SidebarNav />
						<SidebarSettingsButton showTopBorder={ sidebarScrollHasOverflow } />
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
