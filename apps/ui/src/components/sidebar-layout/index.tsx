import { __ } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { AppMessageCards, AppMessageCardsDot } from '@/components/app-message-cards';
import { AppToasts } from '@/components/app-toasts';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { ResizeHandle, ResizeOverlay } from '@/components/resize-handle';
import { SidebarHeader } from '@/components/sidebar-header';
import { SiteList } from '@/components/site-list';
import { UserMenu } from '@/components/user-menu';
import { useConnector } from '@/data/core';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { SidebarCollapsedContext } from '@/hooks/use-sidebar-collapsed';
import { drawerIcon } from '@/lib/icons';
import { SIDEBAR_PANEL_CONFIG, SIDEBAR_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';
import type { CSSProperties, ReactNode } from 'react';

const { ThemeProvider } = unlock( privateApis );

// Dark window chrome behind the sidebar and the content frame, mimicking the
// legacy renderer's `bg-chrome` (rgba(30,30,30,1)). Dark mode goes a step
// deeper so the chrome still contrasts with #1e1e1e content surfaces. Keep in
// sync with --app-chrome-bg in style.module.css.
const CHROME_BG_LIGHT = '#1e1e1e';
const CHROME_BG_DARK = '#161616';

interface SidebarLayoutProps {
	children: ReactNode;
	// Hides the sidebar without touching the user's own collapsed state, so
	// clearing it restores whatever the sidebar was doing before (e.g. while
	// the site preview is fullscreen). The floating "Show sidebar" toggle is
	// suppressed too — the forcing feature owns the exit affordance.
	forceCollapsed?: boolean;
	// Called when the user asks to toggle the sidebar while it is force-
	// collapsed (the app-menu shortcut), so the forcing feature can stand down.
	// The sidebar expands alongside it.
	onForceCollapsedToggle?: () => void;
}

export function SidebarLayout( {
	children,
	forceCollapsed = false,
	onForceCollapsedToggle,
}: SidebarLayoutProps ) {
	const [ collapsed, setCollapsed ] = useState( false );
	const effectiveCollapsed = collapsed || forceCollapsed;
	const connector = useConnector();
	const colorScheme = useColorScheme();
	const chromeBg = colorScheme === 'dark' ? CHROME_BG_DARK : CHROME_BG_LIGHT;
	const sidebarResize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		edge: 'right',
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	const toggleSidebar = useCallback( () => {
		if ( forceCollapsed ) {
			onForceCollapsedToggle?.();
			setCollapsed( false );
			return;
		}
		setCollapsed( ( value ) => ! value );
	}, [ forceCollapsed, onForceCollapsedToggle ] );
	const sidebarStyle = effectiveCollapsed
		? undefined
		: ( { '--sidebar-width': `${ sidebarResize.width }px` } as CSSProperties );

	useEffect( () => connector.onToggleSidebar( toggleSidebar ), [ connector, toggleSidebar ] );

	return (
		<SidebarCollapsedContext.Provider value={ effectiveCollapsed }>
			<div className={ styles.root }>
				<aside
					className={ clsx(
						styles.sidebar,
						effectiveCollapsed && styles.sidebarCollapsed,
						sidebarResize.isResizing && styles.sidebarResizing
					) }
					style={ sidebarStyle }
				>
					{ /* The sidebar sits on the dark window chrome, so its wpds
					     tokens come from a nested dark theme scope. The scope div
					     re-declares the row hover/active custom properties so they
					     resolve against the dark ramp. */ }
					<ThemeProvider color={ { bg: chromeBg } }>
						<div className={ styles.sidebarThemeScope }>
							<SidebarHeader />
							<SiteList />
							<div className={ styles.sidebarFooter }>
								{ /* Rides the sticky footer's top edge, blurring list rows as
								     they scroll under; a scroll-driven animation fades it out
								     at the end of the scroll range so the last rows are never
								     left obscured. */ }
								<ProgressiveBlur direction="up" fadeToSurface className={ styles.footerBlur } />
								{ /* Persistent cards stack above the ephemeral toasts; while
								     collapsed the floating toggle's dot stands in for them. */ }
								{ ! effectiveCollapsed ? (
									<AppMessageCards className={ styles.sidebarCards } />
								) : null }
								{ /* Single AppToasts instance app-wide: here when expanded,
								     floating over the main panel when collapsed. The store
								     survives the swap. */ }
								{ ! effectiveCollapsed ? <AppToasts className={ styles.sidebarToasts } /> : null }
								<UserMenu onToggleSidebar={ toggleSidebar } />
							</div>
						</div>
					</ThemeProvider>
				</aside>
				{ ! effectiveCollapsed ? (
					// Same dark theme scope as the sidebar so the indicator's
					// brand token resolves against the dark ramp.
					<ThemeProvider color={ { bg: chromeBg } }>
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
					</ThemeProvider>
				) : null }
				{ /* data-app-main lets descendants publish layout facts to this
				     scope — SessionFrame sets --app-main-composer-height here so
				     the floating toast shelf can clear the chat composer. */ }
				<main className={ styles.main } data-app-main>
					{ children }
					{ effectiveCollapsed ? (
						<AppToasts className={ styles.floatingToasts } fit="content" />
					) : null }
					{ effectiveCollapsed && ! forceCollapsed ? (
						<div className={ styles.floatingToggle }>
							{ /* The wrapper pins the pending-cards dot to the button's
							     corner; the outer container is taller than the button. */ }
							<span className={ styles.floatingToggleButton }>
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ drawerIcon }
									label={ __( 'Show sidebar' ) }
									onClick={ toggleSidebar }
								/>
								<AppMessageCardsDot />
							</span>
						</div>
					) : null }
				</main>
				{ sidebarResize.isResizing ? <ResizeOverlay /> : null }
			</div>
		</SidebarCollapsedContext.Provider>
	);
}
